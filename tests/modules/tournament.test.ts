import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CONFIG_DEFAULTS } from "../../src/consts/config.ts";
import { scoreVariants } from "../../src/modules/tournament.ts";
import type { ConfigWeights } from "../../src/interfaces/config.ts";
import type { TournamentMetrics, TournamentVariantName } from "../../src/interfaces/tournament.ts";

const PRECISION = 1e-9;

function assertClose(actual: number | null | undefined, expected: number): void {
  assert.equal(typeof actual, "number", `expected a number close to ${expected}, got ${actual}`);
  assert.ok(Math.abs((actual as number) - expected) < PRECISION, `expected ${expected}, got ${actual}`);
}

function scoreOf(
  outcome: { scores: Array<{ variant: TournamentVariantName; score: number | null }> },
  variant: TournamentVariantName,
): number | null | undefined {
  return outcome.scores.find((entry) => entry.variant === variant)?.score;
}

function metricsWith(overrides: Partial<TournamentMetrics>): TournamentMetrics {
  return {
    readability: 1,
    length: 3,
    bytecode: 9,
    speed: 100,
    bytecodePerToken: 2,
    desugared: 0,
    ...overrides,
  };
}

const BEST = metricsWith({});

const HALF_AS_GOOD = metricsWith({
  readability: 3,
  length: 7,
  bytecode: 19,
  speed: 201,
  bytecodePerToken: 4,
  desugared: 1,
});

test("scoreVariants: the variant better on every metric wins with the full weight sum", () => {
  const outcome = scoreVariants(
    [
      { variant: "first", metrics: HALF_AS_GOOD },
      { variant: "optimized", metrics: BEST },
    ],
    CONFIG_DEFAULTS.tournament.weights,
  );
  assert.equal(outcome.winner, "optimized");
  assert.deepEqual(
    outcome.scores.map((entry) => entry.variant),
    ["first", "optimized"],
  );
  assertClose(scoreOf(outcome, "optimized"), 1);
  assertClose(scoreOf(outcome, "first"), 0.5);
});

test("scoreVariants: with speed null for both, the weights used still sum to 1", () => {
  const outcome = scoreVariants(
    [
      { variant: "first", metrics: { ...HALF_AS_GOOD, speed: null } },
      { variant: "readable", metrics: { ...BEST, speed: null } },
    ],
    CONFIG_DEFAULTS.tournament.weights,
  );
  assert.equal(outcome.winner, "readable");
  assertClose(scoreOf(outcome, "readable"), 1);
  assertClose(scoreOf(outcome, "first"), 0.5);
});

test("scoreVariants: the weight of an unmeasured speed is shared equally among the rest", () => {
  const weights: ConfigWeights = { readability: 0.4, length: 0.1, bytecode: 0.1, speed: 0.2, closeness: 0.2 };
  const outcome = scoreVariants(
    [
      { variant: "first", metrics: { ...BEST, speed: null } },
      { variant: "optimized", metrics: { ...BEST, readability: 3, speed: null } },
    ],
    weights,
  );
  assertClose(scoreOf(outcome, "first"), 1);
  assertClose(scoreOf(outcome, "optimized"), 0.45 * 0.5 + 0.15 + 0.15 + 0.25);
});

test("scoreVariants: each plain metric scores (min + 1) / (value + 1)", () => {
  const cases: Array<{ metric: keyof ConfigWeights; overrides: Partial<TournamentMetrics>; expected: number }> = [
    { metric: "readability", overrides: { readability: 4 }, expected: 2 / 5 },
    { metric: "length", overrides: { length: 9 }, expected: 4 / 10 },
    { metric: "bytecode", overrides: { bytecode: 29 }, expected: 10 / 30 },
    { metric: "speed", overrides: { speed: 399 }, expected: 101 / 400 },
  ];
  for (const { metric, overrides, expected } of cases) {
    const weights: ConfigWeights = { readability: 0, length: 0, bytecode: 0, speed: 0, closeness: 0, [metric]: 1 };
    const outcome = scoreVariants(
      [
        { variant: "readable", metrics: BEST },
        { variant: "first", metrics: metricsWith(overrides) },
      ],
      weights,
    );
    assertClose(scoreOf(outcome, "readable"), 1);
    assertClose(scoreOf(outcome, "first"), expected);
  }
});

test("scoreVariants: closeness is the mean of min/value for bytecodePerToken and (min+1)/(value+1) for desugared", () => {
  const weights: ConfigWeights = { readability: 0, length: 0, bytecode: 0, speed: 0, closeness: 1 };
  const outcome = scoreVariants(
    [
      { variant: "readable", metrics: metricsWith({ bytecodePerToken: 2, desugared: 0 }) },
      { variant: "first", metrics: metricsWith({ bytecodePerToken: 8, desugared: 1 }) },
    ],
    weights,
  );
  assertClose(scoreOf(outcome, "readable"), 1);
  assertClose(scoreOf(outcome, "first"), (2 / 8 + 1 / 2) / 2);
});

test("scoreVariants: a tie goes to readable, then first, then optimized", () => {
  const allThree = scoreVariants(
    [
      { variant: "optimized", metrics: BEST },
      { variant: "first", metrics: BEST },
      { variant: "readable", metrics: BEST },
    ],
    CONFIG_DEFAULTS.tournament.weights,
  );
  assert.equal(allThree.winner, "readable");

  const withoutReadable = scoreVariants(
    [
      { variant: "optimized", metrics: BEST },
      { variant: "first", metrics: BEST },
    ],
    CONFIG_DEFAULTS.tournament.weights,
  );
  assert.equal(withoutReadable.winner, "first");
});

test("scoreVariants: a failed variant gets score null and does not set the minimum", () => {
  const outcome = scoreVariants(
    [
      { variant: "first", metrics: null },
      { variant: "readable", metrics: HALF_AS_GOOD },
      { variant: "optimized", metrics: HALF_AS_GOOD },
    ],
    CONFIG_DEFAULTS.tournament.weights,
  );
  assert.equal(scoreOf(outcome, "first"), null);
  assertClose(scoreOf(outcome, "readable"), 1);
  assertClose(scoreOf(outcome, "optimized"), 1);
  assert.equal(outcome.winner, "readable");
});

test("scoreVariants: when every variant failed, the winner is none", () => {
  const outcome = scoreVariants(
    [
      { variant: "first", metrics: null },
      { variant: "readable", metrics: null },
      { variant: "optimized", metrics: null },
    ],
    CONFIG_DEFAULTS.tournament.weights,
  );
  assert.equal(outcome.winner, "none");
  assert.deepEqual(outcome.scores, [
    { variant: "first", score: null },
    { variant: "readable", score: null },
    { variant: "optimized", score: null },
  ]);
});

const RUNNER = resolve(import.meta.dirname, "../../bin/tournament-runner.ts");

const RUNNER_DIRECTORY = mkdtempSync(join(tmpdir(), "codemaster-runner-"));

after(() => {
  rmSync(RUNNER_DIRECTORY, { recursive: true, force: true });
});

function writeRunnerFile(name: string, text: string): string {
  const path = join(RUNNER_DIRECTORY, name);
  writeFileSync(path, text);
  return path;
}

function runRunner(
  runnerArguments: string[],
  environment: NodeJS.ProcessEnv = {},
): { result: unknown; elapsedNanoseconds: number } {
  const started = process.hrtime.bigint();
  const { stdout, stderr, status } = spawnSync(process.execPath, [RUNNER, ...runnerArguments], {
    cwd: RUNNER_DIRECTORY,
    env: { ...process.env, ...environment },
    encoding: "utf8",
  });
  const elapsedNanoseconds = Number(process.hrtime.bigint() - started);
  assert.equal(status, 0, stderr);
  const line = stdout.split("\n").find((text) => text.startsWith("CODEMASTER_RESULT "));
  assert.ok(line !== undefined, `no CODEMASTER_RESULT line in: ${stdout}`);
  return { result: JSON.parse(line.slice("CODEMASTER_RESULT ".length)), elapsedNanoseconds };
}

const SUM_CASES = writeRunnerFile(
  "sum-cases.mjs",
  "export const cases = [{ input: [[1, 2, 3]], expected: 6 }, { input: [[]], expected: 0 }];\n",
);

const SUM_CORRECT = writeRunnerFile(
  "sum-correct.mjs",
  "export function sumList(values) { return values.reduce((total, value) => total + value, 0); }\n",
);

test("runner verify: a correct variant passes", () => {
  const { result } = runRunner(["verify", SUM_CORRECT, SUM_CASES, "sumList", "0"]);
  assert.deepEqual(result, { passed: true });
});

test("runner verify: a wrong variant fails with the first mismatching case", () => {
  const variant = writeRunnerFile(
    "sum-wrong.mjs",
    "export function sumList(values) { return values.length === 0 ? 1 : values.reduce((total, value) => total + value, 0); }\n",
  );
  const { result } = runRunner(["verify", variant, SUM_CASES, "sumList", "0"]);
  assert.deepEqual(result, { passed: false, failure: "case 1: expected 0 got 1" });
});

test("runner verify: an async variant is awaited", () => {
  const variant = writeRunnerFile(
    "sum-async.mjs",
    "export async function sumList(values) { return values.reduce((total, value) => total + value, 0); }\n",
  );
  const { result } = runRunner(["verify", variant, SUM_CASES, "sumList", "0"]);
  assert.deepEqual(result, { passed: true });
});

test("runner verify: a thrown error fails with its message", () => {
  const variant = writeRunnerFile("sum-throws.mjs", "export function sumList() { throw new Error(\"boom\"); }\n");
  const { result } = runRunner(["verify", variant, SUM_CASES, "sumList", "0"]);
  assert.deepEqual(result, { passed: false, failure: "case 0: threw boom" });
});

test("runner verify: a missing export fails", () => {
  const { result } = runRunner(["verify", SUM_CORRECT, SUM_CASES, "missingFunction", "0"]);
  assert.deepEqual(result, { passed: false, failure: "no exported function missingFunction" });
});

test("runner measure: runs exactly the given number of calls and reports nanoseconds per call", () => {
  const counterFile = join(RUNNER_DIRECTORY, "counter.txt");
  const variant = writeRunnerFile(
    "slow-count.mjs",
    [
      "import { writeFileSync } from \"node:fs\";",
      "let calls = 0;",
      "process.on(\"exit\", () => writeFileSync(process.env.CODEMASTER_COUNTER_FILE, String(calls)));",
      "export function slowCount(value) {",
      "  calls += 1;",
      "  const until = process.hrtime.bigint() + 3000000n;",
      "  while (process.hrtime.bigint() < until) {}",
      "  return value;",
      "}",
      "",
    ].join("\n"),
  );
  const cases = writeRunnerFile(
    "slow-cases.mjs",
    "export const cases = [{ input: [1], expected: 1 }, { input: [2], expected: 2 }, { input: [3], expected: 3 }];\n",
  );
  const iterations = 7;
  const { result, elapsedNanoseconds } = runRunner(
    ["measure", variant, cases, "slowCount", String(iterations)],
    { CODEMASTER_COUNTER_FILE: counterFile },
  );
  assert.equal(readFileSync(counterFile, "utf8"), String(iterations));
  const { nanosecondsPerCall } = result as { nanosecondsPerCall: number };
  assert.ok(Number.isFinite(nanosecondsPerCall), `not finite: ${nanosecondsPerCall}`);
  assert.ok(nanosecondsPerCall >= 3000000, `each call spins 3 ms, got ${nanosecondsPerCall} ns`);
  assert.ok(
    nanosecondsPerCall * iterations <= elapsedNanoseconds,
    `${nanosecondsPerCall} ns × ${iterations} exceeds the process wall time ${elapsedNanoseconds} ns`,
  );
});
