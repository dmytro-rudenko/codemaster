import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listDirectoryNames,
  readJsonFile,
  readTextFile,
  removeFile,
  writeTextFile,
} from "../../../src/helpers/infrastructure/filesystem.ts";

function createDirectory(): string {
  return mkdtempSync(join(tmpdir(), "codemaster-"));
}

test("readTextFile returns null for a missing file", () => {
  const directory = createDirectory();
  try {
    assert.equal(readTextFile(join(directory, "missing.txt")), null);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("writeTextFile creates parent directories and readTextFile reads the text back", () => {
  const directory = createDirectory();
  try {
    const path = join(directory, "nested", "deeper", "file.txt");
    writeTextFile(path, "hello\n");
    assert.equal(readTextFile(path), "hello\n");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("readJsonFile parses valid JSON and reports invalid JSON", () => {
  const directory = createDirectory();
  try {
    writeFileSync(join(directory, "valid.json"), '{"hook":false}');
    assert.deepEqual(readJsonFile(join(directory, "valid.json")), { value: { hook: false }, error: null });
    writeFileSync(join(directory, "broken.json"), "{not json");
    const broken = readJsonFile(join(directory, "broken.json"));
    assert.equal(typeof broken.error, "string");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("listDirectoryNames lists the subdirectories of a path", () => {
  const directory = createDirectory();
  try {
    mkdirSync(join(directory, "alpha"));
    mkdirSync(join(directory, "beta"));
    assert.deepEqual([...listDirectoryNames(directory)].sort(), ["alpha", "beta"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("removeFile deletes an existing file and ignores a missing one", () => {
  const directory = createDirectory();
  try {
    const path = join(directory, "gone.txt");
    writeFileSync(path, "x");
    removeFile(path);
    assert.equal(existsSync(path), false);
    assert.doesNotThrow(() => removeFile(path));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("writeTextFile refuses to write through a symbolic link", () => {
  const directory = mkdtempSync(join(tmpdir(), "codemaster-filesystem-"));
  try {
    const target = join(directory, "outside.json");
    symlinkSync(target, join(directory, "link.json"));
    assert.throws(() => writeTextFile(join(directory, "link.json"), "{}\n"));
    assert.equal(existsSync(target), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
