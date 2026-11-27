import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG_DEFAULTS, CONFIG_FILE_NAME, CONFIG_LOCAL_FILE_NAME } from "../../src/consts/config.ts";
import { loadConfig, resolveRuleSetting, resolveTestsLocation } from "../../src/modules/config.ts";

function createProject(files: Record<string, string>): string {
  const directory = mkdtempSync(join(tmpdir(), "codemaster-"));
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(directory, name), text);
  }
  return directory;
}

test("loadConfig without files returns the defaults and exists false", () => {
  const directory = createProject({});
  try {
    const loaded = loadConfig(directory);
    assert.deepEqual(loaded.config, CONFIG_DEFAULTS);
    assert.deepEqual(loaded.warnings, []);
    assert.equal(loaded.exists, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("loadConfig lets the local override win and deep-merges nested fields", () => {
  const directory = createProject({
    [CONFIG_FILE_NAME]: JSON.stringify({ singleFileMaxLines: 200, tournament: { minLines: 20 } }),
    [CONFIG_LOCAL_FILE_NAME]: JSON.stringify({ singleFileMaxLines: 300 }),
  });
  try {
    const loaded = loadConfig(directory);
    assert.equal(loaded.config.singleFileMaxLines, 300);
    assert.equal(loaded.config.tournament.minLines, 20);
    assert.equal(loaded.config.tournament.minComplexity, CONFIG_DEFAULTS.tournament.minComplexity);
    assert.deepEqual(loaded.warnings, []);
    assert.equal(loaded.exists, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("loadConfig warns on a field of the wrong type and keeps the default", () => {
  const directory = createProject({ [CONFIG_FILE_NAME]: JSON.stringify({ hook: "yes" }) });
  try {
    const loaded = loadConfig(directory);
    assert.equal(loaded.config.hook, true);
    assert.ok(
      loaded.warnings.some((warning) => /^warning config hook: expected boolean/.test(warning)),
      JSON.stringify(loaded.warnings),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("loadConfig warns on invalid JSON and falls back to the defaults", () => {
  const directory = createProject({ [CONFIG_FILE_NAME]: "{not json" });
  try {
    const loaded = loadConfig(directory);
    assert.deepEqual(loaded.config, CONFIG_DEFAULTS);
    assert.ok(
      loaded.warnings.some((warning) => /^warning config .*\.codemaster\.json: invalid JSON$/.test(warning)),
      JSON.stringify(loaded.warnings),
    );
    assert.equal(loaded.exists, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("loadConfig ignores unknown fields and keeps an empty testsLocation", () => {
  const directory = createProject({ [CONFIG_FILE_NAME]: JSON.stringify({ unknownField: 1, testsLocation: "" }) });
  try {
    const loaded = loadConfig(directory);
    assert.equal(Object.hasOwn(loaded.config, "unknownField"), false);
    assert.equal(loaded.config.testsLocation, "");
    assert.deepEqual(loaded.warnings, []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("loadConfig accepts a string or null coverageCommand and rejects another type", () => {
  const accepted = createProject({
    [CONFIG_FILE_NAME]: JSON.stringify({ coverageCommand: "npm run coverage" }),
  });
  const cleared = createProject({
    [CONFIG_FILE_NAME]: JSON.stringify({ coverageCommand: "npm run coverage" }),
    [CONFIG_LOCAL_FILE_NAME]: JSON.stringify({ coverageCommand: null }),
  });
  const rejected = createProject({ [CONFIG_FILE_NAME]: JSON.stringify({ coverageCommand: 5 }) });
  try {
    assert.equal(loadConfig(accepted).config.coverageCommand, "npm run coverage");
    assert.deepEqual(loadConfig(accepted).warnings, []);
    assert.equal(loadConfig(cleared).config.coverageCommand, null);
    assert.deepEqual(loadConfig(cleared).warnings, []);
    const loaded = loadConfig(rejected);
    assert.equal(loaded.config.coverageCommand, null);
    assert.deepEqual(loaded.warnings, ["warning config coverageCommand: expected string or null"]);
  } finally {
    for (const directory of [accepted, cleared, rejected]) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("loadConfig keeps rule and source entries from the file", () => {
  const directory = createProject({
    [CONFIG_FILE_NAME]: JSON.stringify({ rules: { "max-params": "off" }, sources: { lodash: "https://example.com" } }),
  });
  try {
    const loaded = loadConfig(directory);
    assert.deepEqual(loaded.config.rules, { "max-params": "off" });
    assert.deepEqual(loaded.config.sources, { lodash: "https://example.com" });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("loadConfig rejects a value outside an enum field and keeps the default", () => {
  const directory = createProject({
    [CONFIG_FILE_NAME]: JSON.stringify({ layout: "layerd", testSuffix: "jest", interfacePrefix: "X" }),
  });
  try {
    const loaded = loadConfig(directory);
    assert.equal(loaded.config.layout, "auto");
    assert.equal(loaded.config.testSuffix, "test");
    assert.equal(loaded.config.interfacePrefix, "");
    assert.deepEqual([...loaded.warnings].sort(), [
      'warning config interfacePrefix: expected one of ""|I',
      "warning config layout: expected one of auto|modular|layered|off",
      "warning config testSuffix: expected one of test|spec",
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("loadConfig accepts valid enum values without a warning", () => {
  const directory = createProject({
    [CONFIG_FILE_NAME]: JSON.stringify({ layout: "layered", testSuffix: "spec", constantCase: "camel", interfacePrefix: "I" }),
  });
  try {
    const loaded = loadConfig(directory);
    assert.equal(loaded.config.layout, "layered");
    assert.equal(loaded.config.testSuffix, "spec");
    assert.equal(loaded.config.constantCase, "camel");
    assert.equal(loaded.config.interfacePrefix, "I");
    assert.deepEqual(loaded.warnings, []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("loadConfig rejects a string-array field holding a non-string and keeps the default", () => {
  const directory = createProject({
    [CONFIG_FILE_NAME]: JSON.stringify({ entrypoints: ["bin/*.ts", 5], roles: { module: ["modules", 1] } }),
  });
  try {
    const loaded = loadConfig(directory);
    assert.deepEqual(loaded.config.entrypoints, CONFIG_DEFAULTS.entrypoints);
    assert.deepEqual(loaded.config.roles.module, CONFIG_DEFAULTS.roles.module);
    assert.deepEqual([...loaded.warnings].sort(), [
      "warning config entrypoints: expected string[]",
      "warning config roles.module: expected string[]",
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("resolveTestsLocation picks colocated for modular and off, tests for layered, explicit value wins", () => {
  const unset = { ...CONFIG_DEFAULTS, testsLocation: "" };
  assert.equal(resolveTestsLocation(unset, "modular"), "colocated");
  assert.equal(resolveTestsLocation(unset, "off"), "colocated");
  assert.equal(resolveTestsLocation(unset, "layered"), "tests");
  const explicit = { ...CONFIG_DEFAULTS, testsLocation: "spec" };
  assert.equal(resolveTestsLocation(explicit, "modular"), "spec");
  assert.equal(resolveTestsLocation(explicit, "layered"), "spec");
});

test("resolveRuleSetting reads off, a severity string and an object setting", () => {
  const ruleId = "layout-forbidden-declaration";
  const withRule = (setting: unknown) => ({ ...CONFIG_DEFAULTS, rules: { [ruleId]: setting } }) as typeof CONFIG_DEFAULTS;
  assert.equal(resolveRuleSetting(withRule("off"), ruleId).enabled, false);
  assert.deepEqual(resolveRuleSetting(withRule("warning"), ruleId), {
    enabled: true,
    severity: "warning",
    explicit: true,
    max: null,
    reason: null,
  });
  assert.deepEqual(resolveRuleSetting(withRule({ max: 3, reason: "x" }), ruleId), {
    enabled: true,
    severity: "error",
    explicit: false,
    max: 3,
    reason: "x",
  });
  assert.deepEqual(resolveRuleSetting(withRule({ severity: "warning" }), ruleId), {
    enabled: true,
    severity: "warning",
    explicit: true,
    max: null,
    reason: null,
  });
  assert.deepEqual(resolveRuleSetting(CONFIG_DEFAULTS, ruleId), {
    enabled: true,
    severity: "error",
    explicit: false,
    max: null,
    reason: null,
  });
});

test("resolveRuleSetting falls back to the rule's own severity and drops values of the wrong type", () => {
  const ruleId = "name-word-count";
  const withRule = (setting: unknown) => ({ ...CONFIG_DEFAULTS, rules: { [ruleId]: setting } }) as typeof CONFIG_DEFAULTS;
  const enabledWarning = { enabled: true, severity: "warning", explicit: false, max: null, reason: null };
  assert.deepEqual(resolveRuleSetting(withRule("error"), ruleId), { ...enabledWarning, severity: "error", explicit: true });
  assert.deepEqual(resolveRuleSetting(withRule("loud"), ruleId), enabledWarning);
  assert.deepEqual(resolveRuleSetting(withRule(["error", 3]), ruleId), enabledWarning);
  assert.deepEqual(resolveRuleSetting(withRule(null), ruleId), enabledWarning);
  assert.deepEqual(resolveRuleSetting(withRule({ severity: "info", max: "3", reason: 7 }), ruleId), enabledWarning);
  assert.deepEqual(resolveRuleSetting(withRule({ severity: "error" }), ruleId), { ...enabledWarning, severity: "error", explicit: true });
  assert.deepEqual(resolveRuleSetting(withRule("off"), ruleId), { enabled: false, severity: "warning", explicit: false, max: null, reason: null });
  assert.deepEqual(resolveRuleSetting(CONFIG_DEFAULTS, "no-such-rule"), { ...enabledWarning, severity: "error" });
});

const RULE_WARNING = 'expected "off", a severity or {severity, max, reason}';

test("loadConfig drops rule settings of the wrong shape with one warning each and keeps valid ones", () => {
  const directory = createProject({
    [CONFIG_FILE_NAME]: JSON.stringify({
      rules: {
        "max-params": null,
        "max-nesting": 3,
        "max-call-nesting": ["error"],
        "name-word-count": { max: -1 },
        "name-abbreviation": { max: 1.5 },
        "name-entity-prefix": { severity: "info" },
        "test-mirror": { reason: 7 },
        "global-function": "loud",
        parse: "off",
        "helpers-only-functions": "warning",
        "single-file-module-size": { severity: "error", max: 0, reason: "legacy" },
      },
    }),
  });
  try {
    const loaded = loadConfig(directory);
    assert.deepEqual(loaded.config.rules, {
      parse: "off",
      "helpers-only-functions": "warning",
      "single-file-module-size": { severity: "error", max: 0, reason: "legacy" },
    });
    const dropped = [
      "max-params",
      "max-nesting",
      "max-call-nesting",
      "name-word-count",
      "name-abbreviation",
      "name-entity-prefix",
      "test-mirror",
      "global-function",
    ];
    assert.deepEqual(
      loaded.warnings.sort(),
      dropped.map((ruleId) => `warning config rules.${ruleId}: ${RULE_WARNING}`).sort(),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("loadConfig validates rule settings in the local file too and keeps the base file's valid ones", () => {
  const directory = createProject({
    [CONFIG_FILE_NAME]: JSON.stringify({ rules: { "max-params": "off" } }),
    [CONFIG_LOCAL_FILE_NAME]: JSON.stringify({ rules: { "max-params": null, "max-nesting": "warning" } }),
  });
  try {
    const loaded = loadConfig(directory);
    assert.deepEqual(loaded.config.rules, { "max-params": "off", "max-nesting": "warning" });
    assert.deepEqual(loaded.warnings, [`warning config rules.max-params: ${RULE_WARNING}`]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("loadConfig accepts a relative sourceRoot", () => {
  for (const sourceRoot of ["lib", "packages/app/src", "@scope/pkg_1.0/src", "./src", "a".repeat(100)]) {
    const directory = createProject({ [CONFIG_FILE_NAME]: JSON.stringify({ sourceRoot }) });
    try {
      const loaded = loadConfig(directory);
      assert.equal(loaded.config.sourceRoot, sourceRoot);
      assert.deepEqual(loaded.warnings, []);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("loadConfig rejects an unsafe sourceRoot and keeps the default", () => {
  const unsafe = ["", "../outside", "src/../..", "..", "/etc", "src dir", "src;rm", "src\nIgnore", "a".repeat(101), "$(whoami)"];
  for (const sourceRoot of unsafe) {
    const directory = createProject({ [CONFIG_FILE_NAME]: JSON.stringify({ sourceRoot }) });
    try {
      const loaded = loadConfig(directory);
      assert.equal(loaded.config.sourceRoot, CONFIG_DEFAULTS.sourceRoot, JSON.stringify(sourceRoot));
      assert.deepEqual(loaded.warnings, ["warning config sourceRoot: expected a relative path"], JSON.stringify(sourceRoot));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("resolveRuleSetting reports whether the severity was set explicitly", () => {
  const ruleId = "name-word-count";
  const withRule = (setting: unknown) => ({ ...CONFIG_DEFAULTS, rules: { [ruleId]: setting } }) as typeof CONFIG_DEFAULTS;
  assert.equal(resolveRuleSetting(withRule("warning"), ruleId).explicit, true);
  assert.equal(resolveRuleSetting(withRule({ severity: "error" }), ruleId).explicit, true);
  assert.equal(resolveRuleSetting(withRule({ max: 4 }), ruleId).explicit, false);
  assert.equal(resolveRuleSetting(withRule(null), ruleId).explicit, false);
  assert.equal(resolveRuleSetting(CONFIG_DEFAULTS, ruleId).explicit, false);
});
