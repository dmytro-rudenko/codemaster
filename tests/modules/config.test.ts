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
    max: null,
    reason: null,
  });
  assert.deepEqual(resolveRuleSetting(withRule({ max: 3, reason: "x" }), ruleId), {
    enabled: true,
    severity: "error",
    max: 3,
    reason: "x",
  });
  assert.deepEqual(resolveRuleSetting(withRule({ severity: "warning" }), ruleId), {
    enabled: true,
    severity: "warning",
    max: null,
    reason: null,
  });
  assert.deepEqual(resolveRuleSetting(CONFIG_DEFAULTS, ruleId), {
    enabled: true,
    severity: "error",
    max: null,
    reason: null,
  });
});
