import { before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { copyFixture, initializeRepository, runCli, stateDirectory } from "./run-cli.ts";

before(() => {
  runCli(["install"]);
});

test("a wrong variant drops out and a correct one wins", () => {
  const directory = copyFixture("tournament/good");
  const result = runCli(["tournament", directory]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /winner: (readable|first)/);
  const outcome = JSON.parse(readFileSync(join(directory, "result.json"), "utf8"));
  const optimized = outcome.variants.find((variant: { variant: string }) => variant.variant === "optimized");
  assert.equal(optimized.passed, false);
  const winner = outcome.variants.find((variant: { variant: string }) => variant.variant === outcome.winner);
  assert.equal(typeof winner.metrics.bytecodePerToken, "number");
  assert.equal(typeof winner.metrics.desugared, "number");
  assert.equal(typeof winner.metrics.bytecode, "number");
  assert.equal(typeof winner.metrics.speed, "number");
});

test("benchmark = false skips the speed metric", () => {
  const directory = copyFixture("tournament/no-bench");
  const result = runCli(["tournament", directory]);
  assert.equal(result.status, 0, result.stderr);
  const outcome = JSON.parse(readFileSync(join(directory, "result.json"), "utf8"));
  assert.notEqual(outcome.winner, "none");
  for (const variant of outcome.variants) {
    assert.equal(variant.metrics.speed, null);
  }
});

test("all variants wrong means no winner", () => {
  const directory = copyFixture("tournament/all-bad");
  const result = runCli(["tournament", directory]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /winner: none/);
});

test("candidates are non-trivial changed functions, without tsx and this-methods", () => {
  const directory = copyFixture("candidates");
  initializeRepository(directory, { commitFiles: false });
  const result = runCli(["tournament", "--candidates"], { cwd: directory });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^src\/math\.ts:1 scoreValues complexity=\d+ lines=\d+$/m);
  assert.doesNotMatch(result.stdout, /renderWidget|Counter\.bump/);
});

test("skip records a function with its reason", () => {
  const directory = copyFixture("candidates");
  initializeRepository(directory, { commitFiles: false });
  const result = runCli(["tournament", "--skip", "src/math.ts#scoreValues", "--reason", "closure"], { cwd: directory });
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(readFileSync(join(stateDirectory(directory), "tournament-done.json"), "utf8"));
  const entries = Array.isArray(parsed) ? parsed : Object.values(parsed);
  const entry = entries.find((item: { key: string }) => item.key === "src/math.ts#scoreValues");
  assert.equal(entry.skipped, true);
  assert.equal(entry.reason, "closure");
  const after = runCli(["tournament", "--candidates"], { cwd: directory });
  assert.doesNotMatch(after.stdout, /scoreValues/);
});
