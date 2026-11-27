import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkEntityPrefix,
  countNameWords,
  findAbbreviation,
} from "../../../src/helpers/logic/naming.ts";

type PrefixOptions = Parameters<typeof checkEntityPrefix>[1];

function constantOptions(overrides: Partial<PrefixOptions> = {}): PrefixOptions {
  return {
    kind: "constant",
    entity: "user",
    constantCase: "upper-snake",
    interfacePrefix: "",
    entityPrefix: true,
    ...overrides,
  };
}

function typeOptions(overrides: Partial<PrefixOptions> = {}): PrefixOptions {
  return constantOptions({ kind: "type", ...overrides });
}

test("findAbbreviation returns the first abbreviated word", () => {
  assert.equal(findAbbreviation("cfgValue", []), "cfg");
  assert.equal(findAbbreviation("cfgMsg", []), "cfg");
});

test("findAbbreviation skips words on the allowlist", () => {
  assert.equal(findAbbreviation("userId", ["id"]), null);
});

test("findAbbreviation accepts a name made of full words", () => {
  assert.equal(findAbbreviation("userAccount", []), null);
});

test("findAbbreviation returns a single-letter name", () => {
  assert.equal(findAbbreviation("x", []), "x");
});

test("findAbbreviation accepts a lone underscore", () => {
  assert.equal(findAbbreviation("_", []), null);
});

test("countNameWords strips the entity prefix", () => {
  assert.equal(countNameWords("USER_MAX_AGE", "user"), 2);
  assert.equal(countNameWords("userMaxAge", "user"), 2);
});

test("countNameWords matches the prefix case-insensitively", () => {
  assert.equal(countNameWords("userMaxAge", "USER"), 2);
});

test("countNameWords counts every word without a prefix", () => {
  assert.equal(countNameWords("USER_MAX_AGE", null), 3);
});

test("countNameWords keeps a name that does not start with the prefix", () => {
  assert.equal(countNameWords("MAX_AGE", "user"), 2);
});

test("checkEntityPrefix asks an upper-snake constant for the USER_ prefix", () => {
  const message = checkEntityPrefix("MAX_AGE", constantOptions());
  assert.equal(message, "MAX_AGE should start with USER_");
});

test("checkEntityPrefix accepts a prefixed upper-snake constant", () => {
  assert.equal(checkEntityPrefix("USER_MAX_AGE", constantOptions()), null);
});

test("checkEntityPrefix rejects a constant equal to the bare prefix", () => {
  const message = checkEntityPrefix("USER", constantOptions());
  assert.ok(message !== null);
  assert.ok(message.includes("USER_"));
});

test("checkEntityPrefix accepts a prefixed camel constant", () => {
  const options = constantOptions({ constantCase: "camel" });
  assert.equal(checkEntityPrefix("userLimit", options), null);
});

test("checkEntityPrefix asks a camel constant for the user prefix", () => {
  const options = constantOptions({ constantCase: "camel" });
  const message = checkEntityPrefix("limit", options);
  assert.ok(message !== null);
  assert.ok(message.includes("user"));
});

test("checkEntityPrefix asks a type for the entity name", () => {
  const message = checkEntityPrefix("Profile", typeOptions());
  assert.ok(message !== null);
  assert.ok(message.includes("User"));
});

test("checkEntityPrefix accepts a prefixed type", () => {
  assert.equal(checkEntityPrefix("UserAccount", typeOptions()), null);
});

test("checkEntityPrefix asks for the interface prefix", () => {
  const message = checkEntityPrefix(
    "UserAccount",
    typeOptions({ interfacePrefix: "I" }),
  );
  assert.ok(message !== null);
  assert.ok(message.includes("IUser"));
});

test("checkEntityPrefix accepts a type with the interface prefix", () => {
  const options = typeOptions({ interfacePrefix: "I" });
  assert.equal(checkEntityPrefix("IUserAccount", options), null);
});

test("checkEntityPrefix expands a multi-word entity per case", () => {
  const entity = "order-item";
  assert.equal(
    checkEntityPrefix("ORDER_ITEM_LIMIT", constantOptions({ entity })),
    null,
  );
  assert.equal(
    checkEntityPrefix(
      "orderItemLimit",
      constantOptions({ entity, constantCase: "camel" }),
    ),
    null,
  );
  assert.equal(
    checkEntityPrefix("OrderItemAccount", typeOptions({ entity })),
    null,
  );
});

test("checkEntityPrefix names the multi-word prefix in the message", () => {
  const message = checkEntityPrefix(
    "MAX_AGE",
    constantOptions({ entity: "order-item" }),
  );
  assert.ok(message !== null);
  assert.ok(message.includes("ORDER_ITEM_"));
});

test("checkEntityPrefix checks only the case shape without an entity", () => {
  const snake = constantOptions({ entity: null });
  const camel = constantOptions({ entity: null, constantCase: "camel" });
  assert.equal(checkEntityPrefix("MAX_AGE", snake), null);
  assert.ok(checkEntityPrefix("maxAge", snake) !== null);
  assert.equal(checkEntityPrefix("maxAge", camel), null);
  assert.ok(checkEntityPrefix("MAX_AGE", camel) !== null);
  assert.equal(checkEntityPrefix("Profile", typeOptions({ entity: null })), null);
  assert.ok(checkEntityPrefix("profile", typeOptions({ entity: null })) !== null);
});

test("checkEntityPrefix checks only the case shape when entityPrefix is off", () => {
  const snake = constantOptions({ entityPrefix: false });
  const camel = constantOptions({ entityPrefix: false, constantCase: "camel" });
  const plainType = typeOptions({ entityPrefix: false });
  const interfaceType = typeOptions({ entityPrefix: false, interfacePrefix: "I" });
  assert.equal(checkEntityPrefix("MAX_AGE", snake), null);
  assert.ok(checkEntityPrefix("maxAge", snake) !== null);
  assert.equal(checkEntityPrefix("maxAge", camel), null);
  assert.equal(checkEntityPrefix("Profile", plainType), null);
  assert.equal(checkEntityPrefix("IProfile", interfaceType), null);
});

test("checkEntityPrefix names the case shape in the message", () => {
  assert.equal(
    checkEntityPrefix("maxAge", constantOptions({ entity: null })),
    "maxAge should be UPPER_SNAKE",
  );
  assert.equal(
    checkEntityPrefix("MAX_AGE", constantOptions({ entity: null, constantCase: "camel" })),
    "MAX_AGE should be camelCase",
  );
  assert.equal(
    checkEntityPrefix("profile", typeOptions({ entity: null })),
    "profile should be PascalCase",
  );
  assert.equal(
    checkEntityPrefix("Profile", typeOptions({ entity: null, interfacePrefix: "I" })),
    "Profile should be IPascalCase",
  );
});

test("checkEntityPrefix reports the case shape after a matching prefix", () => {
  assert.equal(
    checkEntityPrefix("USER_max", constantOptions()),
    "USER_max should be UPPER_SNAKE",
  );
});

test("checkEntityPrefix accepts a type equal to the entity name", () => {
  assert.equal(checkEntityPrefix("User", typeOptions()), null);
  assert.equal(checkEntityPrefix("IUser", typeOptions({ interfacePrefix: "I" })), null);
});

test("checkEntityPrefix rejects a type that continues the entity name in lowercase", () => {
  assert.equal(checkEntityPrefix("Users", typeOptions()), "Users should start with User");
});

test("checkEntityPrefix rejects a camel constant that continues the prefix in lowercase", () => {
  const options = constantOptions({ constantCase: "camel" });
  assert.equal(checkEntityPrefix("userlimit", options), "userlimit should start with user");
  assert.equal(checkEntityPrefix("user", options), "user should start with user");
});
