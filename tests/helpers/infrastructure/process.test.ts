import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { runProcess } from "../../../src/helpers/infrastructure/process.ts";

test("runProcess reports the exit status", () => {
  const result = runProcess("node", ["-e", "process.exit(3)"], { cwd: tmpdir() });
  assert.equal(result.status, 3);
  assert.equal(result.timedOut, false);
});

test("runProcess marks a process killed by its timeout", () => {
  const result = runProcess("node", ["-e", "setTimeout(()=>{},5000)"], { cwd: tmpdir(), timeoutMilliseconds: 100 });
  assert.equal(result.timedOut, true);
});

test("runProcess passes input and environment and captures stdout and stderr", () => {
  const result = runProcess(
    "node",
    ["-e", "process.stdin.pipe(process.stdout); process.stderr.write(process.env.CODEMASTER_PROBE)"],
    { cwd: tmpdir(), input: "hello", environment: { ...process.env, CODEMASTER_PROBE: "probe" } },
  );
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "hello");
  assert.equal(result.stderr, "probe");
});

test("runProcess captures output larger than the default 1 MiB buffer", () => {
  const size = 2 * 1024 * 1024;
  const result = runProcess("node", ["-e", `process.stdout.write("x".repeat(${size}))`], { cwd: tmpdir() });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.length, size);
});
