import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PLUGIN_ROOT } from "./run-cli.ts";

test("end-state: git tree clean and free of node_modules", () => {
  const tracked = execFileSync("git", ["ls-files"], { cwd: PLUGIN_ROOT, encoding: "utf8" });
  assert.equal(tracked.split("\n").filter((path) => path.split("/").includes("node_modules")).length, 0);
  const manifest = JSON.parse(readFileSync(join(PLUGIN_ROOT, "package.json"), "utf8"));
  assert.equal(manifest.dependencies, undefined);
  assert.equal(manifest.devDependencies, undefined);
  if (process.env.CODEMASTER_END_STATE === "1") {
    const status = execFileSync("git", ["status", "--porcelain"], { cwd: PLUGIN_ROOT, encoding: "utf8" });
    assert.equal(status, "");
  }
});
