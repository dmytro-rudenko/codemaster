import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI_PATH = resolve(import.meta.dirname, "../../bin/codemaster.ts");

const GUARD_PATH = resolve(import.meta.dirname, "../../bin/hook-guard.mjs");

const USAGE = "usage: codemaster <check|conventions|tournament|libraries|install|hook-stop|hook-session-start> [arguments]\n";

function runEntry(
  entryArguments: string[],
  options: { cwd?: string; input?: string; nodeVersion?: string } = {},
): { status: number | null; stdout: string; stderr: string } {
  const { cwd = process.cwd(), input = "", nodeVersion } = options;
  const preload =
    nodeVersion === undefined
      ? []
      : [
          "--import",
          `data:text/javascript,Object.defineProperty(process, "versions", { value: { ...process.versions, node: "${nodeVersion}" } });`,
        ];
  const result = spawnSync(process.execPath, [...preload, ...entryArguments], { cwd, input, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function runCodemaster(
  argumentsList: string[],
  options: { cwd?: string; input?: string; nodeVersion?: string } = {},
): { status: number | null; stdout: string; stderr: string } {
  return runEntry([CLI_PATH, ...argumentsList], options);
}

function runGuard(
  argumentsList: string[],
  options: { cwd?: string; input?: string; nodeVersion?: string } = {},
): { status: number | null; stdout: string; stderr: string } {
  return runEntry([GUARD_PATH, CLI_PATH, ...argumentsList], options);
}

function withProject(config: Record<string, unknown>, body: (directory: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "codemaster-cli-"));
  try {
    writeFileSync(join(directory, ".codemaster.json"), JSON.stringify(config));
    body(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

for (const argumentsList of [[], ["lint"], ["toString"]]) {
  test(`codemaster ${argumentsList.join(" ") || "without a command"} prints the usage and exits 2`, () => {
    const result = runCodemaster(argumentsList);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, USAGE);
  });
}

for (const nodeVersion of ["22.17.0", "21.9.0"]) {
  test(`Node ${nodeVersion} gets the version message and exit 0 before any command runs`, () => {
    const result = runCodemaster(["lint"], { nodeVersion });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, `codemaster: requires Node >= 22.18 (found ${nodeVersion})\n`);
    assert.equal(result.stderr, "");
  });
}

for (const nodeVersion of ["22.18.0", "23.0.0"]) {
  test(`Node ${nodeVersion} passes the version check`, () => {
    const result = runCodemaster(["lint"], { nodeVersion });
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, USAGE);
  });
}

test("a hook with unparsable input reports the error on stderr and exits 0", () => {
  const result = runCodemaster(["hook-stop"], { input: "not json" });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /^codemaster: .*JSON.*\n$/);
});

test("a hook reads the project root from the input cwd", () => {
  withProject({ sourceRoot: "lib" }, (directory) => {
    const result = runCodemaster(["hook-session-start"], { input: JSON.stringify({ cwd: directory }) });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout.split("\n")[0], /, sourceRoot=lib$/);
  });
});

test("a hook without an input cwd uses the process directory", () => {
  withProject({ sourceRoot: "lib" }, (directory) => {
    const result = runCodemaster(["hook-session-start"], { cwd: directory, input: "{}" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout.split("\n")[0], /, sourceRoot=lib$/);
  });
});

test("the guard on Node 20 prints nothing and exits 0 without loading the target", () => {
  const result = runGuard(["hook-stop"], { nodeVersion: "20.0.0" });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

test("the guard on Node 23.5 without default type stripping stays silent", () => {
  withProject({ sourceRoot: "lib" }, (directory) => {
    const input = JSON.stringify({ cwd: directory });
    assert.notEqual(runGuard(["hook-session-start"], { input, nodeVersion: "23.6.0" }).stdout, "");
    const result = runGuard(["hook-session-start"], { input, nodeVersion: "23.5.0" });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "");
  });
});

test("the guard runs a hook with the same output as calling the CLI directly", () => {
  withProject({ sourceRoot: "lib" }, (directory) => {
    const input = JSON.stringify({ cwd: directory });
    const direct = runCodemaster(["hook-session-start"], { input });
    const guarded = runGuard(["hook-session-start"], { input });
    assert.equal(guarded.status, 0, guarded.stderr);
    assert.match(guarded.stdout.split("\n")[0], /, sourceRoot=lib$/);
    assert.deepEqual(guarded, direct);
  });
});

test("the guard reports a target that fails to load on stderr and exits 0", () => {
  const result = runEntry([GUARD_PATH, join(tmpdir(), "codemaster-missing-target.ts"), "hook-stop"]);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /^codemaster: .+\n$/);
});

test("a command other than a hook lets its error escape with a non-zero exit", () => {
  withProject({}, (directory) => {
    const result = runCodemaster(["tournament", join(directory, "missing")], { cwd: directory });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /ENOENT/);
  });
});
