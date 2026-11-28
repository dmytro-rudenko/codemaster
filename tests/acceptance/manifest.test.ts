import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PLUGIN_ROOT } from "./run-cli.ts";

function read(path: string): string {
  return readFileSync(join(PLUGIN_ROOT, path), "utf8");
}

function frontmatter(path: string): string {
  return read(path).split("---")[1] ?? "";
}

test("plugin manifest", () => {
  const manifest = JSON.parse(read(".claude-plugin/plugin.json"));
  assert.equal(manifest.name, "codemaster");
  assert.equal(manifest.version, "0.1.2");
  assert.equal(manifest.hooks, "./hooks/hooks.json");
  const marketplace = JSON.parse(read(".claude-plugin/marketplace.json"));
  assert.equal(marketplace.plugins[0].version, "0.1.2");
});

test("hooks run the CLI", () => {
  const { hooks } = JSON.parse(read("hooks/hooks.json"));
  assert.match(JSON.stringify(hooks.Stop), /bin\/codemaster\.ts\\?" hook-stop/);
  assert.match(JSON.stringify(hooks.SessionStart), /hook-session-start/);
});

test("skills carry their names and version", () => {
  const main = frontmatter("skills/codemaster/SKILL.md");
  assert.match(main, /^name: codemaster$/m);
  assert.match(main, /^version: 0\.1\.2$/m);
  const audit = frontmatter("skills/codemaster-audit/SKILL.md");
  assert.match(audit, /^name: codemaster-audit$/m);
  assert.match(audit, /^version: 0\.1\.0$/m);
});

test("README in English with an install section", () => {
  assert.match(read("README.md"), /^## Install$/m);
});
