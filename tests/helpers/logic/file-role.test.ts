import { after, test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import { CONFIG_DEFAULTS } from "../../../src/consts/config.ts";
import { detectLayout, resolveFileRole } from "../../../src/helpers/logic/file-role.ts";
import type { ConfigProject } from "../../../src/interfaces/config.ts";
import type { RoleLayout } from "../../../src/interfaces/role.ts";

const FIXTURES_ROOT = join(import.meta.dirname, "../../fixtures");
const createdDirectories: string[] = [];

after(() => {
  for (const directory of createdDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createDirectory(): string {
  const directory = mkdtempSync(join(os.tmpdir(), "codemaster-file-role-"));
  createdDirectories.push(directory);
  return directory;
}

function copyFixtureDirectory(name: string): string {
  const directory = createDirectory();
  cpSync(join(FIXTURES_ROOT, name), directory, { recursive: true });
  return directory;
}

function createProject(files: string[]): string {
  const directory = createDirectory();
  for (const file of files) {
    mkdirSync(join(directory, dirname(file)), { recursive: true });
    writeFileSync(join(directory, file), "export const value = 1;\n");
  }
  return directory;
}

function roleOf(path: string, layout: RoleLayout, config: ConfigProject = CONFIG_DEFAULTS) {
  const { role, entity, global } = resolveFileRole(path, { layout, config });
  return { role, entity, global };
}

test("modular roles", () => {
  assert.deepEqual(roleOf("src/user/user.interfaces.ts", "modular"), { role: "interfaces", entity: "user", global: false });
  assert.deepEqual(roleOf("src/user/types.ts", "modular"), { role: "interfaces", entity: "user", global: false });
  assert.deepEqual(roleOf("src/user/user.service.ts", "modular"), { role: "module", entity: "user", global: false });
  assert.deepEqual(roleOf("src/user/interfaces/a.ts", "modular"), { role: "interfaces", entity: "user", global: false });
  assert.deepEqual(roleOf("src/modules/user.ts", "modular"), { role: "module", entity: "modules", global: false });
  assert.equal(roleOf("src/report.ts", "modular").role, "single-file-module");
  assert.deepEqual(
    { role: roleOf("src/global/consts.ts", "modular").role, global: roleOf("src/global/consts.ts", "modular").global },
    { role: "consts", global: true },
  );
  assert.equal(roleOf("src/utils/format.ts", "modular").role, "util");
  assert.equal(roleOf("scripts/run.ts", "modular").role, "other");
});

test("modular: only the global entity folder is global", () => {
  assert.equal(roleOf("src/global/types.ts", "modular").global, true);
  assert.equal(roleOf("src/user/user.consts.ts", "modular").global, false);
});

test("layered roles", () => {
  assert.deepEqual(roleOf("src/modules/user.ts", "layered"), { role: "single-file-module", entity: "user", global: false });
  assert.deepEqual(roleOf("src/modules/order/order.ts", "layered"), { role: "module", entity: "order", global: false });
  const globalConsts = roleOf("src/consts/global.ts", "layered");
  assert.equal(globalConsts.role, "consts");
  assert.equal(globalConsts.global, true);
  assert.equal(roleOf("src/helpers/fetch-user.ts", "layered").role, "helper");
  assert.equal(roleOf("src/utils/format.ts", "layered").role, "util");
  assert.deepEqual(roleOf("src/consts/user.ts", "layered"), { role: "consts", entity: "user", global: false });
  assert.equal(roleOf("tests/modules/user.test.ts", "layered").role, "test");
});

test("layered: a file directly in sourceRoot is a single-file module", () => {
  assert.equal(roleOf("src/report.ts", "layered").role, "single-file-module");
});

test("layered: custom roles map the project's own folder names", () => {
  const config: ConfigProject = { ...CONFIG_DEFAULTS, roles: { ...CONFIG_DEFAULTS.roles, interfaces: ["types"] } };
  assert.deepEqual(roleOf("src/types/user.ts", "layered", config), { role: "interfaces", entity: "user", global: false });
});

test("layout off: every non-test file is a module without entity", () => {
  assert.deepEqual(roleOf("src/pages/home.ts", "off"), { role: "module", entity: null, global: false });
  assert.deepEqual(roleOf("src/report.ts", "off"), { role: "module", entity: null, global: false });
  assert.equal(roleOf("src/pages/home.test.ts", "off").role, "test");
  assert.equal(roleOf("bin/codemaster.ts", "off").role, "entrypoint");
});

test("entrypoints", () => {
  assert.equal(roleOf("bin/codemaster.ts", "layered").role, "entrypoint");
  assert.equal(roleOf("src/index.ts", "modular").role, "entrypoint");
  assert.equal(roleOf("src/main.ts", "layered").role, "entrypoint");
  assert.equal(roleOf("src/user/index.ts", "modular").role, "module");
});

test("tests win over entrypoints", () => {
  assert.equal(roleOf("bin/codemaster.test.ts", "layered").role, "test");
});

test("test files are recognised by suffix and by folder", () => {
  assert.equal(roleOf("src/user/user.test.ts", "modular").role, "test");
  assert.equal(roleOf("src/user/user.spec.ts", "modular").role, "test");
  assert.equal(roleOf("test/user.ts", "modular").role, "test");
  assert.equal(roleOf("__tests__/user.ts", "modular").role, "test");
  assert.equal(roleOf("tests/user/user.ts", "layered").role, "test");
});

test("testsLocation marks its folder as tests", () => {
  const config: ConfigProject = { ...CONFIG_DEFAULTS, testsLocation: "e2e" };
  assert.equal(roleOf("e2e/flow.ts", "modular", config).role, "test");
  assert.equal(roleOf("e2e/flow.ts", "modular").role, "other");
});

test("empty testsLocation leaves only suffixes and conventional folders", () => {
  const config: ConfigProject = { ...CONFIG_DEFAULTS, testsLocation: "" };
  assert.equal(roleOf("tests/user.ts", "modular", config).role, "test");
  assert.equal(roleOf("src/user/user.test.ts", "modular", config).role, "test");
  assert.equal(roleOf("e2e/flow.ts", "modular", config).role, "other");
  assert.equal(roleOf("src/user/e2e.ts", "modular", config).role, "module");
});

test("the resolved file keeps its path", () => {
  const file = resolveFileRole("src/user/user.service.ts", { layout: "modular", config: CONFIG_DEFAULTS });
  assert.equal(file.path, "src/user/user.service.ts");
});

test("layout detection", () => {
  assert.equal(detectLayout(copyFixtureDirectory("layered"), CONFIG_DEFAULTS), "layered");
  assert.equal(detectLayout(copyFixtureDirectory("modular"), CONFIG_DEFAULTS), "modular");
  assert.equal(detectLayout(copyFixtureDirectory("off"), CONFIG_DEFAULTS), "off");
});

test("layout detection: an explicit layout wins over the file tree", () => {
  const forcedLayered: ConfigProject = { ...CONFIG_DEFAULTS, layout: "layered" };
  const forcedOff: ConfigProject = { ...CONFIG_DEFAULTS, layout: "off" };
  const forcedModular: ConfigProject = { ...CONFIG_DEFAULTS, layout: "modular" };
  assert.equal(detectLayout(copyFixtureDirectory("modular"), forcedLayered), "layered");
  assert.equal(detectLayout(copyFixtureDirectory("layered"), forcedOff), "off");
  assert.equal(detectLayout(copyFixtureDirectory("off"), forcedModular), "modular");
});

test("layout detection: layout auto detects from the tree", () => {
  const auto: ConfigProject = { ...CONFIG_DEFAULTS, layout: "auto" };
  assert.equal(detectLayout(copyFixtureDirectory("layered"), auto), "layered");
});

test("layout detection: one role folder is not enough for layered", () => {
  const projectRoot = createProject(["src/helpers/fetch.ts", "src/pages/home.ts"]);
  assert.equal(detectLayout(projectRoot, CONFIG_DEFAULTS), "off");
});

test("layout detection: aliases of one role count as a single role", () => {
  const projectRoot = createProject(["src/modules/user.ts", "src/services/mail.ts"]);
  assert.equal(detectLayout(projectRoot, CONFIG_DEFAULTS), "off");
});

test("layout detection: two distinct role folders make layered", () => {
  const projectRoot = createProject(["src/modules/user.ts", "src/consts/user.ts"]);
  assert.equal(detectLayout(projectRoot, CONFIG_DEFAULTS), "layered");
});

test("layout detection: entity folders holding role files make modular", () => {
  const projectRoot = createProject(["src/user/user.interfaces.ts", "src/user/user.service.ts"]);
  assert.equal(detectLayout(projectRoot, CONFIG_DEFAULTS), "modular");
});

test("layout detection: custom role names count for layered", () => {
  const config: ConfigProject = { ...CONFIG_DEFAULTS, roles: { ...CONFIG_DEFAULTS.roles, interfaces: ["shapes"] } };
  const projectRoot = createProject(["src/shapes/user.ts", "src/consts/user.ts"]);
  assert.equal(detectLayout(projectRoot, config), "layered");
  assert.equal(detectLayout(projectRoot, CONFIG_DEFAULTS), "off");
});
