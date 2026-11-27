import { before, test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkJson, copyFixture, initRepository, runCli, triples } from "./run-cli.ts";

before(() => {
  runCli(["install"]);
});

test("modular fixture reports exactly the planted violations", () => {
  const directory = copyFixture("modular");
  const { status, findings } = checkJson(directory, ["src", "scripts"]);
  assert.equal(status, 1);
  assert.deepEqual(
    triples(findings),
    [
      "global-function scripts/run.ts:1",
      "helpers-only-functions src/user/user.helpers.ts:1",
      "layout-forbidden-declaration src/user/user.service.ts:1",
      "layout-forbidden-declaration src/user/user.service.ts:4",
      "max-nesting src/order/order.service.ts:6",
      "max-params src/old/legacy.ts:1",
      "max-call-nesting src/old/legacy.ts:2",
      "single-file-module-size src/big.ts:1",
      "max-params src/user/user.service.ts:3",
      "name-abbreviation src/user/user.service.ts:4",
      "name-entity-prefix src/user/user.consts.ts:1",
      "name-entity-prefix src/user/user.interfaces.ts:1",
      "prefer-destructuring src/user/user.helpers.ts:3",
      "test-mirror src/order/order.service.ts:1",
    ].sort(),
  );
  const mirror = findings.find((finding) => finding.ruleId === "test-mirror");
  assert.equal(mirror?.severity, "error");
});

test("plain output ends with the summary line", () => {
  const directory = copyFixture("modular");
  const result = runCli(["check", "src"], { cwd: directory });
  assert.equal(result.status, 1);
  const lastLine = result.stdout.trim().split("\n").pop() ?? "";
  assert.match(lastLine, /^codemaster: \d+ errors, \d+ warnings in \d+ files$/);
  assert.match(result.stdout, /^error max-params src\/user\/user\.service\.ts:3 /m);
});

test("layered fixture", () => {
  const directory = copyFixture("layered");
  const { findings } = checkJson(directory, ["src"]);
  const found = triples(findings);
  assert.ok(found.includes("layout-forbidden-declaration src/modules/order/order.ts:1"), found.join("\n"));
  assert.ok(found.some((item) => item.startsWith("helpers-mixed-kind src/helpers/fetch-user.ts:")), found.join("\n"));
  assert.ok(found.includes("simple-package package.json:3"), found.join("\n"));
  const utilityMirror = findings.find((finding) => finding.ruleId === "test-mirror" && finding.file === "src/utils/format.ts");
  assert.equal(utilityMirror?.severity, "warning");
  assert.equal(findings.filter((finding) => finding.file === "src/modules/user.ts").length, 0);
});

test("a project without a recognised layout gets only function rules", () => {
  const directory = copyFixture("off");
  const { findings } = checkJson(directory, ["src"]);
  assert.deepEqual(triples(findings), ["max-params src/pages/home.ts:1"]);
});

test("check without paths covers changed files, --all covers every file", () => {
  const directory = copyFixture("modular");
  initRepository(directory);
  appendFileSync(join(directory, "src/user/user.service.ts"), "export const userName = 'x';\n");
  const changed = checkJson(directory, []);
  assert.ok(changed.findings.length > 0);
  assert.ok(changed.findings.every((finding) => finding.file === "src/user/user.service.ts"), triples(changed.findings).join("\n"));
  assert.ok(!changed.findings.some((finding) => finding.file === "src/old/legacy.ts"));
  const all = checkJson(directory, ["--all"]);
  assert.ok(all.findings.some((finding) => finding.file === "src/old/legacy.ts"));
});

test("data constants are forbidden in a module, objects are allowed", () => {
  const directory = copyFixture("modular");
  appendFileSync(
    join(directory, "src/user/user.service.ts"),
    "export const router = Router();\nexport const cache = new Map();\nexport const USER_ROLES = [\"a\"] as const;\n",
  );
  const { findings } = checkJson(directory, ["src/user/user.service.ts"]);
  const lines = findings.filter((finding) => finding.ruleId === "layout-forbidden-declaration").map((finding) => finding.line);
  assert.deepEqual(lines.sort(), [1, 4, 7]);
});

test("check outside git without paths explains itself", () => {
  const directory = copyFixture("off");
  const result = runCli(["check"], { cwd: directory });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /codemaster: not a git repository; pass paths/);
});

test("rule settings switch a rule off or raise its limit", () => {
  const directory = copyFixture("off");
  writeFileSync(join(directory, "src/pages/profile.ts"), 'export const userAccountProfileName = "x";\n');
  const before = checkJson(directory, ["src"]);
  assert.ok(triples(before.findings).includes("name-word-count src/pages/profile.ts:1"));
  writeFileSync(join(directory, ".codemaster.json"), JSON.stringify({ rules: { "max-params": "off", "name-word-count": { max: 4 } } }));
  const after = checkJson(directory, ["src"]);
  assert.deepEqual(triples(after.findings), []);
});
