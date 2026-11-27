import { before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkJson, copyFixture, runCli, triples } from "./run-cli.ts";

before(() => {
  runCli(["install"]);
});

function readProfile(directory: string) {
  return JSON.parse(readFileSync(join(directory, ".codemaster.json"), "utf8"));
}

test("conventions learn the project's folder names, tests and constant case", () => {
  const directory = copyFixture("conventions");
  const result = runCli(["conventions", "--refresh"], { cwd: directory });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /codemaster profile:/);
  assert.match(result.stdout, /layout = "layered"/);
  const profile = readProfile(directory);
  assert.ok(profile.roles.module.includes("services"));
  assert.deepEqual(profile.roles.interfaces, ["types"]);
  assert.deepEqual(profile.roles.consts, ["constants"]);
  assert.equal(profile.testsLocation, "__tests__");
  assert.equal(profile.testSuffix, "spec");
  assert.equal(profile.constantCase, "camel");
  assert.match(profile.sources.constantCase, /^dominant/);
  const { findings } = checkJson(directory, ["src"]);
  const leak = findings.find(
    (finding) => finding.ruleId === "layout-forbidden-declaration" && finding.file === "src/services/user/user.service.ts",
  );
  assert.equal(leak?.line, 1);
  assert.match(leak?.message ?? "", /types/);
});

test("too few cases keep the default", () => {
  const directory = copyFixture("conventions-weak");
  runCli(["conventions", "--refresh"], { cwd: directory });
  const profile = readProfile(directory);
  assert.equal(profile.constantCase, "upper-snake");
  assert.equal(profile.sources.constantCase, "default");
});

test("a field the user wrote survives a refresh", () => {
  const directory = copyFixture("conventions");
  writeFileSync(join(directory, ".codemaster.json"), JSON.stringify({ sourceRoot: "src", constantCase: "upper-snake" }));
  const result = runCli(["conventions", "--refresh"], { cwd: directory });
  assert.equal(result.status, 0, result.stderr);
  const profile = readProfile(directory);
  assert.equal(profile.constantCase, "upper-snake");
  assert.deepEqual(profile.roles.interfaces, ["types"]);
});

test("the project's ESLint limits replace codemaster defaults", () => {
  const directory = copyFixture("eslint");
  runCli(["conventions", "--refresh"], { cwd: directory });
  const profile = readProfile(directory);
  assert.equal(profile.rules["max-params"].max, 3);
  assert.equal(profile.rules["prefer-destructuring"], "off");
  const found = triples(checkJson(directory, ["src"]).findings);
  assert.ok(found.includes("max-params src/modules/user.ts:1"), found.join("\n"));
  assert.ok(!found.some((item) => item.startsWith("prefer-destructuring")), found.join("\n"));
});
