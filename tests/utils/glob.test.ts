import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesGlob } from "../../src/utils/glob.ts";

test("matchesGlob matches a single-segment star", () => {
  assert.equal(matchesGlob("bin/codemaster.ts", "bin/*.ts"), true);
  assert.equal(matchesGlob("bin/nested/codemaster.ts", "bin/*.ts"), false);
  assert.equal(matchesGlob("src/index.ts", "src/index.ts"), true);
});
