import { before, test } from "node:test";
import assert from "node:assert/strict";
import { runCli } from "./run-cli.ts";

before(() => {
  runCli(["install"]);
});

test("the plugin passes its own checks", () => {
  const result = runCli(["check", "src", "bin"]);
  const lastLine = result.stdout.trim().split("\n").pop() ?? "";
  assert.ok(lastLine.startsWith("codemaster: 0 errors"), result.stdout);
});
