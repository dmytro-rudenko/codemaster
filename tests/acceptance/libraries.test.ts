import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { copyFixture, runCli } from "./run-cli.ts";

const skillDirectory = ".claude/skills/codemaster-libraries";

test("libraries lists what to add, remove and refresh", () => {
  const directory = copyFixture("libraries");
  const result = runCli(["libraries"], { cwd: directory });
  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.trim().split("\n");
  assert.ok(lines.includes("add alpha 1.2.0 readme=node_modules/alpha/README.md homepage=https://alpha.dev"), result.stdout);
  assert.ok(lines.includes("remove zeta"), result.stdout);
  assert.ok(lines.includes("stale beta 1.0.0 -> 2.1.0"), result.stdout);
  assert.doesNotMatch(result.stdout, /gamma|@types/);
});

test("devDependencies are opt-in", () => {
  const directory = copyFixture("libraries");
  writeFileSync(join(directory, ".codemaster.json"), JSON.stringify({ libraryDigestDev: true }));
  const result = runCli(["libraries"], { cwd: directory });
  assert.match(result.stdout, /^add gamma 1\.0\.0 /m);
});

test("prune removes stale summaries and rebuilds the index", () => {
  const directory = copyFixture("libraries");
  runCli(["libraries", "--prune"], { cwd: directory });
  assert.equal(existsSync(join(directory, skillDirectory, "zeta.md")), false);
  const index = readFileSync(join(directory, skillDirectory, "SKILL.md"), "utf8");
  assert.match(index, /name: codemaster-libraries/);
  assert.match(index, /beta/);
  assert.doesNotMatch(index, /zeta/);
});

test("a run lists at most five libraries", () => {
  const directory = copyFixture("libraries-many");
  const result = runCli(["libraries"], { cwd: directory });
  const lines = result.stdout.trim().split("\n");
  assert.equal(lines.filter((line) => line.startsWith("add ")).length, 5);
  assert.equal(lines.at(-1), "… and 2 more");
});

test("the digest can be switched off", () => {
  const directory = copyFixture("libraries");
  writeFileSync(join(directory, ".codemaster.json"), JSON.stringify({ libraryDigest: false }));
  const result = runCli(["libraries"], { cwd: directory });
  assert.equal(result.stdout.trim(), "libraries: disabled");
});
