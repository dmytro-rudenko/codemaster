import { before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { ensureInstalled } from "../../../src/modules/install.ts";
import { scanWithRules } from "../../../src/helpers/infrastructure/ast-grep-scan.ts";
import type { FindingItem } from "../../../src/interfaces/finding.ts";

const PLUGIN_ROOT = resolve(import.meta.dirname, "../../..");

function scanSource(fileName: string, text: string): FindingItem[] {
  const projectRoot = mkdtempSync(join(tmpdir(), "codemaster-scan-"));
  try {
    const absolutePath = join(projectRoot, fileName);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, text);
    return scanWithRules({
      pluginRoot: PLUGIN_ROOT,
      projectRoot,
      files: [fileName],
    });
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
}

function findingsFor(findings: FindingItem[], ruleId: string): FindingItem[] {
  return findings.filter((finding) => finding.ruleId === ruleId);
}

before(() => {
  const outcome = ensureInstalled();
  assert.equal(outcome.ok, true, `install failed: ${outcome.message}`);
});

test("scanWithRules reports prefer-destructuring on line 1", () => {
  const findings = scanSource("sample.ts", "const name = user.name;\n");
  const destructuring = findingsFor(findings, "prefer-destructuring");
  assert.equal(destructuring.length, 1);
  assert.equal(destructuring[0].line, 1);
  assert.equal(destructuring[0].file, "sample.ts");
});

test("scanWithRules leaves global function assignments to the declaration check", () => {
  const findings = scanSource("sample.ts", "globalThis.run = () => 1;\n");
  assert.deepEqual(findingsFor(findings, "global-function"), []);
});

test("scanWithRules reports prefer-destructuring for bracket access with a string key", () => {
  const findings = scanSource("bracket.ts", 'const name = user["name"];\n');
  const destructuring = findingsFor(findings, "prefer-destructuring");
  assert.equal(destructuring.length, 1);
  assert.equal(destructuring[0].line, 1);
});

test("scanWithRules gives prefer-destructuring the warning severity and its message", () => {
  const findings = scanSource("severity.ts", "const name = user.name;\n");
  const destructuring = findingsFor(findings, "prefer-destructuring");
  assert.equal(destructuring.length, 1);
  assert.equal(destructuring[0].severity, "warning");
  assert.equal(destructuring[0].message, "use destructuring");
});

test("scanWithRules reports prefer-destructuring in a tsx file with JSX", () => {
  const findings = scanSource(
    "view.tsx",
    "const name = user.name;\nconst view = <div>{name}</div>;\n",
  );
  const destructuring = findingsFor(findings, "prefer-destructuring");
  assert.equal(destructuring.length, 1);
  assert.equal(destructuring[0].line, 1);
  assert.equal(destructuring[0].file, "view.tsx");
});

test("scanWithRules numbers lines from 1 for a finding deep in the file", () => {
  const findings = scanSource(
    "deep.ts",
    "const first = 1;\nconst second = 2;\nconst name = user.name;\n",
  );
  const destructuring = findingsFor(findings, "prefer-destructuring");
  assert.equal(destructuring.length, 1);
  assert.equal(destructuring[0].line, 3);
});

test("scanWithRules returns file paths relative to the project root", () => {
  const findings = scanSource("nested/dir/inner.ts", "const name = user.name;\n");
  const destructuring = findingsFor(findings, "prefer-destructuring");
  assert.equal(destructuring.length, 1);
  assert.equal(destructuring[0].file, "nested/dir/inner.ts");
});

test("scanWithRules returns no findings for a clean file", () => {
  const findings = scanSource(
    "clean.ts",
    "const { name } = user;\nexport function run(): number {\n  return name.length;\n}\n",
  );
  assert.deepEqual(findings, []);
});

const LANGUAGE_FILE_NAMES = ["plain.js", "module.mjs", "common.cjs", "view.jsx", "module.mts", "common.cts"];

for (const fileName of LANGUAGE_FILE_NAMES) {
  test(`scanWithRules reports prefer-destructuring in ${fileName}`, () => {
    const findings = scanSource(fileName, "const name = user.name;\n");
    const destructuring = findingsFor(findings, "prefer-destructuring");
    assert.equal(destructuring.length, 1);
    assert.equal(destructuring[0].line, 1);
    assert.equal(destructuring[0].file, fileName);
  });
}

test("scanWithRules scans mixed ts, js and jsx files in one call", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "codemaster-scan-"));
  try {
    for (const fileName of ["a.js", "b.jsx", "c.ts"]) {
      writeFileSync(join(projectRoot, fileName), "const name = user.name;\n");
    }
    const findings = scanWithRules({
      pluginRoot: PLUGIN_ROOT,
      projectRoot,
      files: ["a.js", "b.jsx", "c.ts"],
    });
    const files = findingsFor(findings, "prefer-destructuring")
      .map((finding) => finding.file)
      .sort();
    assert.deepEqual(files, ["a.js", "b.jsx", "c.ts"]);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("scanWithRules removes its rule copies from the temporary directory", () => {
  const sandboxRoot = mkdtempSync(join(tmpdir(), "codemaster-scan-"));
  const projectRoot = join(sandboxRoot, "project");
  const scratchDirectory = join(sandboxRoot, "scratch");
  const originalTemporaryDirectory = process.env.TMPDIR;
  mkdirSync(projectRoot);
  mkdirSync(scratchDirectory);
  writeFileSync(join(projectRoot, "a.js"), "const name = user.name;\n");
  writeFileSync(join(projectRoot, "b.tsx"), "const name = user.name;\n");
  try {
    process.env.TMPDIR = scratchDirectory;
    const findings = scanWithRules({
      pluginRoot: PLUGIN_ROOT,
      projectRoot,
      files: ["a.js", "b.tsx"],
    });
    assert.equal(findings.length, 2);
    assert.deepEqual(readdirSync(scratchDirectory), []);
  } finally {
    if (originalTemporaryDirectory === undefined) {
      delete process.env.TMPDIR;
    } else {
      process.env.TMPDIR = originalTemporaryDirectory;
    }
    rmSync(sandboxRoot, { recursive: true, force: true });
  }
});

function withFakeBinary<Result>(script: string, run: () => Result): Result {
  const dataDirectory = mkdtempSync(join(tmpdir(), "codemaster-fake-"));
  const binary = join(dataDirectory, "node_modules", ".bin", "ast-grep");
  mkdirSync(dirname(binary), { recursive: true });
  writeFileSync(binary, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  const original = process.env.CODEMASTER_DATA_DIR;
  process.env.CODEMASTER_DATA_DIR = dataDirectory;
  try {
    return run();
  } finally {
    if (original === undefined) {
      delete process.env.CODEMASTER_DATA_DIR;
    } else {
      process.env.CODEMASTER_DATA_DIR = original;
    }
    rmSync(dataDirectory, { recursive: true, force: true });
  }
}

function numberedFiles(count: number): string[] {
  return Array.from({ length: count }, (_, position) => `src/file${position}.ts`);
}

const FAILURE_BASE = { severity: "warning", ruleId: "ast-grep", file: "(ast-grep)", line: 1 };

test("scanWithRules reports a rule the CLI cannot parse instead of reading as clean", () => {
  const pluginRoot = mkdtempSync(join(tmpdir(), "codemaster-plugin-"));
  const projectRoot = mkdtempSync(join(tmpdir(), "codemaster-scan-"));
  try {
    mkdirSync(join(pluginRoot, "rules", "typescript"), { recursive: true });
    writeFileSync(join(pluginRoot, "rules", "typescript", "broken.yml"), "id: broken\nlanguage: TypeScript\nrule: [unclosed\n");
    writeFileSync(join(projectRoot, "a.ts"), "const name = user.name;\n");
    const findings = scanWithRules({ pluginRoot, projectRoot, files: ["a.ts"] });
    assert.equal(findings.length, 1, JSON.stringify(findings));
    assert.deepEqual({ ...findings[0], message: "" }, { ...FAILURE_BASE, message: "" });
    assert.match(findings[0].message, /^ast-grep failed: Error: Cannot parse rule /);
    assert.ok(!findings[0].message.includes("\n"));
  } finally {
    rmSync(pluginRoot, { recursive: true, force: true });
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("scanWithRules reports a non-zero exit with the first stderr line, once for every batch", () => {
  const findings = withFakeBinary('echo "boom" >&2\necho "second line" >&2\nexit 3', () =>
    scanWithRules({ pluginRoot: PLUGIN_ROOT, projectRoot: tmpdir(), files: numberedFiles(1001) }),
  );
  assert.deepEqual(findings, [{ ...FAILURE_BASE, message: "ast-grep failed: boom" }]);
});

test("scanWithRules reports a non-zero exit without stderr by its status", () => {
  const findings = withFakeBinary("exit 5", () =>
    scanWithRules({ pluginRoot: PLUGIN_ROOT, projectRoot: tmpdir(), files: ["a.ts"] }),
  );
  assert.deepEqual(findings, [{ ...FAILURE_BASE, message: "ast-grep failed: exit 5" }]);
});

test("scanWithRules reports a binary that cannot be started", () => {
  const findings = withFakeBinary("exit 0", () => {
    rmSync(join(process.env.CODEMASTER_DATA_DIR ?? "", "node_modules"), { recursive: true, force: true });
    return scanWithRules({ pluginRoot: PLUGIN_ROOT, projectRoot: tmpdir(), files: ["a.ts"] });
  });
  assert.equal(findings.length, 1, JSON.stringify(findings));
  assert.deepEqual({ ...findings[0], message: "" }, { ...FAILURE_BASE, message: "" });
  assert.match(findings[0].message, /^ast-grep failed: \S/);
});

test("scanWithRules skips output lines that are not findings and keeps the valid ones", () => {
  const valid =
    '{"severity":"warning","ruleId":"prefer-destructuring","file":"a.ts","range":{"start":{"line":6}},"message":"use destructuring"}';
  const script = `printf '%s\\n' 'not json' '{}' '{"half":' '${valid}'`;
  const findings = withFakeBinary(script, () =>
    scanWithRules({ pluginRoot: PLUGIN_ROOT, projectRoot: tmpdir(), files: ["a.ts"] }),
  );
  assert.deepEqual(findings, [
    { severity: "warning", ruleId: "prefer-destructuring", file: "a.ts", line: 7, message: "use destructuring" },
  ]);
});

test("scanWithRules keeps error-level findings that make the CLI exit with status 1", () => {
  const loud =
    '{"severity":"error","ruleId":"loud","file":"a.ts","range":{"start":{"line":0}},"message":"loud"}';
  const findings = withFakeBinary(`printf '%s\\n' '${loud}'\nexit 1`, () =>
    scanWithRules({ pluginRoot: PLUGIN_ROOT, projectRoot: tmpdir(), files: ["a.ts"] }),
  );
  assert.deepEqual(findings, [{ severity: "error", ruleId: "loud", file: "a.ts", line: 1, message: "loud" }]);
});

test("scanWithRules keeps two matches of one rule on the same line", () => {
  const same =
    '{"severity":"warning","ruleId":"prefer-destructuring","file":"a.ts","range":{"start":{"line":0}},"message":"use destructuring"}';
  const findings = withFakeBinary(`printf '%s\\n' '${same}' '${same}'`, () =>
    scanWithRules({ pluginRoot: PLUGIN_ROOT, projectRoot: tmpdir(), files: ["a.ts"] }),
  );
  assert.equal(findings.length, 2);
});

test("scanWithRules passes the files to ast-grep in batches of 500", () => {
  const logDirectory = mkdtempSync(join(tmpdir(), "codemaster-log-"));
  const logPath = join(logDirectory, "arguments.log");
  try {
    withFakeBinary(`echo "$#" >> "${logPath}"`, () =>
      scanWithRules({ pluginRoot: PLUGIN_ROOT, projectRoot: tmpdir(), files: numberedFiles(1201) }),
    );
    const prefixArguments = 5;
    const counts = readFileSync(logPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => Number(line) - prefixArguments);
    assert.deepEqual(counts, [500, 500, 201]);
  } finally {
    rmSync(logDirectory, { recursive: true, force: true });
  }
});

test("scanWithRules groups a large file list by language in linear time", () => {
  const files = Array.from({ length: 40000 }, (_, position) => `src/file${position}.${position % 2 === 0 ? "ts" : "js"}`);
  const started = performance.now();
  withFakeBinary("exit 0", () => scanWithRules({ pluginRoot: PLUGIN_ROOT, projectRoot: tmpdir(), files }));
  const elapsed = Math.round(performance.now() - started);
  assert.ok(elapsed < 2000, `took ${elapsed} ms`);
});
