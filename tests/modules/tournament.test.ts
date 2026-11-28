import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CONFIG_DEFAULTS } from "../../src/consts/config.ts";
import { findCandidates, runTournament, scoreVariants } from "../../src/modules/tournament.ts";
import { ensureInstalled } from "../../src/modules/install.ts";
import { copyFixture, initializeRepository, runCli, stateDirectory } from "../acceptance/run-cli.ts";
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

before(() => {
  ensureInstalled();
});

const CORRECT_SUM = "export function sumList(values) { return values.reduce((total, value) => total + value, 0); }\n";

function dyingSum(condition: string): string {
  return [
    `const dying = process.argv[2] === "measure" && ${condition};`,
    "export function sumList(values) {",
    "  if (dying) {",
    "    process.stderr.write(\"dying\\n\");",
    "    process.exit(3);",
    "  }",
    "  return values.reduce((total, value) => total + value, 0);",
    "}",
    "",
  ].join("\n");
}

function createTournament(variants: Record<TournamentVariantName, string>): string {
  const directory = mkdtempSync(join(tmpdir(), "codemaster-tournament-"));
  writeFileSync(join(directory, "target.json"), JSON.stringify({ file: "src/math.ts", functionName: "sumList" }));
  writeFileSync(
    join(directory, "cases.ts"),
    "export const cases = [{ input: [[1, 2, 3]], expected: 6 }, { input: [[]], expected: 0 }];\n",
  );
  for (const [variant, text] of Object.entries(variants)) {
    writeFileSync(join(directory, `${variant}.ts`), text);
  }
  return directory;
}

function assertFiniteScores(variants: Array<{ passed: boolean; score: number | null }>): void {
  for (const { score } of variants.filter(({ passed }) => passed)) {
    assert.ok(typeof score === "number" && Number.isFinite(score), `score ${score} is not finite`);
  }
}

test("runTournament: a variant whose speed run dies drops out with the run's first output line", async () => {
  const directory = createTournament({
    readable: CORRECT_SUM,
    first: dyingSum("!process.execArgv.includes(\"--print-bytecode\")"),
    optimized: CORRECT_SUM,
  });
  try {
    const outcome = await runTournament(directory, CONFIG_DEFAULTS);
    const first = outcome.variants.find(({ variant }) => variant === "first");
    assert.deepEqual(
      { passed: first?.passed, failure: first?.failure, metrics: first?.metrics, score: first?.score },
      { passed: false, failure: "measure: dying", metrics: null, score: null },
    );
    assertFiniteScores(outcome.variants);
    assert.notEqual(outcome.winner, "first");
    assert.notEqual(outcome.winner, "none");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("runTournament: a variant whose bytecode run dies drops out as a measure failure", async () => {
  const directory = createTournament({
    readable: CORRECT_SUM,
    first: CORRECT_SUM,
    optimized: dyingSum("process.execArgv.includes(\"--print-bytecode\")"),
  });
  try {
    const outcome = await runTournament(directory, CONFIG_DEFAULTS);
    const optimized = outcome.variants.find(({ variant }) => variant === "optimized");
    assert.equal(optimized?.passed, false);
    assert.match(optimized?.failure ?? "", /^measure: /);
    assert.equal(optimized?.score, null);
    assertFiniteScores(outcome.variants);
    assert.notEqual(outcome.winner, "optimized");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("runTournament: a variant without a Bytecode length for the target drops out", async () => {
  const directory = createTournament({
    readable: CORRECT_SUM,
    first: [
      "function sumList(values) { return 0; }",
      "function realSum(values) { return values.reduce((total, value) => total + value, 0); }",
      "export { realSum as sumList };",
      "",
    ].join("\n"),
    optimized: CORRECT_SUM,
  });
  try {
    const outcome = await runTournament(directory, CONFIG_DEFAULTS);
    const first = outcome.variants.find(({ variant }) => variant === "first");
    assert.equal(first?.passed, false);
    assert.equal(first?.failure, "bytecode: not found");
    assert.equal(first?.score, null);
    assertFiniteScores(outcome.variants);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function doneFilePath(directory: string): string {
  const state = stateDirectory(directory);
  mkdirSync(state, { recursive: true });
  return join(state, "tournament-done.json");
}

for (const [label, content] of [
  ["corrupt", "{not json"],
  ["non-array", "{\"key\":\"src/math.ts#scoreValues\",\"skipped\":true}"],
]) {
  test(`findCandidates: a ${label} done file reads as empty`, async () => {
    const directory = copyFixture("candidates");
    initializeRepository(directory, { commitFiles: false });
    writeFileSync(doneFilePath(directory), content);
    const candidates = await findCandidates({ projectRoot: directory, config: CONFIG_DEFAULTS });
    assert.ok(
      candidates.some(({ file, functionName }) => file === "src/math.ts" && functionName === "scoreValues"),
      JSON.stringify(candidates),
    );
  });
}

test("--skip over a corrupt done file writes a valid array", () => {
  const directory = copyFixture("candidates");
  initializeRepository(directory, { commitFiles: false });
  const donePath = doneFilePath(directory);
  writeFileSync(donePath, "{not json");
  const result = runCli(["tournament", "--skip", "src/math.ts#scoreValues", "--reason", "closure"], { cwd: directory });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(readFileSync(donePath, "utf8")), [
    { key: "src/math.ts#scoreValues", bodyHash: null, skipped: true, reason: "closure" },
  ]);
});

for (const skipArguments of [["--skip"], ["--skip", "src/math.ts#scoreValues"], ["--skip", "src/math.ts#scoreValues", "--reason"]]) {
  test(`${skipArguments.join(" ")} prints the skip usage, returns 2 and writes nothing`, () => {
    const directory = copyFixture("candidates");
    initializeRepository(directory, { commitFiles: false });
    const result = runCli(["tournament", ...skipArguments], { cwd: directory });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /^usage: codemaster tournament --skip <file>#<name> --reason <text>$/m);
    assert.equal(existsSync(join(stateDirectory(directory), "tournament-done.json")), false);
  });
}

for (const usageArguments of [[], ["--done"]]) {
  test(`tournament ${usageArguments.join(" ")} prints the general usage and returns 2`, () => {
    const directory = copyFixture("candidates");
    initializeRepository(directory, { commitFiles: false });
    const result = runCli(["tournament", ...usageArguments], { cwd: directory });
    assert.equal(result.status, 2);
    assert.equal(
      result.stderr,
      "usage: codemaster tournament <dir> | --candidates | --skip <file>#<name> --reason <text> | --done <dir>\n",
    );
  });
}

test("tournament --candidates returns 1 with the install message when the install fails", () => {
  const directory = copyFixture("candidates");
  initializeRepository(directory, { commitFiles: false });
  const result = runCli(["tournament", "--candidates"], {
    cwd: directory,
    environment: { CODEMASTER_DATA_DIR: join(directory, "src/math.ts", "data") },
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /^codemaster: install failed \(.+\)\n$/);
});

function writeTarget(functionName: string): string {
  const tournamentDirectory = mkdtempSync(join(tmpdir(), "codemaster-done-"));
  writeFileSync(join(tournamentDirectory, "target.json"), JSON.stringify({ file: "src/math.ts", functionName }));
  return tournamentDirectory;
}

test("tournament --done records the body hash and the function leaves the candidates", () => {
  const directory = copyFixture("candidates");
  initializeRepository(directory, { commitFiles: false });
  const result = runCli(["tournament", "--done", writeTarget("scoreValues")], { cwd: directory });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  const [entry] = JSON.parse(readFileSync(doneFilePath(directory), "utf8"));
  assert.equal(entry.key, "src/math.ts#scoreValues");
  assert.match(entry.bodyHash, /^[0-9a-f]+$/);
  assert.equal(entry.skipped, false);
  assert.equal(entry.reason, null);
  const after = runCli(["tournament", "--candidates"], { cwd: directory });
  assert.doesNotMatch(after.stdout, /scoreValues/);
});

test("tournament --done records a null body hash for a function the file no longer has", () => {
  const directory = copyFixture("candidates");
  initializeRepository(directory, { commitFiles: false });
  const result = runCli(["tournament", "--done", writeTarget("vanished")], { cwd: directory });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(readFileSync(doneFilePath(directory), "utf8")), [
    { key: "src/math.ts#vanished", bodyHash: null, skipped: false, reason: null },
  ]);
});

test("findCandidates keeps a done function whose body hash changed", async () => {
  const directory = copyFixture("candidates");
  initializeRepository(directory, { commitFiles: false });
  writeFileSync(
    doneFilePath(directory),
    JSON.stringify([{ key: "src/math.ts#scoreValues", bodyHash: "stale", skipped: false, reason: null }]),
  );
  const candidates = await findCandidates({ projectRoot: directory, config: CONFIG_DEFAULTS });
  assert.deepEqual(candidates.map(({ functionName }) => functionName), ["scoreValues"]);
});

test("findCandidates takes a function by body lines alone and drops it below both thresholds", async () => {
  const directory = copyFixture("candidates");
  initializeRepository(directory, { commitFiles: false });
  const byLines = { ...CONFIG_DEFAULTS, tournament: { ...CONFIG_DEFAULTS.tournament, minComplexity: 99, minLines: 9 } };
  const tooShort = { ...CONFIG_DEFAULTS, tournament: { ...CONFIG_DEFAULTS.tournament, minComplexity: 99, minLines: 10 } };
  const listed = await findCandidates({ projectRoot: directory, config: byLines });
  assert.deepEqual(listed.map(({ functionName, lines }) => `${functionName} ${lines}`), ["scoreValues 9"]);
  assert.deepEqual(await findCandidates({ projectRoot: directory, config: tooShort }), []);
});

test("tournament --candidates outside git explains itself and returns 0", () => {
  const directory = copyFixture("candidates");
  try {
    const { status, stdout, stderr } = runCli(["tournament", "--candidates"], { cwd: directory });
    assert.equal(status, 0, stderr);
    assert.equal(stdout.trim(), "codemaster: not a git repository; the tournament keeps its state in git");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("runTournament refuses a functionName that is not an identifier", async () => {
  const directory = copyFixture("tournament/good");
  try {
    writeFileSync(join(directory, "target.json"), "{\"file\":\"src/math.ts\",\"functionName\":\"sumList --inspect\"}\n");
    await assert.rejects(runTournament(directory, CONFIG_DEFAULTS), /functionName must be an identifier/);
    assert.equal(existsSync(join(directory, "result.json")), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("findCandidates looks only at the files it is given", async () => {
  const directory = copyFixture("candidates");
  initializeRepository(directory, { commitFiles: false });
  try {
    assert.deepEqual(await findCandidates({ projectRoot: directory, config: CONFIG_DEFAULTS, files: [] }), []);
    const listed = await findCandidates({ projectRoot: directory, config: CONFIG_DEFAULTS, files: ["src/math.ts"] });
    assert.deepEqual(listed.map(({ file, functionName }) => `${file}#${functionName}`), ["src/math.ts#scoreValues"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("findCandidates on given files keeps only functions whose lines changed since the base", async () => {
  const directory = copyFixture("candidates");
  initializeRepository(directory);
  try {
    const source = readFileSync(join(directory, "src/math.ts"), "utf8");
    const renamed = source.replace("scoreValues", "rankValues").replace("score += 1", "score += 3");
    writeFileSync(join(directory, "src/math.ts"), `${source}\n${renamed}`);
    writeFileSync(join(directory, "src/fresh.ts"), renamed.replace("rankValues", "freshValues"));
    const listed = await findCandidates({
      projectRoot: directory,
      config: CONFIG_DEFAULTS,
      files: ["src/fresh.ts", "src/math.ts"],
    });
    assert.deepEqual(listed.map(({ file, functionName }) => `${file}#${functionName}`), [
      "src/fresh.ts#freshValues",
      "src/math.ts#rankValues",
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
