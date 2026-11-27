import { before, test } from "node:test";
import assert from "node:assert/strict";
import { ensureInstalled } from "../../../src/modules/install.ts";
import { parseSource } from "../../../src/helpers/infrastructure/ast-grep.ts";
import {
  checkDeclarations,
  collectDeclarations,
  isDataInitializer,
} from "../../../src/helpers/logic/declaration-rules.ts";
import { CONFIG_DEFAULTS } from "../../../src/consts/config.ts";
import { CHECK_RULE_SEVERITY } from "../../../src/consts/check.ts";
import type { ConfigProject } from "../../../src/interfaces/config.ts";
import type { FindingItem } from "../../../src/interfaces/finding.ts";
import type { RoleFile, RoleName } from "../../../src/interfaces/role.ts";

const MODULAR_CONFIG: ConfigProject = { ...CONFIG_DEFAULTS, layout: "modular" };

const OFF_CONFIG: ConfigProject = { ...CONFIG_DEFAULTS, layout: "off" };

const LAYOUT_RULES = [
  "layout-forbidden-declaration",
  "helpers-only-functions",
  "single-file-module-size",
  "helpers-mixed-kind",
  "name-entity-prefix",
];

function roleFor(role: RoleName, path: string, entity: string | null = null, global = false): RoleFile {
  return { path, role, entity, global };
}

async function checkSource(text: string, role: RoleFile, config: ConfigProject = MODULAR_CONFIG) {
  const root = (await parseSource(role.path, text)).root();
  return checkDeclarations({ path: role.path, text, root, role, config });
}

function ruleFindings(findings: FindingItem[], ruleId: string): FindingItem[] {
  return findings.filter((finding) => finding.ruleId === ruleId);
}

function expectOne(findings: FindingItem[], ruleId: string, path: string): FindingItem {
  const matched = ruleFindings(findings, ruleId);
  assert.equal(matched.length, 1, JSON.stringify(findings, null, 2));
  assert.equal(matched[0].severity, CHECK_RULE_SEVERITY[ruleId]);
  assert.equal(matched[0].file, path);
  return matched[0];
}

function expectNone(findings: FindingItem[], ruleId: string): void {
  assert.deepEqual(ruleFindings(findings, ruleId), [], JSON.stringify(findings, null, 2));
}

async function valueNodeOf(expression: string) {
  const root = (await parseSource("value.ts", `const sample = ${expression};`)).root();
  const declarator = root.find({ rule: { kind: "variable_declarator" } });
  assert.ok(declarator, `no declarator for ${expression}`);
  const valueNode = declarator.field("value");
  assert.ok(valueNode, `no value for ${expression}`);
  return valueNode;
}

function numberedFunctions(count: number, separator: string): string {
  return Array.from({ length: count }, (_, position) => `export function step${position}() { return ${position}; }`).join(
    separator,
  );
}

before(() => {
  const outcome = ensureInstalled();
  assert.equal(outcome.ok, true, `install failed: ${outcome.message}`);
});

const DATA_CASES: [string, boolean][] = [
  ["5", true],
  ['["a"] as const', true],
  ["Object.freeze({a:1})", true],
  ["Router()", false],
  ["new Map()", false],
  ["{ create() {} }", false],
  ["`plain text`", true],
  ["`user ${name}`", false],
  ["-1", true],
  ["-limit", false],
  ["!0", false],
  ["/a+/", true],
  ["null", true],
  ['[1, ["a"]]', true],
  ["[limit]", false],
  ["{ a: 1 } satisfies object", true],
  ["Object.freeze(1, 2)", false],
  ["Object.assign({})", false],
];

for (const [expression, expected] of DATA_CASES) {
  test(`isDataInitializer(${expression}) is ${expected}`, async () => {
    assert.equal(isDataInitializer(await valueNodeOf(expression)), expected);
  });
}

test("collectDeclarations classifies top-level declarations and unwraps exports", async () => {
  const text = [
    "export const USER_LIMIT = 5;",
    "let counter = 0;",
    "const build = () => 1;",
    "const router = Router();",
    "export interface UserShape { name: string }",
    "type Alias = string;",
    "enum Color { Red }",
    "class Store {}",
    "export function run() { return 1; }",
  ].join("\n");
  const root = (await parseSource("sample.ts", text)).root();
  const collected = collectDeclarations(root).map(({ kind, name, line }) => ({ kind, name, line }));
  assert.deepEqual(collected, [
    { kind: "constant", name: "USER_LIMIT", line: 1 },
    { kind: "data-variable", name: "counter", line: 2 },
    { kind: "function", name: "build", line: 3 },
    { kind: "object", name: "router", line: 4 },
    { kind: "interface", name: "UserShape", line: 5 },
    { kind: "type", name: "Alias", line: 6 },
    { kind: "enum", name: "Color", line: 7 },
    { kind: "class", name: "Store", line: 8 },
    { kind: "function", name: "run", line: 9 },
  ]);
});

test("layout-forbidden-declaration fires on a constant in a module and names the consts folder", async () => {
  const role = roleFor("module", "src/user/user.service.ts", "user");
  const text = "export function createUser() { return 1; }\n\nexport const USER_LIMIT = 5;\n";
  const found = expectOne(await checkSource(text, role), "layout-forbidden-declaration", role.path);
  assert.equal(found.line, 3);
  assert.equal(found.message, "constant USER_LIMIT belongs in consts");
});

test("layout-forbidden-declaration stays silent on objects and functions in a module", async () => {
  const role = roleFor("module", "src/user/user.service.ts", "user");
  const text = "export const router = Router();\nexport const store = new Map();\nexport function createUser() { return router; }\n";
  expectNone(await checkSource(text, role), "layout-forbidden-declaration");
});

for (const roleName of ["module", "helper", "util"] as const) {
  test(`layout-forbidden-declaration fires on a type alias in role ${roleName}`, async () => {
    const role = roleFor(roleName, `src/user/user.${roleName}.ts`, "user");
    expectOne(await checkSource("export type UserName = string;\n", role), "layout-forbidden-declaration", role.path);
  });
}

test("layout-forbidden-declaration message names the project's interfaces folder", async () => {
  const role = roleFor("module", "src/user/user.service.ts", "user");
  const config: ConfigProject = { ...MODULAR_CONFIG, roles: { ...MODULAR_CONFIG.roles, interfaces: ["types"] } };
  const found = expectOne(
    await checkSource("export interface UserShape { name: string }\n", role, config),
    "layout-forbidden-declaration",
    role.path,
  );
  assert.ok(found.message.includes("types"), found.message);
  assert.ok(found.message.includes("UserShape"), found.message);
});

test("helpers-only-functions fires on a class in a helper", async () => {
  const role = roleFor("helper", "src/user/user.helpers.ts", "user");
  const found = expectOne(await checkSource("export class UserStore {}\n", role), "helpers-only-functions", role.path);
  assert.equal(found.line, 1);
});

test("helpers-only-functions fires on an object in a util", async () => {
  const role = roleFor("util", "src/utils/format.ts");
  expectOne(await checkSource("export const formatCache = new Map();\n", role), "helpers-only-functions", role.path);
});

test("helpers-only-functions stays silent on function declarations and arrow constants", async () => {
  const role = roleFor("helper", "src/user/user.helpers.ts", "user");
  const text =
    "export function formatName(name: string) { return name; }\nexport const trimName = (name: string) => name.trim();\nexport const padName = function (name: string) { return name; };\n";
  expectNone(await checkSource(text, role), "helpers-only-functions");
});

test("single-file-module-size fires on a large single-file module with a constant", async () => {
  const role = roleFor("single-file-module", "src/big.ts");
  const text = `export const BIG_LIMIT = 5;\n${numberedFunctions(150, "\n")}\n`;
  const findings = await checkSource(text, role);
  const found = expectOne(findings, "single-file-module-size", role.path);
  assert.equal(found.line, 1);
  expectNone(findings, "layout-forbidden-declaration");
});

test("single-file-module-size counts only non-blank lines", async () => {
  const role = roleFor("single-file-module", "src/big.ts");
  const text = `export const BIG_LIMIT = 5;\n\n${numberedFunctions(140, "\n\n")}\n`;
  expectNone(await checkSource(text, role), "single-file-module-size");
});

test("single-file-module-size stays silent on a large single-file module without own declarations", async () => {
  const role = roleFor("single-file-module", "src/big.ts");
  expectNone(await checkSource(`${numberedFunctions(160, "\n")}\n`, role), "single-file-module-size");
});

test("global-function fires on a top-level function in role other", async () => {
  const role = roleFor("other", "scripts/run.ts");
  const found = expectOne(await checkSource("function runScript() { return 1; }\n", role), "global-function", role.path);
  assert.equal(found.line, 1);
});

test("global-function stays silent on a top-level function in module, helper, util and test", async () => {
  for (const roleName of ["module", "single-file-module", "helper", "util", "test"] as const) {
    const role = roleFor(roleName, `src/user/user.${roleName}.ts`, "user");
    expectNone(await checkSource("export function runScript() { return 1; }\n", role), "global-function");
  }
});

test("global-function fires on a top-level function in roles interfaces and consts", async () => {
  for (const roleName of ["interfaces", "consts"] as const) {
    const role = roleFor(roleName, `src/user/user.${roleName}.ts`, "user");
    expectOne(await checkSource("export function buildUser() { return 1; }\n", role), "global-function", role.path);
  }
});

test("global-function allows main in an entrypoint and flags any other top-level function there", async () => {
  const role = roleFor("entrypoint", "bin/codemaster.ts");
  expectNone(await checkSource("export async function main() { return 0; }\n", role), "global-function");
  const text = "export async function main() { return 0; }\nfunction parseFlags() { return 1; }\n";
  const found = expectOne(await checkSource(text, role), "global-function", role.path);
  assert.equal(found.line, 2);
});

test("global-function fires on a function assigned to globalThis, window or global in any role", async () => {
  const role = roleFor("module", "src/user/user.service.ts", "user");
  const sources = [
    "globalThis.runTask = () => 1;\n",
    "window.runTask = function () { return 1; };\n",
    "global.runTask = () => 1;\n",
  ];
  for (const text of sources) {
    expectOne(await checkSource(text, role), "global-function", role.path);
  }
});

test("global-function stays silent on data assigned to globalThis", async () => {
  const role = roleFor("module", "src/user/user.service.ts", "user");
  expectNone(await checkSource("globalThis.counter = 5;\n", role), "global-function");
});

test("global-function stays silent on a function assigned to a plain object member or a variable", async () => {
  const role = roleFor("module", "src/user/user.service.ts", "user");
  for (const text of ["registry.runTask = () => 1;\n", "let runTask;\nrunTask = () => 1;\n", "this.runTask = () => 1;\n"]) {
    expectNone(await checkSource(text, role), "global-function");
  }
});

test("global-function fires on a declare global block with a function member", async () => {
  const role = roleFor("module", "src/user/user.service.ts", "user");
  const text = "declare global {\n  function runTask(): void;\n}\nexport {};\n";
  expectOne(await checkSource(text, role), "global-function", role.path);
});

test("global-function stays silent on a declare global block without functions", async () => {
  const role = roleFor("module", "src/user/user.service.ts", "user");
  const text = "declare global {\n  interface Window { appName: string }\n}\nexport {};\n";
  expectNone(await checkSource(text, role), "global-function");
});

test("helpers-mixed-kind fires on a helper importing an infrastructure package and calling fetch", async () => {
  const role = roleFor("helper", "src/helpers/fetch-user.ts");
  const text = 'import pg from "pg";\nexport async function loadUser() {\n  await fetch("https://example.com");\n  return pg;\n}\n';
  expectOne(await checkSource(text, role), "helpers-mixed-kind", role.path);
});

test("helpers-mixed-kind fires on a helper importing an infrastructure package and calling https.request", async () => {
  const role = roleFor("helper", "src/helpers/send-user.ts");
  const text = 'import { Pool } from "pg";\nexport function sendUser() {\n  return https.request("https://example.com", Pool);\n}\n';
  expectOne(await checkSource(text, role), "helpers-mixed-kind", role.path);
});

test("helpers-mixed-kind fires on a helper mixing fetch functions with pure functions", async () => {
  const role = roleFor("helper", "src/helpers/user.ts");
  const text =
    'export async function loadUser() {\n  return fetch("https://example.com");\n}\nexport function formatUser(name: string) {\n  return name.trim();\n}\n';
  expectOne(await checkSource(text, role), "helpers-mixed-kind", role.path);
});

test("helpers-mixed-kind stays silent on single-kind helpers and on modules", async () => {
  const fetchOnly =
    'export async function loadUser() {\n  return fetch("https://example.com/user");\n}\nexport async function loadOrder() {\n  return fetch("https://example.com/order");\n}\n';
  const storageOnly = 'import pg from "pg";\nexport function openPool() {\n  return pg;\n}\n';
  const helper = roleFor("helper", "src/helpers/user.ts");
  expectNone(await checkSource(fetchOnly, helper), "helpers-mixed-kind");
  expectNone(await checkSource(storageOnly, helper), "helpers-mixed-kind");
  const mixed = 'import pg from "pg";\nexport async function loadUser() {\n  await fetch("https://example.com");\n  return pg;\n}\n';
  expectNone(await checkSource(mixed, roleFor("module", "src/user/user.service.ts", "user")), "helpers-mixed-kind");
});

test("name-abbreviation fires on an abbreviated parameter", async () => {
  const role = roleFor("module", "src/user/user.service.ts", "user");
  const found = expectOne(
    await checkSource("\nexport function loadUser(cfg: string) { return cfg; }\n", role),
    "name-abbreviation",
    role.path,
  );
  assert.equal(found.line, 2);
});

test("name-abbreviation stays silent on full words and allowlisted ones", async () => {
  const role = roleFor("module", "src/user/user.service.ts", "user");
  const text = "export function loadUser(userId: string, setting: string) { const apiUrl = setting; return apiUrl + userId; }\n";
  expectNone(await checkSource(text, role), "name-abbreviation");
});

test("name-abbreviation fires on a variable inside a function, a class, a method and a single letter", async () => {
  const role = roleFor("module", "src/user/user.service.ts", "user");
  const sources = [
    "export function loadUser() {\n  const tmp = 1;\n  return tmp;\n}\n",
    "export class UserMgr {}\n",
    "export class UserStore {\n  loadCfg() { return 1; }\n}\n",
    "export function loadUser(x: number) { return x; }\n",
  ];
  for (const text of sources) {
    expectOne(await checkSource(text, role), "name-abbreviation", role.path);
  }
});

test("name-abbreviation reports an abbreviated arrow constant once", async () => {
  const role = roleFor("helper", "src/user/user.helpers.ts", "user");
  expectOne(await checkSource("export const loadCfg = () => 1;\n", role), "name-abbreviation", role.path);
});

test("name-abbreviation fires on a bare arrow parameter and an optional parameter", async () => {
  const role = roleFor("module", "src/user/user.service.ts", "user");
  for (const text of ["export const loadUser = cfg => cfg;\n", "export function loadUser(cfg?: string) { return cfg; }\n"]) {
    assert.equal(expectOne(await checkSource(text, role), "name-abbreviation", role.path).message, "cfg contains abbreviation cfg");
  }
});

for (const extension of [".js", ".jsx", ".mjs", ".cjs"]) {
  test(`checkDeclarations on a ${extension} source reports max-params and name-abbreviation without throwing`, async () => {
    const role = roleFor("module", `src/user/user.service${extension}`, "user");
    const text = "export function loadUser(first, second, third, fourth, fifth, sixth) {\n  const cfg = first;\n  return cfg;\n}\n";
    const findings = await checkSource(text, role);
    expectOne(findings, "max-params", role.path);
    assert.equal(expectOne(findings, "name-abbreviation", role.path).message, "cfg contains abbreviation cfg");
  });
}

test("name-abbreviation fires on a bare and a defaulted parameter of a JavaScript function", async () => {
  const role = roleFor("module", "src/user/user.service.js", "user");
  for (const text of ["export function loadUser(cfg) { return cfg; }\n", "export function loadUser(cfg = 1) { return cfg; }\n"]) {
    assert.equal(expectOne(await checkSource(text, role), "name-abbreviation", role.path).message, "cfg contains abbreviation cfg");
  }
});

test("name-abbreviation skips destructured parameters", async () => {
  const role = roleFor("module", "src/user/user.service.ts", "user");
  expectNone(await checkSource("export function loadUser({ cfg }: { cfg: string }, [tmp]: string[]) { return cfg + tmp; }\n", role), "name-abbreviation");
});

test("name-word-count fires on a name of more than three words", async () => {
  const role = roleFor("module", "src/user/user.service.ts", "user");
  const found = expectOne(
    await checkSource("export function loadActiveUserProfile() { return 1; }\n", role),
    "name-word-count",
    role.path,
  );
  assert.equal(found.line, 1);
});

test("name-word-count stays silent on three words", async () => {
  const role = roleFor("module", "src/user/user.service.ts", "user");
  expectNone(await checkSource("export function loadUserProfile() { return 1; }\n", role), "name-word-count");
});

test("name-word-count does not count the entity prefix", async () => {
  const role = roleFor("consts", "src/user/user.consts.ts", "user");
  expectNone(await checkSource("export const USER_MAX_LOGIN_ATTEMPTS = 5;\n", role), "name-word-count");
  expectOne(
    await checkSource("export const USER_MAX_LOGIN_RETRY_ATTEMPTS = 5;\n", role),
    "name-word-count",
    role.path,
  );
});

test("name-entity-prefix fires on a constant without the entity prefix", async () => {
  const role = roleFor("consts", "src/user/user.consts.ts", "user");
  const found = expectOne(await checkSource("export const MAX_LOGIN = 5;\n", role), "name-entity-prefix", role.path);
  assert.equal(found.line, 1);
  assert.ok(found.message.includes("USER_"), found.message);
});

test("name-entity-prefix stays silent on a prefixed constant", async () => {
  const role = roleFor("consts", "src/user/user.consts.ts", "user");
  expectNone(await checkSource("export const USER_MAX_LOGIN = 5;\n", role), "name-entity-prefix");
});

test("name-entity-prefix fires on an interface without the entity prefix and is silent with it", async () => {
  const role = roleFor("interfaces", "src/user/user.interfaces.ts", "user");
  expectOne(await checkSource("export interface Shape { name: string }\n", role), "name-entity-prefix", role.path);
  expectNone(await checkSource("export interface UserShape { name: string }\n", role), "name-entity-prefix");
});

test("name-entity-prefix uses no entity for a global file", async () => {
  const role = roleFor("consts", "src/consts/global.ts", null, true);
  expectNone(await checkSource("export const MAX_LOGIN = 5;\n", role), "name-entity-prefix");
  expectOne(await checkSource("export const maxLogin = 5;\n", role), "name-entity-prefix", role.path);
});

test("max-params fires on six parameters with the spec message", async () => {
  const role = roleFor("module", "src/user/user.service.ts", "user");
  const text =
    "\n\nexport function createUser(first: string, second: string, third: string, fourth: string, fifth: string, sixth: string) { return first; }\n";
  const found = expectOne(await checkSource(text, role), "max-params", role.path);
  assert.equal(found.line, 3);
  assert.equal(found.message, "function createUser has 6 parameters (max 5)");
});

test("max-params stays silent on five parameters", async () => {
  const role = roleFor("module", "src/user/user.service.ts", "user");
  const text =
    "export function createUser(first: string, second: string, third: string, fourth: string, fifth: string) { return first; }\n";
  expectNone(await checkSource(text, role), "max-params");
});

test("a max-params setting of null falls back to the default limit instead of throwing", async () => {
  const role = roleFor("module", "src/user/user.service.ts", "user");
  const text =
    "export function createUser(first: string, second: string, third: string, fourth: string, fifth: string, sixth: string) { return first; }\n";
  const config = { ...MODULAR_CONFIG, rules: { "max-params": null } } as unknown as ConfigProject;
  expectOne(await checkSource(text, role, config), "max-params", role.path);
});

test("a max-params object setting raises the limit", async () => {
  const role = roleFor("module", "src/user/user.service.ts", "user");
  const text =
    "export function createUser(first: string, second: string, third: string, fourth: string, fifth: string, sixth: string) { return first; }\n";
  const config = { ...MODULAR_CONFIG, rules: { "max-params": { max: 6 } } };
  expectNone(await checkSource(text, role, config), "max-params");
});

const DEEP_BLOCKS_SOURCE = [
  "export function walkOrders(orders: number[]) {",
  "  let total = 0;",
  "  if (orders.length > 0) {",
  "    while (total < 10) {",
  "      for (const order of orders) {",
  "        if (order > 1) {",
  "          total += order;",
  "        }",
  "      }",
  "      total += 1;",
  "    }",
  "  }",
  "  return total;",
  "}",
  "",
].join("\n");

test("max-nesting fires on four nested blocks at the line of the deepest block", async () => {
  const role = roleFor("module", "src/order/order.service.ts", "order");
  const found = expectOne(await checkSource(DEEP_BLOCKS_SOURCE, role), "max-nesting", role.path);
  assert.equal(found.line, 6);
});

test("max-nesting stays silent on three nested blocks", async () => {
  const role = roleFor("module", "src/order/order.service.ts", "order");
  const text = DEEP_BLOCKS_SOURCE.replace("        if (order > 1) {\n          total += order;\n        }", "        total += order;");
  expectNone(await checkSource(text, role), "max-nesting");
});

test("max-nesting fires on three nested argument callbacks and is silent on two", async () => {
  const role = roleFor("module", "src/order/order.service.ts", "order");
  expectOne(
    await checkSource("export function wrapAll() { alpha(() => beta(() => gamma(() => 1))); }\n", role),
    "max-nesting",
    role.path,
  );
  expectNone(await checkSource("export function wrapAll() { alpha(() => beta(() => 1)); }\n", role), "max-nesting");
});

test("max-nesting fires on a then inside a then callback and is silent on a then chain", async () => {
  const role = roleFor("module", "src/order/order.service.ts", "order");
  const found = expectOne(
    await checkSource("\nloadOrder().then((order) => saveOrder(order).then(() => order));\n", role),
    "max-nesting",
    role.path,
  );
  assert.equal(found.line, 2);
  expectNone(
    await checkSource("loadOrder().then((order) => saveOrder(order)).then((saved) => saved);\n", role),
    "max-nesting",
  );
});

test("max-call-nesting fires on call depth four and is silent on depth three", async () => {
  const role = roleFor("module", "src/old/legacy.ts");
  const found = expectOne(
    await checkSource("\nexport function compute() { return alpha(beta(gamma(delta()))); }\n", role),
    "max-call-nesting",
    role.path,
  );
  assert.equal(found.line, 2);
  expectNone(await checkSource("export function compute() { return alpha(beta(gamma())); }\n", role), "max-call-nesting");
});

test("layout rules stay silent when the layout is off while the other rules still fire", async () => {
  const cases: [string, RoleFile][] = [
    ["export const USER_LIMIT = 5;\n", roleFor("module", "src/user/user.service.ts", "user")],
    ["export class UserStore {}\n", roleFor("helper", "src/user/user.helpers.ts", "user")],
    [`export const BIG_LIMIT = 5;\n${numberedFunctions(160, "\n")}\n`, roleFor("single-file-module", "src/big.ts")],
    [
      'import pg from "pg";\nexport async function loadUser() {\n  await fetch("https://example.com");\n  return pg;\n}\n',
      roleFor("helper", "src/helpers/fetch-user.ts"),
    ],
    ["export const MAX_LOGIN = 5;\n", roleFor("consts", "src/user/user.consts.ts", "user")],
  ];
  for (const [text, role] of cases) {
    const findings = await checkSource(text, role, OFF_CONFIG);
    for (const ruleId of LAYOUT_RULES) {
      expectNone(findings, ruleId);
    }
  }
  const role = roleFor("module", "src/user/user.service.ts", "user");
  const text =
    "export function createUser(first: string, second: string, third: string, fourth: string, fifth: string, sixth: string) { return first; }\n";
  expectOne(await checkSource(text, role, OFF_CONFIG), "max-params", role.path);
});

test("role other gets no layout rules but keeps the naming, parameter and nesting rules", async () => {
  const role = roleFor("other", "scripts/run.ts");
  const text = [
    "export const userLimit = 5;",
    "export class Store {}",
    "export interface shape { name: string }",
    "export function createUser(cfg: string, second: string, third: string, fourth: string, fifth: string, sixth: string) {",
    "  return alpha(beta(gamma(delta(cfg))));",
    "}",
    "",
  ].join("\n");
  const ruleIds = [...new Set((await checkSource(text, role)).map((finding) => finding.ruleId))].sort();
  assert.deepEqual(ruleIds, ["global-function", "max-call-nesting", "max-params", "name-abbreviation"]);
});

test("a clean module produces no findings", async () => {
  const role = roleFor("module", "src/user/user.service.ts", "user");
  const text = "export const router = Router();\n\nexport function createUser(name: string) {\n  return router.add(name);\n}\n";
  assert.deepEqual(await checkSource(text, role), []);
});
