import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { CONFIG_DEFAULTS } from "../../src/consts/config.ts";
import { loadConfig } from "../../src/modules/config.ts";
import { ensureInstalled } from "../../src/modules/install.ts";
import { buildStopReason, runCommand } from "../../src/modules/hook.ts";
import type { FindingItem } from "../../src/interfaces/finding.ts";

function finding(line: number): FindingItem {
  return { severity: "error", ruleId: "max-params", file: "src/a.ts", line, message: "too many" };
}

async function captureOutput(action: () => Promise<number>): Promise<{ status: number; output: string }> {
  const original = process.stdout.write.bind(process.stdout);
  let output = "";
  process.stdout.write = ((chunk: string) => {
    output += chunk;
    return true;
  }) as typeof process.stdout.write;
  try {
    const status = await action();
    return { status, output };
  } finally {
    process.stdout.write = original;
  }
}

test("the reason starts with the header and lists findings with their summary", () => {
  const reason = buildStopReason({
    profile: null,
    findings: [finding(3)],
    summary: { errors: 1, warnings: 0, files: 1 },
    candidates: [],
    libraries: [],
  });
  const lines = reason.split("\n");
  assert.equal(lines[0], "Run the codemaster skill (codemaster:codemaster) for this branch.");
  assert.ok(lines.includes("Findings (1 errors, 0 warnings):"), reason);
  assert.ok(lines.includes("error max-params src/a.ts:3 too many"), reason);
  assert.ok(!reason.includes("Tournament candidates"), reason);
  assert.ok(!reason.includes("Libraries:"), reason);
});

test("the reason caps findings at 30 lines and says how many are left", () => {
  const findings = Array.from({ length: 33 }, (_, index) => finding(index + 1));
  const reason = buildStopReason({
    profile: null,
    findings,
    summary: { errors: 33, warnings: 0, files: 1 },
    candidates: [],
    libraries: [],
  });
  const findingLines = reason.split("\n").filter((line) => line.startsWith("error max-params"));
  assert.equal(findingLines.length, 30);
  assert.ok(reason.includes("… and 3 more"), reason);
});

test("the reason puts the profile before findings and lists candidates and libraries", () => {
  const reason = buildStopReason({
    profile: "codemaster profile:\n  layout = \"modular\"  (auto)\n",
    findings: [],
    summary: { errors: 0, warnings: 0, files: 0 },
    candidates: ["src/math.ts:1 scoreValues complexity=6 lines=9"],
    libraries: ["add alpha 1.2.0 readme=- homepage=-"],
  });
  const lines = reason.split("\n");
  assert.equal(lines[1], "codemaster profile:");
  assert.ok(lines.includes("Tournament candidates (1):"), reason);
  assert.ok(lines.includes("src/math.ts:1 scoreValues complexity=6 lines=9"), reason);
  assert.ok(lines.includes("Libraries:"), reason);
  assert.ok(lines.includes("add alpha 1.2.0 readme=- homepage=-"), reason);
  assert.ok(!reason.includes("Findings ("), reason);
});

test("session start prints three lines and points to the library skill when it exists", async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "codemaster-hook-"));
  try {
    mkdirSync(join(projectRoot, "src/user"), { recursive: true });
    writeFileSync(join(projectRoot, "src/user/user.interfaces.ts"), "export interface UserThing { id: string }\n");
    const context = {
      argumentsList: ["hook-session-start"],
      projectRoot,
      config: CONFIG_DEFAULTS,
      configWarnings: [],
      input: "{}",
      pluginRoot: projectRoot,
    };
    const without = await captureOutput(() => runCommand(context));
    const lines = without.output.trim().split("\n");
    assert.equal(lines.length, 3);
    assert.equal(lines[0], "codemaster: layout=modular, sourceRoot=src");
    assert.equal(lines[1], "Before a task, check whether the framework or an installed library already does it.");
    assert.equal(lines[2], "Follow the codemaster skill rules while coding.");
    mkdirSync(join(projectRoot, ".claude/skills/codemaster-libraries"), { recursive: true });
    writeFileSync(join(projectRoot, ".claude/skills/codemaster-libraries/SKILL.md"), "---\nname: codemaster-libraries\n---\n");
    const withIndex = await captureOutput(() => runCommand(context));
    assert.equal(
      withIndex.output.trim().split("\n")[1],
      "Before a task, check whether the framework or an installed library already does it; see the codemaster-libraries skill.",
    );
    assert.equal(withIndex.status, 0);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("session start is silent when the hook is switched off", async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "codemaster-hook-"));
  try {
    const context = {
      argumentsList: ["hook-session-start"],
      projectRoot,
      config: { ...CONFIG_DEFAULTS, hook: false },
      configWarnings: [],
      input: "{}",
      pluginRoot: projectRoot,
    };
    const { status, output } = await captureOutput(() => runCommand(context));
    assert.equal(status, 0);
    assert.equal(output, "");
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("the reason lists warnings right after the header", () => {
  const reason = buildStopReason({
    profile: null,
    warnings: ["warning config .codemaster.json: invalid JSON"],
    findings: [finding(3)],
    summary: { errors: 1, warnings: 0, files: 1 },
    candidates: [],
    libraries: [],
  });
  assert.equal(reason.split("\n")[1], "warning config .codemaster.json: invalid JSON");
});

function createRepository(): string {
  const projectRoot = mkdtempSync(join(tmpdir(), "codemaster-hook-"));
  const git = (...argumentsList: string[]) =>
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...argumentsList], { cwd: projectRoot, stdio: "ignore" });
  git("init", "-q", "-b", "main");
  git("commit", "-q", "--allow-empty", "-m", "base");
  git("checkout", "-q", "-b", "work");
  mkdirSync(join(projectRoot, "src/pages"), { recursive: true });
  writeFileSync(join(projectRoot, ".codemaster.json"), "{\"libraryDigest\":false}\n");
  writeFileSync(
    join(projectRoot, "src/pages/home.ts"),
    "export function sixParameters(a: number, b: number, c: number, d: number, e: number, f: number) { return a; }\n",
  );
  return projectRoot;
}

function stopContext(projectRoot: string, configWarnings: string[] = []) {
  return {
    argumentsList: ["hook-stop"],
    projectRoot,
    config: loadConfig(projectRoot).config,
    configWarnings,
    input: JSON.stringify({ cwd: projectRoot, stop_hook_active: false }),
    pluginRoot: resolve(import.meta.dirname, "../.."),
  };
}

test("hook-stop blocks once and stays silent on the same state", async () => {
  ensureInstalled();
  const projectRoot = createRepository();
  try {
    const first = await captureOutput(() => runCommand(stopContext(projectRoot)));
    const { decision, reason } = JSON.parse(first.output);
    assert.equal(decision, "block");
    assert.ok(reason.includes("max-params src/pages/home.ts:1"), reason);
    const second = await captureOutput(() => runCommand(stopContext(projectRoot)));
    assert.equal(second.output, "");
    assert.equal(second.status, 0);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("on the first run the local config still beats the scanned profile", async () => {
  ensureInstalled();
  const projectRoot = createRepository();
  try {
    rmSync(join(projectRoot, ".codemaster.json"));
    writeFileSync(join(projectRoot, ".codemaster.local.json"), "{\"libraryDigest\":false,\"rules\":{\"max-params\":\"off\"}}\n");
    mkdirSync(join(projectRoot, "node_modules/.bin"), { recursive: true });
    writeFileSync(
      join(projectRoot, "node_modules/.bin/eslint"),
      "#!/bin/sh\necho '{\"rules\":{\"max-params\":[\"error\",3]}}'\n",
      { mode: 0o755 },
    );
    const { output } = await captureOutput(() => runCommand(stopContext(projectRoot)));
    const { reason } = JSON.parse(output);
    assert.ok(reason.includes("codemaster profile:"), reason);
    assert.ok(!reason.includes("error max-params"), reason);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("hook-stop puts config warnings into the reason", async () => {
  ensureInstalled();
  const projectRoot = createRepository();
  try {
    const context = stopContext(projectRoot, ["warning config .codemaster.local.json: invalid JSON"]);
    const { output } = await captureOutput(() => runCommand(context));
    assert.ok(JSON.parse(output).reason.includes("warning config .codemaster.local.json: invalid JSON"), output);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

function lastCheckedPath(projectRoot: string): string {
  return join(projectRoot, ".git", "codemaster", "last-checked");
}

const CLEAN_HOME_SOURCE = "export function home() {\n  return 1;\n}\n";

test("hook-stop stays silent and records nothing when the hook is off", async () => {
  const projectRoot = createRepository();
  try {
    writeFileSync(join(projectRoot, ".codemaster.json"), "{\"libraryDigest\":false,\"hook\":false}\n");
    const { status, output } = await captureOutput(() => runCommand(stopContext(projectRoot)));
    assert.equal(status, 0);
    assert.equal(output, "");
    assert.equal(existsSync(lastCheckedPath(projectRoot)), false);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("hook-stop stays silent and records nothing when no file changed", async () => {
  const projectRoot = createRepository();
  try {
    rmSync(join(projectRoot, "src"), { recursive: true, force: true });
    rmSync(join(projectRoot, ".codemaster.json"));
    const { status, output } = await captureOutput(() => runCommand(stopContext(projectRoot)));
    assert.equal(status, 0);
    assert.equal(output, "");
    assert.equal(existsSync(lastCheckedPath(projectRoot)), false);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("an active stop hook records the state without blocking so the next stop stays silent", async () => {
  const projectRoot = createRepository();
  try {
    const active = { ...stopContext(projectRoot), input: JSON.stringify({ cwd: projectRoot, stop_hook_active: true }) };
    const first = await captureOutput(() => runCommand(active));
    assert.equal(first.output, "");
    assert.equal(existsSync(lastCheckedPath(projectRoot)), true);
    const second = await captureOutput(() => runCommand(stopContext(projectRoot)));
    assert.equal(second.output, "");
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("hook-stop with an empty input runs as an inactive stop", async () => {
  ensureInstalled();
  const projectRoot = createRepository();
  try {
    const { output } = await captureOutput(() => runCommand({ ...stopContext(projectRoot), input: "" }));
    assert.equal(JSON.parse(output).decision, "block");
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("a failed install is written to stderr, returns 0 and leaves the state unrecorded", async () => {
  const projectRoot = createRepository();
  const saved = process.env.CODEMASTER_DATA_DIR;
  const originalStderr = process.stderr.write;
  const written: string[] = [];
  try {
    process.env.CODEMASTER_DATA_DIR = join(projectRoot, "src/pages/home.ts", "data");
    process.stderr.write = ((chunk: string | Uint8Array) => written.push(String(chunk)) > 0) as typeof process.stderr.write;
    const { status, output } = await captureOutput(() => runCommand(stopContext(projectRoot)));
    process.stderr.write = originalStderr;
    assert.equal(status, 0);
    assert.equal(output, "");
    assert.equal(written.length, 1);
    assert.match(written[0], /^codemaster: install failed \(.+\)\n$/);
    assert.equal(existsSync(lastCheckedPath(projectRoot)), false);
  } finally {
    process.stderr.write = originalStderr;
    if (saved === undefined) {
      delete process.env.CODEMASTER_DATA_DIR;
    } else {
      process.env.CODEMASTER_DATA_DIR = saved;
    }
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("a clean change records the state without blocking", async () => {
  ensureInstalled();
  const projectRoot = createRepository();
  try {
    writeFileSync(join(projectRoot, "src/pages/home.ts"), CLEAN_HOME_SOURCE);
    const { status, output } = await captureOutput(() => runCommand(stopContext(projectRoot)));
    assert.equal(status, 0);
    assert.equal(output, "");
    assert.equal(existsSync(lastCheckedPath(projectRoot)), true);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("a clean change still blocks with tournament candidates", async () => {
  ensureInstalled();
  const projectRoot = createRepository();
  try {
    writeFileSync(join(projectRoot, ".codemaster.json"), "{\"libraryDigest\":false,\"tournament\":{\"minLines\":1}}\n");
    writeFileSync(join(projectRoot, "src/pages/home.ts"), CLEAN_HOME_SOURCE);
    const { output } = await captureOutput(() => runCommand(stopContext(projectRoot)));
    const { reason } = JSON.parse(output);
    const lines = reason.split("\n");
    assert.ok(lines.includes("Tournament candidates (1):"), reason);
    assert.ok(lines.includes("src/pages/home.ts:1 home complexity=0 lines=1"), reason);
    assert.ok(!reason.includes("Findings ("), reason);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("a clean change still blocks with the library digest when it is on", async () => {
  ensureInstalled();
  const projectRoot = createRepository();
  try {
    writeFileSync(join(projectRoot, ".codemaster.json"), "{}\n");
    writeFileSync(join(projectRoot, "package.json"), "{\"dependencies\":{\"alpha\":\"1.0.0\"}}\n");
    writeFileSync(join(projectRoot, "src/pages/home.ts"), CLEAN_HOME_SOURCE);
    const { output } = await captureOutput(() => runCommand(stopContext(projectRoot)));
    const { reason } = JSON.parse(output);
    const lines = reason.split("\n");
    assert.ok(lines.includes("Libraries:"), reason);
    assert.ok(lines.includes("missing alpha (not installed)"), reason);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
