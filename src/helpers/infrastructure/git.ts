import { existsSync, mkdirSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { CHECK_IGNORED_DIRECTORIES, CHECK_SOURCE_EXTENSIONS } from "../../consts/check.ts";
import { runProcess } from "./process.ts";

function runGit(directory: string, gitArguments: string[]): string | null {
  const { status, stdout } = runProcess("git", gitArguments, { cwd: directory });
  return status === 0 ? stdout : null;
}

function splitNullSeparated(output: string | null): string[] {
  return (output ?? "").split("\0").filter((path) => path !== "");
}

function isSourcePath(path: string): boolean {
  if (!CHECK_SOURCE_EXTENSIONS.includes(extname(path)) || path.endsWith(".d.ts")) {
    return false;
  }
  return !path.split("/").some((segment) => CHECK_IGNORED_DIRECTORIES.includes(segment));
}

function selectSourceFiles(directory: string, paths: string[]): string[] {
  const existing = paths.filter((path) => isSourcePath(path) && existsSync(join(directory, path)));
  return [...new Set(existing)].sort();
}

function hasRevision(directory: string, revision: string): boolean {
  return runGit(directory, ["rev-parse", "--verify", "--quiet", revision]) !== null;
}

function findDiffBase(directory: string): string | null {
  return findMergeBase(directory) ?? (hasRevision(directory, "HEAD") ? "HEAD" : null);
}

function listChangedPaths(directory: string): string[] {
  const base = findDiffBase(directory);
  const changed = base === null ? [] : splitNullSeparated(runGit(directory, ["diff", "--name-only", "-z", "--relative", base]));
  const untracked = splitNullSeparated(runGit(directory, ["ls-files", "-z", "--others", "--exclude-standard"]));
  return [...changed, ...untracked];
}

export function isRepository(directory: string): boolean {
  return runGit(directory, ["rev-parse", "--is-inside-work-tree"])?.trim() === "true";
}

export function findBaseBranch(directory: string): string | null {
  const remote = runGit(directory, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])?.trim();
  if (remote) {
    return remote;
  }
  const current = runGit(directory, ["branch", "--show-current"])?.trim();
  const candidates = ["main", "master", "dev"].filter((branch) => branch !== current);
  return candidates.find((branch) => hasRevision(directory, `refs/heads/${branch}`)) ?? null;
}

export function findMergeBase(directory: string): string | null {
  const base = findBaseBranch(directory);
  if (base === null) {
    return null;
  }
  return runGit(directory, ["merge-base", "HEAD", base])?.trim() || null;
}

export function listChangedFiles(directory: string): string[] {
  return selectSourceFiles(directory, listChangedPaths(directory));
}

export function listAllSourceFiles(directory: string): string[] {
  const output = runGit(directory, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  return selectSourceFiles(directory, splitNullSeparated(output));
}

export function listChangedLineRanges(directory: string, file: string): Array<{ start: number; end: number }> | "new" {
  const base = findDiffBase(directory);
  if (base === null || runGit(directory, ["ls-files", "--error-unmatch", "--", file]) === null) {
    return "new";
  }
  const diff = runGit(directory, ["diff", "-U0", base, "--", file]) ?? "";
  const ranges: Array<{ start: number; end: number }> = [];
  for (const match of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    if (count > 0) {
      ranges.push({ start, end: start + count - 1 });
    }
  }
  return ranges;
}

export function isPackageManifestChanged(directory: string): boolean {
  return listChangedPaths(directory).some((path) => basename(path) === "package.json");
}

export function resolveStateDirectory(directory: string): string {
  const gitPath = runGit(directory, ["rev-parse", "--git-path", "codemaster"])?.trim();
  if (!gitPath) {
    throw new Error(`not a git repository: ${directory}`);
  }
  const state = resolve(directory, gitPath);
  mkdirSync(state, { recursive: true });
  return state;
}
