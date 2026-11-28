import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { listManifests } from "../../../src/helpers/infrastructure/manifest.ts";

function createProject(paths: string[]): string {
  const directory = mkdtempSync(join(tmpdir(), "codemaster-manifest-"));
  for (const path of paths) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), "{}\n");
  }
  return directory;
}

test("listManifests finds package.json in every subfolder except node_modules, .git and nested repositories", () => {
  const directory = createProject([
    "package.json",
    "front/package.json",
    "packages/api/server/package.json",
    "node_modules/axios/package.json",
    "front/node_modules/vue/package.json",
    ".git/package.json",
    ".claude/worktrees/copy/.git",
    ".claude/worktrees/copy/package.json",
    "docs/readme.md",
  ]);
  try {
    assert.deepEqual(listManifests(directory, []), ["front/package.json", "package.json", "packages/api/server/package.json"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("listManifests drops manifests that match an exclude glob", () => {
  const directory = createProject(["package.json", "vendor/lib/package.json"]);
  try {
    assert.deepEqual(listManifests(directory, ["vendor/**"]), ["package.json"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("listManifests of a project without manifests is empty", () => {
  const directory = createProject(["src/index.ts"]);
  try {
    assert.deepEqual(listManifests(directory, []), []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
