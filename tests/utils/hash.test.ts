import { test } from "node:test";
import assert from "node:assert/strict";
import { hashText } from "../../src/utils/hash.ts";

test("hashText is a stable sha256 hex", () => {
  assert.equal(hashText("a"), "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb");
  assert.notEqual(hashText("a"), hashText("b"));
});
