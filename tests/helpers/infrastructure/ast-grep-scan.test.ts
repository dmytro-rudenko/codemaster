import { before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
