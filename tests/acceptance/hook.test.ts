import { before, test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyFixture, initializeRepository, runCli } from "./run-cli.ts";

const sixParameters =
  "export function sixParameters(first: number, second: number, third: number, fourth: number, fifth: number, sixth: number) { return first; }\n";

before(() => {
  runCli(["install"]);
});

function stop(directory: string, active = false, environment: NodeJS.ProcessEnv = {}) {
  return runCli(["hook-stop"], {
    cwd: directory,
    input: JSON.stringify({ cwd: directory, stop_hook_active: active }),
    environment,
  });
}

function preparedRepository(config: object | null = { libraryDigest: false }): string {
  const directory = copyFixture("modular");
  initializeRepository(directory);
  if (config) {
    writeFileSync(join(directory, ".codemaster.json"), JSON.stringify(config));
  }
  return directory;
}

test("a changed file with a violation blocks the stop once", () => {
  const directory = preparedRepository();
  appendFileSync(join(directory, "src/user/user.service.ts"), sixParameters);
  const first = stop(directory);
  assert.equal(first.status, 0, first.stderr);
  const decision = JSON.parse(first.stdout);
  assert.equal(decision.decision, "block");
  assert.ok(decision.reason.startsWith("Run the codemaster skill (codemaster:codemaster) for this branch."), decision.reason);
  assert.match(decision.reason, /max-params/);
  const second = stop(directory);
  assert.equal(second.status, 0);
  assert.equal(second.stdout.trim(), "");
});

test("stop_hook_active records the state without blocking", () => {
  const directory = preparedRepository();
  appendFileSync(join(directory, "src/user/user.service.ts"), sixParameters);
  const active = stop(directory, true);
  assert.equal(active.status, 0);
  assert.equal(active.stdout.trim(), "");
  const after = stop(directory);
  assert.equal(after.stdout.trim(), "");
});

test("a package.json change alone runs the hook", () => {
  const directory = preparedRepository();
  writeFileSync(join(directory, "package.json"), '{\n  "name": "modular-fixture",\n  "dependencies": {\n    "axios": "1.0.0"\n  }\n}\n');
  const result = stop(directory);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).decision, "block");
});

test("hook: false in the shared or the local config silences it", () => {
  const shared = preparedRepository({ hook: false });
  appendFileSync(join(shared, "src/user/user.service.ts"), sixParameters);
  const sharedResult = stop(shared);
  assert.equal(sharedResult.status, 0, sharedResult.stderr);
  assert.equal(sharedResult.stdout.trim(), "");
  const local = preparedRepository();
  appendFileSync(join(local, "src/user/user.service.ts"), sixParameters);
  writeFileSync(join(local, ".codemaster.local.json"), JSON.stringify({ hook: false }));
  const localResult = stop(local);
  assert.equal(localResult.status, 0, localResult.stderr);
  assert.equal(localResult.stdout.trim(), "");
  writeFileSync(join(local, ".codemaster.local.json"), JSON.stringify({ hook: true }));
  assert.equal(JSON.parse(stop(local).stdout).decision, "block");
});

test("outside git the hook is silent", () => {
  const directory = mkdtempSync(join(tmpdir(), "codemaster-plain-"));
  writeFileSync(join(directory, "a.ts"), sixParameters);
  const result = stop(directory);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), "");
});

test("the first run writes the project profile and shows it", () => {
  const directory = preparedRepository(null);
  appendFileSync(join(directory, "src/user/user.service.ts"), sixParameters);
  const result = stop(directory);
  assert.equal(result.status, 0, result.stderr);
  const { reason } = JSON.parse(result.stdout);
  assert.match(reason, /codemaster profile/);
  assert.match(reason, /layout/);
  assert.equal(existsSync(join(directory, ".codemaster.json")), true);
});

test("a failed install never breaks the session", () => {
  const directory = preparedRepository();
  appendFileSync(join(directory, "src/user/user.service.ts"), sixParameters);
  const result = stop(directory, false, {
    CODEMASTER_DATA_DIR: mkdtempSync(join(tmpdir(), "codemaster-data-")),
    npm_config_registry: "http://127.0.0.1:9",
  });
  assert.equal(result.status, 0);
  assert.match(result.stderr, /^codemaster:/m);
});

test("a later stop reports only the file changed since the last check", () => {
  const directory = preparedRepository();
  appendFileSync(join(directory, "src/user/user.service.ts"), sixParameters);
  assert.match(JSON.parse(stop(directory).stdout).reason, /src\/user\/user\.service\.ts/);
  appendFileSync(join(directory, "src/order/order.service.ts"), sixParameters);
  const { reason } = JSON.parse(stop(directory).stdout);
  assert.match(reason, /max-params src\/order\/order\.service\.ts/);
  assert.doesNotMatch(reason, /user\.service\.ts/);
});

test("session start names the layout", () => {
  const directory = preparedRepository();
  const result = runCli(["hook-session-start"], { cwd: directory, input: JSON.stringify({ cwd: directory }) });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /codemaster: layout=modular/);
});
