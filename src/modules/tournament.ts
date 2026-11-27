import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  TOURNAMENT_DEOPT_PENALTY,
  TOURNAMENT_ITERATIONS,
  TOURNAMENT_RUNS,
  TOURNAMENT_TIE_ORDER,
  TOURNAMENT_TIMEOUT_MILLISECONDS,
} from "../consts/tournament.ts";
import { isRepository, listChangedFiles, listChangedLineRanges, resolveStateDirectory } from "../helpers/infrastructure/git.ts";
import { parseSource } from "../helpers/infrastructure/ast-grep.ts";
import { runProcess } from "../helpers/infrastructure/process.ts";
import { detectLayout, resolveFileRole } from "../helpers/logic/file-role.ts";
import {
  countBodyLines,
  countDesugared,
  countTokens,
  listFunctions,
  measureCognitiveComplexity,
} from "../helpers/logic/function-metrics.ts";
import { hashText } from "../utils/hash.ts";
import { ensureInstalled } from "./install.ts";
import type { CommandContext } from "../interfaces/command.ts";
import type { ConfigProject, ConfigWeights } from "../interfaces/config.ts";
import type {
  TournamentCandidate,
  TournamentDoneEntry,
  TournamentMetrics,
  TournamentResult,
  TournamentVariantName,
  TournamentVariantResult,
} from "../interfaces/tournament.ts";

function relativeScore(minimum: number, value: number): number {
  return (minimum + 1) / (value + 1);
}

function ratioScore(minimum: number, value: number): number {
  return value === 0 ? 1 : minimum / value;
}

function findMinimums(measured: TournamentMetrics[]): Record<keyof TournamentMetrics, number> {
  const keys: Array<keyof TournamentMetrics> = ["readability", "length", "bytecode", "speed", "bytecodePerToken", "desugared"];
  const entries = keys.map((key) => [key, Math.min(...measured.map((metrics) => metrics[key] ?? Infinity))]);
  return Object.fromEntries(entries) as Record<keyof TournamentMetrics, number>;
}

function resolveWeights(weights: ConfigWeights, speedMeasured: boolean): ConfigWeights {
  if (speedMeasured) {
    return weights;
  }
  const share = weights.speed / 4;
  return {
    readability: weights.readability + share,
    length: weights.length + share,
    bytecode: weights.bytecode + share,
    speed: 0,
    closeness: weights.closeness + share,
  };
}

function scoreMetrics(
  metrics: TournamentMetrics,
  minimums: Record<keyof TournamentMetrics, number>,
  weights: ConfigWeights,
): number {
  const closeness =
    (ratioScore(minimums.bytecodePerToken, metrics.bytecodePerToken) + relativeScore(minimums.desugared, metrics.desugared)) / 2;
  const speed = metrics.speed === null ? 0 : relativeScore(minimums.speed, metrics.speed);
  return (
    relativeScore(minimums.readability, metrics.readability) * weights.readability +
    relativeScore(minimums.length, metrics.length) * weights.length +
    relativeScore(minimums.bytecode, metrics.bytecode) * weights.bytecode +
    speed * weights.speed +
    closeness * weights.closeness
  );
}

export function scoreVariants(
  metricsList: Array<{ variant: TournamentVariantName; metrics: TournamentMetrics | null }>,
  weights: ConfigWeights,
): { scores: Array<{ variant: TournamentVariantName; score: number | null }>; winner: TournamentVariantName | "none" } {
  const measured = metricsList.flatMap(({ metrics }) => (metrics === null ? [] : [metrics]));
  const minimums = findMinimums(measured);
  const effective = resolveWeights(weights, measured.length > 0 && measured.every(({ speed }) => speed !== null));
  const scores = metricsList.map(({ variant, metrics }) => ({
    variant,
    score: metrics === null ? null : scoreMetrics(metrics, minimums, effective),
  }));
  const tieRank = (variant: TournamentVariantName): number => TOURNAMENT_TIE_ORDER.indexOf(variant);
  const ranked = scores
    .filter(({ score }) => score !== null)
    .sort((left, right) => (right.score as number) - (left.score as number) || tieRank(left.variant) - tieRank(right.variant));
  return { scores, winner: ranked[0]?.variant ?? "none" };
}

function readDoneEntries(projectRoot: string): TournamentDoneEntry[] {
  const path = join(resolveStateDirectory(projectRoot), "tournament-done.json");
  if (!existsSync(path)) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(parsed) ? (parsed as TournamentDoneEntry[]) : [];
  } catch {
    return [];
  }
}

function appendDoneEntry(projectRoot: string, entry: TournamentDoneEntry): void {
  const entries = readDoneEntries(projectRoot).filter(({ key }) => key !== entry.key);
  const path = join(resolveStateDirectory(projectRoot), "tournament-done.json");
  writeFileSync(path, `${JSON.stringify([...entries, entry], null, 2)}\n`);
}

function isCandidateFile(file: string, options: { projectRoot: string; config: ConfigProject }): boolean {
  const { projectRoot, config } = options;
  if (![".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"].includes(extname(file)) || file.endsWith(".d.ts")) {
    return false;
  }
  const { role } = resolveFileRole(file, { layout: detectLayout(projectRoot, config), config });
  if (role === "test") {
    return false;
  }
  return !(role === "helper" && (file.includes("/infrastructure/") || file.includes("/external/")));
}

function overlapsChange(ranges: Array<{ start: number; end: number }> | "new", line: number, endLine: number): boolean {
  return ranges === "new" || ranges.some(({ start, end }) => start <= endLine && end >= line);
}

export async function findCandidates(input: { projectRoot: string; config: ConfigProject }): Promise<TournamentCandidate[]> {
  const { projectRoot, config } = input;
  const { minComplexity, minLines } = config.tournament;
  const doneEntries = readDoneEntries(projectRoot);
  const isDone = (key: string, bodyHash: string): boolean =>
    doneEntries.some((entry) => entry.key === key && (entry.skipped || entry.bodyHash === bodyHash));
  const candidates: TournamentCandidate[] = [];
  for (const file of listChangedFiles(projectRoot).filter((path) => isCandidateFile(path, input))) {
    const ranges = listChangedLineRanges(projectRoot, file);
    const root = (await parseSource(file, readFileSync(join(projectRoot, file), "utf8"))).root();
    for (const { node, name, line, endLine, usesThis, bodyText } of listFunctions(root)) {
      if (name === null || usesThis || !overlapsChange(ranges, line, endLine)) {
        continue;
      }
      const complexity = measureCognitiveComplexity(node);
      const lines = countBodyLines(node);
      const bodyHash = hashText(bodyText);
      if ((complexity >= minComplexity || lines >= minLines) && !isDone(`${file}#${name}`, bodyHash)) {
        candidates.push({ file, line, functionName: name, complexity, lines, bodyHash });
      }
    }
  }
  return candidates;
}

function findVariantFile(directory: string, variant: TournamentVariantName): string | null {
  const paths = [".ts", ".js", ".mts", ".mjs"].map((extension) => join(directory, `${variant}${extension}`));
  return paths.find((path) => existsSync(path)) ?? null;
}

function readRunnerResult(output: string): Record<string, unknown> | null {
  const line = output.split("\n").find((text) => text.startsWith("CODEMASTER_RESULT "));
  return line === undefined ? null : (JSON.parse(line.slice("CODEMASTER_RESULT ".length)) as Record<string, unknown>);
}

function runRunner(
  directory: string,
  runnerArguments: string[],
  nodeFlags: string[],
): { result: Record<string, unknown> | null; output: string; timedOut: boolean; status: number | null } {
  const runner = resolve(import.meta.dirname, "../../bin/tournament-runner.ts");
  const { stdout, stderr, timedOut, status } = runProcess(process.execPath, [...nodeFlags, runner, ...runnerArguments], {
    cwd: directory,
    timeoutMilliseconds: TOURNAMENT_TIMEOUT_MILLISECONDS,
  });
  return { result: readRunnerResult(stdout), output: `${stdout}\n${stderr}`, timedOut, status };
}

function firstOutputLine(output: string): string {
  return output.split("\n").find((line) => line.trim() !== "")?.trim() ?? "no result";
}

function runMeasure(
  directory: string,
  measureArguments: string[],
  nodeFlags: string[],
): { result: Record<string, unknown>; output: string } | { failure: string } {
  const { result, output, timedOut, status } = runRunner(directory, measureArguments, nodeFlags);
  if (timedOut) {
    return { failure: "measure: timeout" };
  }
  if (status !== 0 || result === null) {
    return { failure: `measure: ${firstOutputLine(output)}` };
  }
  return { result, output };
}

function verifyVariant(directory: string, variantPath: string, functionName: string): string | null {
  const casesPath = join(directory, "cases.ts");
  const { result, output, timedOut } = runRunner(directory, ["verify", variantPath, casesPath, functionName, "0"], []);
  if (timedOut) {
    return "timeout";
  }
  if (result === null) {
    return firstOutputLine(output);
  }
  return result.passed === true ? null : String(result.failure);
}

function measureBytecode(
  directory: string,
  variantPath: string,
  functionName: string,
): { length: number; bytecode: number } | { failure: string } {
  const flags = ["--print-bytecode", `--print-bytecode-filter=${functionName}`, "--trace-deopt"];
  const measureArguments = ["measure", variantPath, join(directory, "cases.ts"), functionName, String(TOURNAMENT_ITERATIONS)];
  const measured = runMeasure(directory, measureArguments, flags);
  if ("failure" in measured) {
    return measured;
  }
  const { output } = measured;
  const match = /Bytecode length: (\d+)/.exec(output);
  if (match === null) {
    return { failure: "bytecode: not found" };
  }
  const length = Number(match[1]);
  const deoptimizationPattern = new RegExp(
    "\\[bailout \\(kind: [^)]*\\): begin\\. deoptimizing \\S+ <JSFunction " + functionName + " ",
  );
  const deoptimizations = output.split("\n").filter((line) => deoptimizationPattern.test(line)).length;
  return { length, bytecode: length + TOURNAMENT_DEOPT_PENALTY * deoptimizations };
}

function measureSpeed(directory: string, variantPath: string, functionName: string): { speed: number } | { failure: string } {
  const measureArguments = ["measure", variantPath, join(directory, "cases.ts"), functionName, String(TOURNAMENT_ITERATIONS)];
  const timings: number[] = [];
  for (let run = 0; run < TOURNAMENT_RUNS; run++) {
    const measured = runMeasure(directory, measureArguments, []);
    if ("failure" in measured) {
      return measured;
    }
    timings.push(Number(measured.result.nanosecondsPerCall));
  }
  timings.sort((left, right) => left - right);
  return { speed: timings[Math.floor(timings.length / 2)] };
}

async function measureVariant(
  directory: string,
  variantPath: string,
  target: { functionName: string; benchmark: boolean },
): Promise<{ metrics: TournamentMetrics } | { failure: string }> {
  const { functionName, benchmark } = target;
  const root = (await parseSource(variantPath, readFileSync(variantPath, "utf8"))).root();
  const found = listFunctions(root).find(({ name }) => name === functionName);
  if (found === undefined) {
    return { failure: `function ${functionName} not found` };
  }
  const bytecodeRun = measureBytecode(directory, variantPath, functionName);
  if ("failure" in bytecodeRun) {
    return bytecodeRun;
  }
  const speedRun = benchmark ? measureSpeed(directory, variantPath, functionName) : { speed: null };
  if ("failure" in speedRun) {
    return speedRun;
  }
  return {
    metrics: {
      readability: measureCognitiveComplexity(found.node),
      length: countBodyLines(found.node),
      bytecode: bytecodeRun.bytecode,
      speed: speedRun.speed,
      bytecodePerToken: bytecodeRun.length / countTokens(found.node),
      desugared: countDesugared(found.node),
    },
  };
}

async function evaluateVariant(
  directory: string,
  variant: TournamentVariantName,
  target: { functionName: string; benchmark: boolean },
): Promise<TournamentVariantResult> {
  const variantPath = findVariantFile(directory, variant);
  if (variantPath === null) {
    return { variant, passed: false, failure: "missing file", metrics: null, score: null };
  }
  const failure = verifyVariant(directory, variantPath, target.functionName);
  if (failure !== null) {
    return { variant, passed: false, failure, metrics: null, score: null };
  }
  const measured = await measureVariant(directory, variantPath, target);
  if ("failure" in measured) {
    return { variant, passed: false, failure: measured.failure, metrics: null, score: null };
  }
  return { variant, passed: true, failure: null, metrics: measured.metrics, score: null };
}

export async function runTournament(directory: string, config: ConfigProject): Promise<TournamentResult> {
  const target = JSON.parse(readFileSync(join(directory, "target.json"), "utf8")) as { file: string; functionName: string };
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(target.functionName))) {
    throw new Error("target.json functionName must be an identifier");
  }
  const casesModule = (await import(pathToFileURL(join(directory, "cases.ts")).href)) as { benchmark?: boolean };
  const options = { functionName: target.functionName, benchmark: casesModule.benchmark !== false };
  const variants: TournamentVariantResult[] = [];
  for (const variant of TOURNAMENT_TIE_ORDER) {
    variants.push(await evaluateVariant(directory, variant, options));
  }
  const { scores, winner } = scoreVariants(variants, config.tournament.weights);
  const scored = variants.map((entry, position) => ({ ...entry, score: scores[position].score }));
  const result: TournamentResult = { target, variants: scored, winner };
  writeFileSync(join(directory, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

function formatResult(result: TournamentResult): string[] {
  const header = "variant | passed | readability | length | bytecode | speed | bytecodePerToken | desugared | score";
  const rows = result.variants.map(({ variant, passed, metrics, score }) => {
    const values = [
      metrics?.readability,
      metrics?.length,
      metrics?.bytecode,
      metrics?.speed,
      metrics?.bytecodePerToken,
      metrics?.desugared,
      score,
    ];
    return [variant, String(passed), ...values.map((value) => (value === null || value === undefined ? "-" : String(value)))].join(" | ");
  });
  return [header, ...rows, `winner: ${result.winner}`];
}

async function recordDone(projectRoot: string, directory: string): Promise<void> {
  const { file, functionName } = JSON.parse(readFileSync(join(directory, "target.json"), "utf8")) as {
    file: string;
    functionName: string;
  };
  const projectFile = join(projectRoot, file);
  const root = (await parseSource(projectFile, readFileSync(projectFile, "utf8"))).root();
  const found = listFunctions(root).find(({ name }) => name === functionName);
  const bodyHash = found === undefined ? null : hashText(found.bodyText);
  appendDoneEntry(projectRoot, { key: `${file}#${functionName}`, bodyHash, skipped: false, reason: null });
}

export async function runCommand(context: CommandContext): Promise<number> {
  const { argumentsList, projectRoot, config } = context;
  const [first, second] = argumentsList;
  if (["--candidates", "--skip", "--done"].includes(first) && !isRepository(projectRoot)) {
    process.stdout.write("codemaster: not a git repository; the tournament keeps its state in git\n");
    return 0;
  }
  if (first === "--skip") {
    const reasonPosition = argumentsList.indexOf("--reason");
    const reason = reasonPosition === -1 ? undefined : argumentsList[reasonPosition + 1];
    if (second === undefined || second === "--reason" || reason === undefined) {
      process.stderr.write("usage: codemaster tournament --skip <file>#<name> --reason <text>\n");
      return 2;
    }
    appendDoneEntry(projectRoot, { key: second, bodyHash: null, skipped: true, reason });
    return 0;
  }
  if (first === undefined || (first === "--done" && second === undefined)) {
    process.stderr.write("usage: codemaster tournament <dir> | --candidates | --skip <file>#<name> --reason <text> | --done <dir>\n");
    return 2;
  }
  const installed = ensureInstalled();
  if (!installed.ok) {
    process.stderr.write(`${installed.message}\n`);
    return 1;
  }
  if (first === "--candidates") {
    const candidates = await findCandidates({ projectRoot, config });
    const lines = candidates.map(
      ({ file, line, functionName, complexity, lines: bodyLines }) =>
        `${file}:${line} ${functionName} complexity=${complexity} lines=${bodyLines}\n`,
    );
    process.stdout.write(lines.join(""));
    return 0;
  }
  if (first === "--done") {
    await recordDone(projectRoot, resolve(projectRoot, second));
    return 0;
  }
  const result = await runTournament(resolve(projectRoot, first), config);
  process.stdout.write(formatResult(result).map((line) => `${line}\n`).join(""));
  return result.winner === "none" ? 1 : 0;
}
