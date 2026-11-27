import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG_DEFAULTS } from "../../src/consts/config.ts";
import { detectLayout, resolveFileRole } from "../../src/helpers/logic/file-role.ts";
import { copyFixture } from "./run-cli.ts";

function roleOf(path: string, layout: "modular" | "layered" | "off") {
  const { role, entity, global } = resolveFileRole(path, { layout, config: CONFIG_DEFAULTS });
  return { role, entity, global };
}

test("modular roles", () => {
  assert.deepEqual(roleOf("src/user/user.interfaces.ts", "modular"), { role: "interfaces", entity: "user", global: false });
  assert.deepEqual(roleOf("src/user/types.ts", "modular"), { role: "interfaces", entity: "user", global: false });
  assert.deepEqual(roleOf("src/user/user.service.ts", "modular"), { role: "module", entity: "user", global: false });
  assert.equal(roleOf("src/report.ts", "modular").role, "single-file-module");
  assert.deepEqual(
    { role: roleOf("src/global/consts.ts", "modular").role, global: roleOf("src/global/consts.ts", "modular").global },
    { role: "consts", global: true },
  );
  assert.equal(roleOf("src/utils/format.ts", "modular").role, "util");
  assert.equal(roleOf("scripts/run.ts", "modular").role, "other");
});

test("layered roles", () => {
  assert.deepEqual(roleOf("src/modules/user.ts", "layered"), { role: "single-file-module", entity: "user", global: false });
  assert.deepEqual(roleOf("src/modules/order/order.ts", "layered"), { role: "module", entity: "order", global: false });
  const globalConsts = roleOf("src/consts/global.ts", "layered");
  assert.equal(globalConsts.role, "consts");
  assert.equal(globalConsts.global, true);
  assert.equal(roleOf("src/helpers/fetch-user.ts", "layered").role, "helper");
  assert.equal(roleOf("tests/modules/user.test.ts", "layered").role, "test");
});

test("entrypoints", () => {
  assert.equal(roleOf("bin/codemaster.ts", "layered").role, "entrypoint");
});

test("layout detection", () => {
  assert.equal(detectLayout(copyFixture("layered"), CONFIG_DEFAULTS), "layered");
  assert.equal(detectLayout(copyFixture("modular"), CONFIG_DEFAULTS), "modular");
  assert.equal(detectLayout(copyFixture("off"), CONFIG_DEFAULTS), "off");
});
