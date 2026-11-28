import { before, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { CONFIG_DEFAULTS } from "../../src/consts/config.ts";
import type { CommandContext } from "../../src/interfaces/command.ts";
import type { ConfigProject } from "../../src/interfaces/config.ts";
import type { FindingItem } from "../../src/interfaces/finding.ts";
import { ensureInstalled } from "../../src/modules/install.ts";
import { runChecks, runCommand } from "../../src/modules/check.ts";

const pluginRoot = resolve(import.meta.dirname, "../..");

const sixParameters =
  "export function renderHome(first: number, second: number, third: number, fourth: number, fifth: number, sixth: number) { return first; }\n";

const destructuringCandidate = "export function measureName(name: string) {\n  const length = name.length;\n  return length;\n}\n";

before(() => {
  ensureInstalled();
});

function createProject(files: Record<string, string>): string {
  const directory = mkdtempSync(join(tmpdir(), "codemaster-check-"));
  for (const [path, text] of Object.entries(files)) {
    const target = join(directory, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
  return directory;
}

function settingsWith(overrides: Partial<ConfigProject> = {}): ConfigProject {
  return { ...CONFIG_DEFAULTS, ...overrides };
}

function triplesOf(findings: FindingItem[]): string[] {
  return findings.map((finding) => `${finding.ruleId} ${finding.file}:${finding.line}`);
}

async function checkProject(files: Record<string, string>, overrides: Partial<ConfigProject> = {}) {
  const projectRoot = createProject(files);
  return runChecks({ projectRoot, pluginRoot, config: settingsWith(overrides), files: Object.keys(files) });
}

function createContext(directory: string, argumentsList: string[], configWarnings: string[] = []): CommandContext {
  return {
    argumentsList,
    projectRoot: directory,
    config: settingsWith(),
    configWarnings,
    input: "",
    pluginRoot,
  };
}

async function runCaptured(context: CommandContext): Promise<{ status: number; stdout: string; stderr: string }> {
  const writeOut = process.stdout.write;
  const writeError = process.stderr.write;
  let stdout = "";
  let stderr = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += String(chunk);
    return true;
  }) as typeof process.stderr.write;
  try {
    const status = await runCommand(context);
    return { status, stdout, stderr };
  } finally {
    process.stdout.write = writeOut;
    process.stderr.write = writeError;
  }
}

function initializeRepository(directory: string): void {
  const result = spawnSync("git", ["init", "-q", "-b", "main"], { cwd: directory, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

test("a rule setting replaces the severity and attaches the reason", async () => {
  const { findings, summary } = await checkProject(
    { "src/pages/home.ts": sixParameters },
    { rules: { "max-params": { severity: "warning", reason: "legacy" } } },
  );
  const finding = findings.find((item) => item.ruleId === "max-params");
  assert.equal(finding?.severity, "warning");
  assert.equal(finding?.reason, "legacy");
  assert.equal(summary.errors, 0);
});

test("a null rule setting keeps the rule's own severity instead of crashing", async () => {
  const { findings, summary } = await checkProject(
    { "src/pages/home.ts": sixParameters },
    { rules: { "max-params": null } as unknown as ConfigProject["rules"] },
  );
  assert.deepEqual(triplesOf(findings), ["max-params src/pages/home.ts:1"]);
  assert.equal(findings[0].severity, "error");
  assert.equal(summary.errors, 1);
});

test("an unparsable file gives one parse warning and the other files are still checked", async () => {
  const { findings } = await checkProject({
    "src/pages/broken.ts": "export function broken( {\n  const = ;\n  if (\n",
    "src/pages/home.ts": sixParameters,
  });
  const parseFindings = findings.filter((finding) => finding.ruleId === "parse");
  assert.deepEqual(parseFindings, [
    { severity: "warning", ruleId: "parse", file: "src/pages/broken.ts", line: 1, message: "could not parse" },
  ]);
  assert.ok(triplesOf(findings).includes("max-params src/pages/home.ts:1"), triplesOf(findings).join("\n"));
});

test("a typeof import type argument in a call is parsed and checked on its own line", async () => {
  const text = 'const mocked = await importOriginal<typeof import("./home.ts")>();\n' + sixParameters;
  const { findings } = await checkProject({ "src/pages/mocked.ts": text });
  assert.deepEqual(triplesOf(findings), ["max-params src/pages/mocked.ts:2"]);
});

test("files matching an exclude glob are left out of the check", async () => {
  const { findings, summary } = await checkProject(
    { "docs/proto/page.ts": sixParameters, "site/js/vendor.js": sixParameters, "src/pages/home.ts": sixParameters },
    { exclude: ["docs/**", "site/js/*.js"] },
  );
  assert.deepEqual(triplesOf(findings), ["max-params src/pages/home.ts:1"]);
  assert.equal(summary.files, 1);
});

test("a file that cannot be read gives a warning and the other files are still checked", async () => {
  const projectRoot = createProject({ "src/pages/home.ts": sixParameters, "src/pages/folder.js/inner.ts": "export const a = 1;\n" });
  const files = ["src/pages/folder.js", "src/pages/gone.ts", "src/pages/home.ts"];
  const { findings, summary } = await runChecks({ projectRoot, pluginRoot, config: settingsWith(), files });
  const failures = findings.filter((finding) => finding.ruleId === "parse");
  assert.deepEqual(
    failures.map(({ severity, file, line }) => ({ severity, file, line })),
    [
      { severity: "warning", file: "src/pages/folder.js", line: 1 },
      { severity: "warning", file: "src/pages/gone.ts", line: 1 },
    ],
  );
  assert.match(failures[0].message, /^could not check: EISDIR/);
  assert.match(failures[1].message, /^could not check: ENOENT/);
  assert.ok(!failures[0].message.includes("\n"));
  assert.ok(triplesOf(findings).includes("max-params src/pages/home.ts:1"), triplesOf(findings).join("\n"));
  assert.equal(summary.errors, 1);
});

test("the exit code ignores a parse warning", async () => {
  const directory = createProject({ "src/pages/broken.ts": "export function broken( {\n  const = ;\n  if (\n" });
  const { status, stdout } = await runCaptured(createContext(directory, ["src/pages/broken.ts"]));
  assert.equal(status, 0);
  assert.match(stdout, /^warning parse src\/pages\/broken\.ts:1 could not parse$/m);
});

test("a rule switched off drops its findings", async () => {
  const { findings } = await checkProject({ "src/pages/home.ts": sixParameters }, { rules: { "max-params": "off" } });
  assert.deepEqual(triplesOf(findings), []);
});

test("findings are sorted by file, then line, then ruleId", async () => {
  const { findings } = await checkProject({
    "src/pages/zeta.ts": sixParameters,
    "src/pages/alpha.ts": `${destructuringCandidate}export function renderAlpha(msg: string, second: number, third: number, fourth: number, fifth: number, sixth: number) { return msg; }\n`,
  });
  assert.deepEqual(triplesOf(findings), [
    "prefer-destructuring src/pages/alpha.ts:2",
    "max-params src/pages/alpha.ts:5",
    "name-abbreviation src/pages/alpha.ts:5",
    "max-params src/pages/zeta.ts:1",
  ]);
});

test("summary counts errors, warnings and distinct files", async () => {
  const { summary } = await checkProject({
    "src/pages/zeta.ts": sixParameters,
    "src/pages/alpha.ts": `${destructuringCandidate}export function renderAlpha(msg: string, second: number, third: number, fourth: number, fifth: number, sixth: number) { return msg; }\n`,
  });
  assert.deepEqual(summary, { errors: 3, warnings: 1, files: 2 });
});

test("layout off emits no layout-rule findings while max-params still fires", async () => {
  const { findings, layout } = await checkProject({
    "src/pages/home.ts": `export interface PageShape { title: string }\nexport const PAGE_TITLE = "home";\n${sixParameters}`,
  });
  assert.equal(layout, "off");
  assert.deepEqual(triplesOf(findings), ["max-params src/pages/home.ts:3"]);
});

test("prefer-destructuring findings on test files are dropped", async () => {
  const { findings } = await checkProject({
    "src/pages/measure.ts": destructuringCandidate,
    "src/pages/measure.test.ts": destructuringCandidate,
  });
  const destructuring = findings.filter((finding) => finding.ruleId === "prefer-destructuring");
  assert.deepEqual(triplesOf(destructuring), ["prefer-destructuring src/pages/measure.ts:2"]);
});

test("--json prints one line with findings and summary and returns 1 on errors", async () => {
  const directory = createProject({ "src/pages/home.ts": sixParameters });
  const { status, stdout } = await runCaptured(createContext(directory, ["--json", "src"]));
  assert.equal(status, 1);
  const lines = stdout.trim().split("\n");
  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]) as { findings: FindingItem[]; summary: unknown };
  assert.deepEqual(triplesOf(parsed.findings), ["max-params src/pages/home.ts:1"]);
  assert.deepEqual(parsed.summary, { errors: 1, warnings: 0, files: 1 });
});

test("--json returns 0 when there are no errors", async () => {
  const directory = createProject({
    "src/pages/button.ts": "export function renderButton(label: string) { return label; }\n",
    "src/pages/title.ts": "export function renderTitle(label: string) { return label; }\n",
  });
  const { status, stdout } = await runCaptured(createContext(directory, ["--json", "src"]));
  assert.equal(status, 0);
  assert.deepEqual(JSON.parse(stdout.trim()), { findings: [], summary: { errors: 0, warnings: 0, files: 2 } });
});

test("a path that matches no source file is reported and returns 2", async () => {
  const directory = createProject({ "src/pages/home.ts": sixParameters });
  const { status, stdout } = await runCaptured(createContext(directory, ["src/missing"]));
  assert.equal(status, 2);
  assert.match(stdout, /^codemaster: no source files match src\/missing$/m);
});

test("--json sends config warnings to stderr and keeps stdout parseable", async () => {
  const directory = createProject({ "src/pages/home.ts": sixParameters, ".codemaster.json": "{ not json" });
  const warning = "warning config .codemaster.json: invalid JSON";
  const { status, stdout, stderr } = await runCaptured(createContext(directory, ["--json", "src"], [warning]));
  assert.equal(status, 1);
  const parsed = JSON.parse(stdout) as { findings: FindingItem[] };
  assert.deepEqual(triplesOf(parsed.findings), ["max-params src/pages/home.ts:1"]);
  assert.match(stderr, /^warning config \.codemaster\.json: invalid JSON$/m);
});

test("inside git a positional directory skips gitignored files", async () => {
  const directory = createProject({
    ".gitignore": "out/\n",
    "src/pages/home.ts": sixParameters,
    "out/build.ts": sixParameters,
  });
  initializeRepository(directory);
  const { stdout } = await runCaptured(createContext(directory, ["--json", "."]));
  const parsed = JSON.parse(stdout) as { findings: FindingItem[] };
  assert.deepEqual(triplesOf(parsed.findings), ["max-params src/pages/home.ts:1"]);
});

test("plain output prints config warnings first and ends with the summary line", async () => {
  const directory = createProject({ "src/pages/home.ts": sixParameters });
  const { status, stdout } = await runCaptured(
    createContext(directory, ["src"], ["warning config .codemaster.json: invalid JSON"]),
  );
  assert.equal(status, 1);
  const lines = stdout.trim().split("\n");
  assert.equal(lines[0], "warning config .codemaster.json: invalid JSON");
  assert.match(lines[1], /^error max-params src\/pages\/home\.ts:1 \S/);
  assert.equal(lines[lines.length - 1], "codemaster: 1 errors, 0 warnings in 1 files");
  assert.equal(lines.length, 3);
});

test("outside git without paths explains itself and returns 0", async () => {
  const directory = createProject({ "src/pages/home.ts": sixParameters });
  const { status, stdout } = await runCaptured(createContext(directory, []));
  assert.equal(status, 0);
  assert.match(stdout, /codemaster: not a git repository; pass paths/);
});
