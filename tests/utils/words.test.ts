import { test } from "node:test";
import assert from "node:assert/strict";
import { splitWords, toEntityCase } from "../../src/utils/words.ts";

test("splitWords handles camel, pascal, snake and acronyms", () => {
  assert.deepEqual(splitWords("userMaxAge"), ["user", "max", "age"]);
  assert.deepEqual(splitWords("USER_MAX_AGE"), ["user", "max", "age"]);
  assert.deepEqual(splitWords("UserProfile"), ["user", "profile"]);
  assert.deepEqual(splitWords("HTTPServer"), ["http", "server"]);
  assert.deepEqual(splitWords("order-item"), ["order", "item"]);
  assert.deepEqual(splitWords("stepNumber12"), ["step", "number12"]);
});

test("toEntityCase renders an entity in each style", () => {
  assert.equal(toEntityCase("order-item", "upper-snake"), "ORDER_ITEM");
  assert.equal(toEntityCase("order-item", "camel"), "orderItem");
  assert.equal(toEntityCase("order_item", "pascal"), "OrderItem");
  assert.equal(toEntityCase("user", "pascal"), "User");
});
