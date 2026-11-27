import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import {
  findBaseBranch,
  findMergeBase,
  isPackageManifestChanged,
  isRepository,
  listAllSourceFiles,
  listChangedFiles,
  listChangedLineRanges,
  resolveStateDirectory,
} from "../../../src/helpers/infrastructure/git.ts";

function runGit(directory: string, gitArguments: string[]): string {
  return execFileSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=test", ...gitArguments], {
    cwd: directory,
    encoding: "utf8",
  }).trim();
}

function writeProjectFile(directory: string, path: string, text: string): void {
  mkdirSync(dirname(join(directory, path)), { recursive: true });
  writeFileSync(join(directory, path), text);
}

function createRepository(): string {
  const directory = mkdtempSync(join(tmpdir(), "codemaster-"));
  runGit(directory, ["init", "-q", "-b", "main"]);
  writeProjectFile(directory, "kept.ts", "export const KEPT = 1;\n");
  writeProjectFile(directory, "changed.ts", "line 1\nline 2\nline 3\nline 4\nline 5\n");
  writeProjectFile(directory, "deleted.ts", "export const DELETED = 1;\n");
  writeProjectFile(directory, "package.json", '{"name":"sample","version":"1.0.0"}\n');
  runGit(directory, ["add", "-A"]);
  runGit(directory, ["commit", "-q", "-m", "base"]);
  return directory;
}

function createWorkBranch(): string {
  const directory = createRepository();
  runGit(directory, ["checkout", "-q", "-b", "work"]);
  writeProjectFile(directory, "branch.ts", "export const BRANCH = 1;\n");
  runGit(directory, ["add", "branch.ts"]);
  runGit(directory, ["commit", "-q", "-m", "branch"]);
  writeProjectFile(directory, "changed.ts", "line 1\nline 2\nline three\nline 4\nline 5\n");
  writeProjectFile(directory, "new.ts", "export const NEW = 1;\n");
  rmSync(join(directory, "deleted.ts"));
  writeProjectFile(directory, "node_modules/x.ts", "export const X = 1;\n");
  writeProjectFile(directory, "dist/a.ts", "export const A = 1;\n");
  writeProjectFile(directory, "a.d.ts", "export declare const A: number;\n");
  writeProjectFile(directory, "notes.md", "notes\n");
  return directory;
}

test("isRepository is true inside a git repository and false outside", () => {
  const repository = createRepository();
  const plain = mkdtempSync(join(tmpdir(), "codemaster-"));
  try {
    assert.equal(isRepository(repository), true);
    assert.equal(isRepository(plain), false);
  } finally {
    rmSync(repository, { recursive: true, force: true });
    rmSync(plain, { recursive: true, force: true });
  }
});

test("findBaseBranch and findMergeBase on a branch off main", () => {
  const directory = createWorkBranch();
  try {
    assert.equal(findBaseBranch(directory), "main");
    assert.equal(findMergeBase(directory), runGit(directory, ["rev-parse", "main"]));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("listChangedFiles on branch work lists committed, uncommitted and untracked changes only", () => {
  const directory = createWorkBranch();
  try {
    assert.deepEqual(listChangedFiles(directory), ["branch.ts", "changed.ts", "new.ts"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("listChangedFiles on main without another base lists uncommitted and untracked files only", () => {
  const directory = createRepository();
  try {
    writeProjectFile(directory, "changed.ts", "edited\n");
    writeProjectFile(directory, "new.ts", "export const NEW = 1;\n");
    rmSync(join(directory, "deleted.ts"));
    writeProjectFile(directory, "node_modules/x.ts", "export const X = 1;\n");
    writeProjectFile(directory, "a.d.ts", "export declare const A: number;\n");
    assert.deepEqual(listChangedFiles(directory), ["changed.ts", "new.ts"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("listChangedFiles in a repository without commits lists staged and untracked files", () => {
  const directory = mkdtempSync(join(tmpdir(), "codemaster-"));
  try {
    runGit(directory, ["init", "-q", "-b", "main"]);
    writeProjectFile(directory, "staged.ts", "export const STAGED = 1;\n");
    runGit(directory, ["add", "staged.ts"]);
    writeProjectFile(directory, "new.ts", "export const NEW = 1;\n");
    assert.deepEqual(listChangedFiles(directory), ["new.ts", "staged.ts"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("listAllSourceFiles includes tracked and untracked sources with the same filters", () => {
  const directory = createWorkBranch();
  try {
    const files = listAllSourceFiles(directory);
    for (const expected of ["kept.ts", "branch.ts", "changed.ts", "new.ts"]) {
      assert.ok(files.includes(expected), `${expected} missing from ${files.join(", ")}`);
    }
    for (const excluded of ["node_modules/x.ts", "dist/a.ts", "a.d.ts", "notes.md", "package.json"]) {
      assert.ok(!files.includes(excluded), `${excluded} must be excluded`);
    }
    assert.deepEqual(files, [...files].sort());
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("isPackageManifestChanged becomes true after editing a committed package.json", () => {
  const directory = createRepository();
  try {
    runGit(directory, ["checkout", "-q", "-b", "work"]);
    assert.equal(isPackageManifestChanged(directory), false);
    writeProjectFile(directory, "package.json", '{"name":"sample","version":"1.1.0"}\n');
    assert.equal(isPackageManifestChanged(directory), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("listChangedLineRanges returns new for an untracked file and a range covering an edited line", () => {
  const directory = createWorkBranch();
  try {
    assert.equal(listChangedLineRanges(directory, "new.ts"), "new");
    assert.deepEqual(listChangedLineRanges(directory, "changed.ts"), [{ start: 3, end: 3 }]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("listChangedLineRanges gives exact multi-line ranges and skips deletion-only hunks", () => {
  const directory = createRepository();
  try {
    runGit(directory, ["checkout", "-q", "-b", "work"]);
    writeProjectFile(directory, "changed.ts", "line 1\nline two\nline three\nline 4\nline 5\n");
    assert.deepEqual(listChangedLineRanges(directory, "changed.ts"), [{ start: 2, end: 3 }]);
    writeProjectFile(directory, "changed.ts", "line 1\nline 2\nline 3\nline 5\n");
    assert.deepEqual(listChangedLineRanges(directory, "changed.ts"), []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an orphan branch has no merge-base and falls back to uncommitted and untracked files", () => {
  const directory = createRepository();
  try {
    runGit(directory, ["checkout", "-q", "--orphan", "work"]);
    runGit(directory, ["commit", "-q", "-m", "orphan"]);
    assert.equal(findBaseBranch(directory), "main");
    assert.equal(findMergeBase(directory), null);
    writeProjectFile(directory, "changed.ts", "edited\n");
    writeProjectFile(directory, "new.ts", "export const NEW = 1;\n");
    assert.deepEqual(listChangedFiles(directory), ["changed.ts", "new.ts"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("outside a git repository there is no base branch, no merge-base and no state directory", () => {
  const directory = mkdtempSync(join(tmpdir(), "codemaster-"));
  try {
    assert.equal(findBaseBranch(directory), null);
    assert.equal(findMergeBase(directory), null);
    assert.throws(() => resolveStateDirectory(directory), /not a git repository/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("resolveStateDirectory returns an absolute existing directory named codemaster", () => {
  const directory = createRepository();
  try {
    const state = resolveStateDirectory(directory);
    assert.ok(isAbsolute(state), state);
    assert.equal(basename(state), "codemaster");
    assert.ok(existsSync(state) && statSync(state).isDirectory(), state);
    assert.equal(resolveStateDirectory(directory), state);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
