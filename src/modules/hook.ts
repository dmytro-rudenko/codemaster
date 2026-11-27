import { existsSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_FILE_NAME, CONFIG_LOCAL_FILE_NAME } from "../consts/config.ts";
import {
  HOOK_CANDIDATES_LIMIT,
  HOOK_FILES_LIMIT,
  HOOK_FINDINGS_LIMIT,
  HOOK_LIBRARIES_LIMIT,
  HOOK_LINE_LIMIT,
  HOOK_MANIFEST_FILE,
  HOOK_REASON_HEADER,
  HOOK_DEFERRED_FILE,
  HOOK_STATE_FILE,
  HOOK_UNSAFE_CHARACTERS,
} from "../consts/hook.ts";
import type { CommandContext } from "../interfaces/command.ts";
import type { ConfigProject } from "../interfaces/config.ts";
import type { FindingItem, FindingSummary } from "../interfaces/finding.ts";
import type { HookStopInput } from "../interfaces/hook.ts";
import { readJsonFile, readTextFile, writeTextFile } from "../helpers/infrastructure/filesystem.ts";
import { isPackageManifestChanged, isRepository, listChangedFiles, resolveStateDirectory } from "../helpers/infrastructure/git.ts";
import { detectLayout } from "../helpers/logic/file-role.ts";
import { hashText } from "../utils/hash.ts";
import { runChecks } from "./check.ts";
import { formatProfile, scanConventions, writeProfile } from "./conventions.ts";
import { ensureInstalled } from "./install.ts";
import { diffLibraries, formatLibraryDiff } from "./libraries.ts";
import { findCandidates } from "./tournament.ts";

function toSingleLine(text: string): string {
  return text.replace(HOOK_UNSAFE_CHARACTERS, " ").slice(0, HOOK_LINE_LIMIT);
}

function listCapped(title: string, items: string[], limit: number): string[] {
  const shown = items.slice(0, limit).map(toSingleLine);
  return items.length > shown.length ? [title, ...shown, `… and ${items.length - shown.length} more`] : [title, ...shown];
}

export function buildStopReason(input: {
  profile: string | null;
  warnings?: string[];
  findings: FindingItem[];
  summary: FindingSummary;
  candidates: string[];
  libraries: string[];
  unchecked?: number;
}): string {
  const { profile, warnings = [], findings, summary, candidates, libraries, unchecked = 0 } = input;
  const lines = [HOOK_REASON_HEADER, ...warnings.map(toSingleLine)];
  if (profile) {
    lines.push(...profile.trimEnd().split("\n").map(toSingleLine));
  }
  if (findings.length > 0) {
    const findingLines = findings.map(({ severity, ruleId, file, line, message }) => `${severity} ${ruleId} ${file}:${line} ${message}`);
    lines.push(...listCapped(`Findings (${summary.errors} errors, ${summary.warnings} warnings):`, findingLines, HOOK_FINDINGS_LIMIT));
  }
  if (candidates.length > 0) {
    lines.push(...listCapped(`Tournament candidates (${candidates.length}):`, candidates, HOOK_CANDIDATES_LIMIT));
  }
  if (libraries.length > 0) {
    lines.push("Libraries:", ...libraries.map(toSingleLine));
  }
  if (unchecked > 0) {
    lines.push(`… and ${unchecked} more changed files not checked yet; they are checked on the next stop, or run check`);
  }
  return lines.join("\n");
}

async function scanFirstProfile(projectRoot: string, current: ConfigProject): Promise<{
  config: ConfigProject;
  profile: string;
  merged: Record<string, unknown>;
  warnings: string[];
}> {
  const { profile, sources, warnings } = await scanConventions(projectRoot, { config: current, raw: {}, linter: false });
  const { value } = readJsonFile(join(projectRoot, CONFIG_LOCAL_FILE_NAME));
  const localKeys = value && typeof value === "object" ? Object.keys(value) : [];
  const local = Object.fromEntries(localKeys.filter((key) => key in current).map((key) => [key, current[key as keyof ConfigProject]]));
  const rules = { ...profile.rules, ...current.rules };
  const config = { ...current, ...profile, sources, ...local, rules } as ConfigProject;
  const text = formatProfile({ ...config, layout: detectLayout(projectRoot, config) }, { layout: "auto", ...sources });
  return { config, profile: text, merged: { ...profile, sources }, warnings };
}

function summarizeLibraries(projectRoot: string, config: ConfigProject): { lines: string[]; blocking: boolean } {
  if (!config.libraryDigest) {
    return { lines: [], blocking: false };
  }
  const diff = diffLibraries({ projectRoot, config });
  const remove = diff.remove.slice(0, HOOK_LIBRARIES_LIMIT);
  const missing = diff.missing.slice(0, HOOK_LIBRARIES_LIMIT);
  const hidden = diff.remove.length - remove.length + diff.missing.length - missing.length;
  const lines = formatLibraryDiff({ ...diff, remove, missing, more: diff.more + hidden });
  return { lines, blocking: diff.add.length + diff.stale.length + diff.remove.length + diff.more > 0 };
}

async function attemptStage<Result>(
  stage: string,
  action: () => Promise<Result> | Result,
  fallback: Result,
  warnings: string[],
): Promise<Result> {
  try {
    return await action();
  } catch (error) {
    const detail = error instanceof Error ? error.message.split("\n")[0] : String(error);
    warnings.push(`warning ${stage}: could not run (${detail})`);
    return fallback;
  }
}

async function collectReport(
  context: CommandContext,
  scope: { files: string[]; unchecked: number },
): Promise<{ reason: string | null; merged: Record<string, unknown> | null }> {
  const { projectRoot, pluginRoot, configWarnings } = context;
  const { files, unchecked } = scope;
  const first = existsSync(join(projectRoot, CONFIG_FILE_NAME)) ? null : await scanFirstProfile(projectRoot, context.config);
  const { config } = first ?? context;
  const profile = first?.profile ?? null;
  const warnings = [...configWarnings, ...(first?.warnings ?? [])];
  const emptyCheck = { findings: [], summary: { errors: 0, warnings: 0, files: 0 } };
  const { findings, summary } = await attemptStage("check", () => runChecks({ projectRoot, pluginRoot, config, files }), emptyCheck, warnings);
  const found = await attemptStage("tournament", () => findCandidates({ projectRoot, config, files }), [], warnings);
  const candidates = found.map(
    ({ file, line, functionName, complexity, lines }) => `${file}:${line} ${functionName} complexity=${complexity} lines=${lines}`,
  );
  const libraries = await attemptStage("libraries", () => summarizeLibraries(projectRoot, config), { lines: [], blocking: false }, warnings);
  const empty = !profile && findings.length === 0 && candidates.length === 0 && !libraries.blocking;
  const reason = empty
    ? null
    : buildStopReason({ profile, warnings, findings, summary, candidates, libraries: libraries.lines, unchecked });
  return { reason, merged: first?.merged ?? null };
}

function readCheckedFiles(statePath: string): Map<string, string> {
  const { value } = readJsonFile(statePath);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return new Map();
  }
  return new Map(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function readDeferredFiles(projectRoot: string): Set<string> {
  const { value } = readJsonFile(join(resolveStateDirectory(projectRoot), HOOK_DEFERRED_FILE));
  return new Set(Array.isArray(value) ? value.filter((path): path is string => typeof path === "string") : []);
}

function writeDeferredFiles(projectRoot: string, deferred: string[]): void {
  writeTextFile(join(resolveStateDirectory(projectRoot), HOOK_DEFERRED_FILE), `${JSON.stringify(deferred)}\n`);
}

function findPending(projectRoot: string): {
  statePath: string;
  changed: string[];
  pending: string[];
  current: Map<string, string>;
  recorded: Map<string, string>;
} | null {
  const changed = listChangedFiles(projectRoot);
  const current = new Map([...changed, HOOK_MANIFEST_FILE].map((path) => [path, hashText(readTextFile(join(projectRoot, path)) ?? "")]));
  const statePath = join(resolveStateDirectory(projectRoot), HOOK_STATE_FILE);
  const recorded = readCheckedFiles(statePath);
  const pending = changed.filter((path) => recorded.get(path) !== current.get(path));
  const manifestPending = recorded.get(HOOK_MANIFEST_FILE) !== current.get(HOOK_MANIFEST_FILE) && isPackageManifestChanged(projectRoot);
  return pending.length === 0 && !manifestPending ? null : { statePath, changed, pending, current, recorded };
}

function recordChecked(state: NonNullable<ReturnType<typeof findPending>>, checked: string[]): void {
  const { statePath, changed, current, recorded } = state;
  const next = new Map([...recorded].filter(([path]) => changed.includes(path)));
  for (const path of [...checked, HOOK_MANIFEST_FILE]) {
    next.set(path, current.get(path) as string);
  }
  const sorted = [...next].sort(([left], [right]) => left.localeCompare(right));
  writeTextFile(statePath, `${JSON.stringify(Object.fromEntries(sorted), null, 2)}\n`);
}

async function runStop(context: CommandContext): Promise<number> {
  const { projectRoot, config, input } = context;
  if (!config.hook || !isRepository(projectRoot)) {
    return 0;
  }
  const state = findPending(projectRoot);
  if (state === null) {
    return 0;
  }
  const { stop_hook_active: active } = JSON.parse(input || "{}") as HookStopInput;
  if (active === true) {
    const deferred = readDeferredFiles(projectRoot);
    recordChecked(state, state.pending.filter((path) => !deferred.has(path)));
    return 0;
  }
  const { ok, message } = ensureInstalled();
  if (!ok) {
    process.stderr.write(`${message}\n`);
    return 0;
  }
  const files = state.pending.slice(0, HOOK_FILES_LIMIT);
  const { reason, merged } = await collectReport(context, { files, unchecked: state.pending.length - files.length });
  if (merged) {
    writeProfile(projectRoot, merged);
  }
  recordChecked(state, files);
  writeDeferredFiles(projectRoot, state.pending.slice(HOOK_FILES_LIMIT));
  if (reason) {
    process.stdout.write(`${JSON.stringify({ decision: "block", reason })}\n`);
  }
  return 0;
}

function runSessionStart(context: CommandContext): number {
  const { projectRoot, config } = context;
  if (!config.hook) {
    return 0;
  }
  const indexed = existsSync(join(projectRoot, ".claude/skills/codemaster-libraries/SKILL.md"));
  const lines = [
    toSingleLine(`codemaster: layout=${detectLayout(projectRoot, config)}, sourceRoot=${config.sourceRoot}`),
    `Before a task, check whether the framework or an installed library already does it${indexed ? "; see the codemaster-libraries skill." : "."}`,
    "Follow the codemaster skill rules while coding.",
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}

export async function runCommand(context: CommandContext): Promise<number> {
  const [subcommand] = context.argumentsList;
  return subcommand === "hook-session-start" ? runSessionStart(context) : runStop(context);
}
