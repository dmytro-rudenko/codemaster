import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import { CONFIG_DEFAULTS } from "../../../src/consts/config.ts";
import { checkSimplePackages, checkTestMirror } from "../../../src/helpers/logic/project-rules.ts";
import type { ConfigProject } from "../../../src/interfaces/config.ts";
import type { RoleFile, RoleLayout, RoleName } from "../../../src/interfaces/role.ts";

const createdDirectories: string[] = [];

after(() => {
  for (const directory of createdDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createProject(files: Record<string, string>): string {
  const projectRoot = mkdtempSync(join(os.tmpdir(), "codemaster-project-rules-"));
  createdDirectories.push(projectRoot);
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(projectRoot, relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content);
  }
  return projectRoot;
}

function roleOf(path: string, role: RoleName): RoleFile {
  return { path, role, entity: null, global: false };
}

function mirrorFindings(
  files: Record<string, string>,
  role: RoleFile,
  layout: RoleLayout,
  overrides: Partial<ConfigProject> = {},
) {
  const projectRoot = createProject(files);
  return checkTestMirror({ projectRoot, role, layout, config: { ...CONFIG_DEFAULTS, ...overrides } });
}

function packageFindings(manifest: string | null, overrides: Partial<ConfigProject> = {}) {
  const projectRoot = createProject(manifest === null ? {} : { "package.json": manifest });
  return checkSimplePackages({ projectRoot, config: { ...CONFIG_DEFAULTS, ...overrides } });
}

test("test-mirror: layered module without a test is an error naming the expected path", () => {
  const findings = mirrorFindings({ "src/modules/user.ts": "" }, roleOf("src/modules/user.ts", "module"), "layered");
  assert.deepEqual(findings, [
    {
      severity: "error",
      ruleId: "test-mirror",
      file: "src/modules/user.ts",
      line: 1,
      message: "missing test tests/modules/user.test.ts",
    },
  ]);
});

test("test-mirror: layered module with tests/modules/user.spec.ts has no finding", () => {
  const findings = mirrorFindings(
    { "src/modules/user.ts": "", "tests/modules/user.spec.ts": "" },
    roleOf("src/modules/user.ts", "module"),
    "layered",
  );
  assert.deepEqual(findings, []);
});

test("test-mirror: layered module with tests/modules/user.test.ts has no finding", () => {
  const findings = mirrorFindings(
    { "src/modules/user.ts": "", "tests/modules/user.test.ts": "" },
    roleOf("src/modules/user.ts", "module"),
    "layered",
  );
  assert.deepEqual(findings, []);
});

test("test-mirror: a test beside the source does not satisfy the layered tests folder", () => {
  const findings = mirrorFindings(
    { "src/modules/user.ts": "", "src/modules/user.test.ts": "" },
    roleOf("src/modules/user.ts", "module"),
    "layered",
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].message, "missing test tests/modules/user.test.ts");
});

test("test-mirror: the mirror may use any source extension", () => {
  const findings = mirrorFindings(
    { "src/modules/user.ts": "", "tests/modules/user.test.js": "" },
    roleOf("src/modules/user.ts", "module"),
    "layered",
  );
  assert.deepEqual(findings, []);
});

test("test-mirror: the path under the tests folder is relative to a custom sourceRoot", () => {
  const findings = mirrorFindings(
    { "lib/modules/user.ts": "" },
    roleOf("lib/modules/user.ts", "module"),
    "layered",
    { sourceRoot: "lib" },
  );
  assert.equal(findings[0].message, "missing test tests/modules/user.test.ts");
});

test("test-mirror: nested helper path is mirrored under the tests folder", () => {
  const findings = mirrorFindings(
    { "src/helpers/logic/naming.ts": "" },
    roleOf("src/helpers/logic/naming.ts", "helper"),
    "layered",
  );
  assert.equal(findings[0].message, "missing test tests/helpers/logic/naming.test.ts");
});

test("test-mirror: modular colocated project expects the test beside the file", () => {
  const findings = mirrorFindings({ "src/user/user.ts": "" }, roleOf("src/user/user.ts", "module"), "modular");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].message, "missing test src/user/user.test.ts");
});

test("test-mirror: colocated with testSuffix spec expects user.spec.ts", () => {
  const findings = mirrorFindings(
    { "src/modules/user.ts": "" },
    roleOf("src/modules/user.ts", "module"),
    "modular",
    { testSuffix: "spec" },
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].message, "missing test src/modules/user.spec.ts");
});

test("test-mirror: colocated with testSuffix spec accepts user.spec.ts", () => {
  const findings = mirrorFindings(
    { "src/modules/user.ts": "", "src/modules/user.spec.ts": "" },
    roleOf("src/modules/user.ts", "module"),
    "modular",
    { testSuffix: "spec" },
  );
  assert.deepEqual(findings, []);
});

test("test-mirror: colocated with testSuffix spec also accepts user.test.ts", () => {
  const findings = mirrorFindings(
    { "src/modules/user.ts": "", "src/modules/user.test.ts": "" },
    roleOf("src/modules/user.ts", "module"),
    "modular",
    { testSuffix: "spec" },
  );
  assert.deepEqual(findings, []);
});

test("test-mirror: colocated with testSuffix test also accepts user.spec.ts", () => {
  const findings = mirrorFindings(
    { "src/modules/user.ts": "", "src/modules/user.spec.ts": "" },
    roleOf("src/modules/user.ts", "module"),
    "modular",
    { testSuffix: "test" },
  );
  assert.deepEqual(findings, []);
});

test("test-mirror: an explicit colocated testsLocation puts the test beside the file even when layered", () => {
  const findings = mirrorFindings(
    { "src/modules/user.ts": "" },
    roleOf("src/modules/user.ts", "module"),
    "layered",
    { testsLocation: "colocated" },
  );
  assert.equal(findings[0].message, "missing test src/modules/user.test.ts");
});

test("test-mirror: layered with __tests__ and spec expects __tests__/modules/user.spec.ts", () => {
  const findings = mirrorFindings(
    { "src/modules/user.ts": "" },
    roleOf("src/modules/user.ts", "module"),
    "layered",
    { testsLocation: "__tests__", testSuffix: "spec" },
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].message, "missing test __tests__/modules/user.spec.ts");
});

test("test-mirror: layered with __tests__ and spec accepts __tests__/modules/user.spec.ts", () => {
  const findings = mirrorFindings(
    { "src/modules/user.ts": "", "__tests__/modules/user.spec.ts": "" },
    roleOf("src/modules/user.ts", "module"),
    "layered",
    { testsLocation: "__tests__", testSuffix: "spec" },
  );
  assert.deepEqual(findings, []);
});

test("test-mirror: a test under tests/ does not satisfy a custom testsLocation", () => {
  const findings = mirrorFindings(
    { "src/modules/user.ts": "", "tests/modules/user.spec.ts": "" },
    roleOf("src/modules/user.ts", "module"),
    "layered",
    { testsLocation: "__tests__", testSuffix: "spec" },
  );
  assert.equal(findings.length, 1);
});

test("test-mirror: module and single-file-module roles are errors", () => {
  for (const role of ["module", "single-file-module"] as const) {
    const findings = mirrorFindings({ "src/modules/user.ts": "" }, roleOf("src/modules/user.ts", role), "layered");
    assert.equal(findings.length, 1, role);
    assert.equal(findings[0].severity, "error", role);
  }
});

test("test-mirror: helper and util roles are warnings", () => {
  for (const role of ["helper", "util"] as const) {
    const findings = mirrorFindings({ "src/utils/slug.ts": "" }, roleOf("src/utils/slug.ts", role), "layered");
    assert.equal(findings.length, 1, role);
    assert.equal(findings[0].severity, "warning", role);
    assert.equal(findings[0].message, "missing test tests/utils/slug.test.ts", role);
  }
});

test("test-mirror: roles that need no test produce no finding", () => {
  for (const role of ["interfaces", "consts", "test", "entrypoint", "other"] as const) {
    const findings = mirrorFindings({ "src/modules/user.ts": "" }, roleOf("src/modules/user.ts", role), "layered");
    assert.deepEqual(findings, [], role);
  }
});

test("test-mirror: a tsx module expects a tsx mirror", () => {
  const findings = mirrorFindings(
    { "src/modules/panel.tsx": "" },
    roleOf("src/modules/panel.tsx", "module"),
    "layered",
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].message, "missing test tests/modules/panel.test.tsx");
});

test("test-mirror: a tsx module accepts a .test.tsx mirror", () => {
  const findings = mirrorFindings(
    { "src/modules/panel.tsx": "", "tests/modules/panel.test.tsx": "" },
    roleOf("src/modules/panel.tsx", "module"),
    "layered",
  );
  assert.deepEqual(findings, []);
});

test("test-mirror: a tsx module accepts a .test.ts mirror", () => {
  const findings = mirrorFindings(
    { "src/modules/panel.tsx": "", "tests/modules/panel.test.ts": "" },
    roleOf("src/modules/panel.tsx", "module"),
    "layered",
  );
  assert.deepEqual(findings, []);
});

test("simple-package: axios on line 3 of package.json is reported at line 3", () => {
  const manifest = ["{", '  "dependencies": {', '    "axios": "1.7.0"', "  }", "}", ""].join("\n");
  assert.deepEqual(packageFindings(manifest), [
    {
      severity: "warning",
      ruleId: "simple-package",
      file: "package.json",
      line: 3,
      message: "axios: write simple HTTP code yourself (fetch)",
    },
  ]);
});

test("simple-package: axios in devDependencies and got in dependencies give two findings at their key lines", () => {
  const manifest = [
    "{",
    '  "devDependencies": {',
    '    "axios": "1.7.0"',
    "  },",
    '  "dependencies": {',
    '    "got": "14.0.0"',
    "  }",
    "}",
    "",
  ].join("\n");
  const findings = packageFindings(manifest);
  const summary = findings.map((finding) => `${finding.line}:${finding.message}`).sort();
  assert.deepEqual(summary, [
    "3:axios: write simple HTTP code yourself (fetch)",
    "6:got: write simple HTTP code yourself (fetch)",
  ]);
  for (const finding of findings) {
    assert.equal(finding.file, "package.json");
    assert.equal(finding.ruleId, "simple-package");
  }
});

test("simple-package: packages outside simplePackages are not reported", () => {
  const manifest = ["{", '  "dependencies": {', '    "left-pad": "1.3.0"', "  }", "}", ""].join("\n");
  assert.deepEqual(packageFindings(manifest), []);
});

test("simple-package: simplePackages from the config decide what is reported", () => {
  const manifest = ["{", '  "dependencies": {', '    "left-pad": "1.3.0",', '    "axios": "1.7.0"', "  }", "}", ""].join(
    "\n",
  );
  const findings = packageFindings(manifest, { simplePackages: ["left-pad"] });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 3);
  assert.equal(findings[0].message, "left-pad: write simple HTTP code yourself (fetch)");
});

test("simple-package: a project without package.json has no findings", () => {
  assert.deepEqual(packageFindings(null), []);
});

test("simple-package: each package in a multi-line block is reported at its own key line", () => {
  const manifest = [
    "{",
    '  "dependencies": {',
    '    "left-pad": "1.3.0",',
    '    "axios": "1.7.0",',
    '    "got": "14.0.0"',
    "  }",
    "}",
    "",
  ].join("\n");
  const lines = packageFindings(manifest).map((finding) => `${finding.line}:${finding.message}`);
  assert.deepEqual(lines, [
    "4:axios: write simple HTTP code yourself (fetch)",
    "5:got: write simple HTTP code yourself (fetch)",
  ]);
});

test("simple-package: a package named like its section is reported at its key line, not the section line", () => {
  const manifest = ["{", '  "dependencies": {', '    "dependencies": "1.0.0"', "  }", "}", ""].join("\n");
  const findings = packageFindings(manifest, { simplePackages: ["dependencies"] });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 3);
});

test("simple-package: a block written on the section line falls back to the section key line", () => {
  const manifest = ["{", '  "dependencies": { "axios": "1.7.0" }', "}", ""].join("\n");
  const findings = packageFindings(manifest);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 2);
});

test("simple-package: a minified package.json falls back to line 1", () => {
  const findings = packageFindings('{"dependencies":{"axios":"1.7.0"}}');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 1);
});

test("simple-package: a package listed in both sections is reported once", () => {
  const manifest = [
    "{",
    '  "devDependencies": {',
    '    "axios": "1.7.0"',
    "  },",
    '  "dependencies": {',
    '    "axios": "1.7.0"',
    "  }",
    "}",
    "",
  ].join("\n");
  const findings = packageFindings(manifest);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].message, "axios: write simple HTTP code yourself (fetch)");
});

test("simple-package: a package.json holding null has no findings", () => {
  assert.deepEqual(packageFindings("null"), []);
});

test("simple-package: an invalid package.json has no findings", () => {
  assert.deepEqual(packageFindings('{ "dependencies": { "axios": '), []);
});

test("test-mirror: with a list of source roots the tests path is relative to the root holding the file", () => {
  const findings = mirrorFindings(
    { "api/src/modules/user.ts": "" },
    roleOf("api/src/modules/user.ts", "module"),
    "layered",
    { sourceRoot: ["web/src", "api/src"] },
  );
  assert.equal(findings[0].message, "missing test tests/modules/user.test.ts");
});
