import { existsSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_FILE_NAME, CONFIG_LOCAL_FILE_NAME } from "../consts/config.ts";
import { HOOK_FINDINGS_LIMIT, HOOK_REASON_HEADER } from "../consts/hook.ts";
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

export function buildStopReason(input: {
  profile: string | null;
  warnings?: string[];
  findings: FindingItem[];
  summary: FindingSummary;
  candidates: string[];
  libraries: string[];
}): string {
  const { profile, warnings = [], findings, summary, candidates, libraries } = input;
  const lines = [HOOK_REASON_HEADER, ...warnings];
  if (profile) {
    lines.push(profile.trimEnd());
  }
  if (findings.length > 0) {
    lines.push(`Findings (${summary.errors} errors, ${summary.warnings} warnings):`);
    const shown = findings.slice(0, HOOK_FINDINGS_LIMIT);
    lines.push(...shown.map(({ severity, ruleId, file, line, message }) => `${severity} ${ruleId} ${file}:${line} ${message}`));
    if (findings.length > shown.length) {
      lines.push(`… and ${findings.length - shown.length} more`);
    }
  }
  if (candidates.length > 0) {
    lines.push(`Tournament candidates (${candidates.length}):`, ...candidates);
  }
  if (libraries.length > 0) {
    lines.push("Libraries:", ...libraries);
  }
  return lines.join("\n");
}

function computeStateHash(projectRoot: string, changed: string[]): string {
  const parts = changed.map((path) => `${path}\0${readTextFile(join(projectRoot, path)) ?? ""}`);
  return hashText(`${parts.join("\0")}\0${readTextFile(join(projectRoot, "package.json")) ?? ""}`);
}

async function scanFirstProfile(projectRoot: string, current: ConfigProject): Promise<{
  config: ConfigProject;
  profile: string;
  merged: Record<string, unknown>;
  warnings: string[];
}> {
  const { profile, sources, warnings } = await scanConventions(projectRoot, { config: current, raw: {} });
  const { value } = readJsonFile(join(projectRoot, CONFIG_LOCAL_FILE_NAME));
  const localKeys = value && typeof value === "object" ? Object.keys(value) : [];
  const local = Object.fromEntries(localKeys.filter((key) => key in current).map((key) => [key, current[key as keyof ConfigProject]]));
  const rules = { ...profile.rules, ...current.rules };
  const config = { ...current, ...profile, sources, ...local, rules } as ConfigProject;
  const text = formatProfile({ ...config, layout: detectLayout(projectRoot, config) }, { layout: "auto", ...sources });
  return { config, profile: text, merged: { ...profile, sources }, warnings };
}

async function collectReport(
  context: CommandContext,
  changed: string[],
): Promise<{ reason: string | null; merged: Record<string, unknown> | null }> {
  const { projectRoot, pluginRoot, configWarnings } = context;
  const first = existsSync(join(projectRoot, CONFIG_FILE_NAME)) ? null : await scanFirstProfile(projectRoot, context.config);
  const { config } = first ?? context;
  const profile = first?.profile ?? null;
  const warnings = [...configWarnings, ...(first?.warnings ?? [])];
  const { findings, summary } = await runChecks({ projectRoot, pluginRoot, config, files: changed });
  const candidates = (await findCandidates({ projectRoot, config })).map(
    ({ file, line, functionName, complexity, lines }) => `${file}:${line} ${functionName} complexity=${complexity} lines=${lines}`,
  );
  const libraries = config.libraryDigest ? formatLibraryDiff(diffLibraries({ projectRoot, config })) : [];
  const empty = !profile && findings.length === 0 && candidates.length === 0 && libraries.length === 0;
  const reason = empty ? null : buildStopReason({ profile, warnings, findings, summary, candidates, libraries });
  return { reason, merged: first?.merged ?? null };
}

async function runStop(context: CommandContext): Promise<number> {
  const { projectRoot, config, input } = context;
  if (!config.hook || !isRepository(projectRoot)) {
    return 0;
  }
  const changed = listChangedFiles(projectRoot);
  if (changed.length === 0 && !isPackageManifestChanged(projectRoot)) {
    return 0;
  }
  const statePath = join(resolveStateDirectory(projectRoot), "last-checked");
  const stateHash = computeStateHash(projectRoot, changed);
  if (readTextFile(statePath) === stateHash) {
    return 0;
  }
  const { stop_hook_active: active } = JSON.parse(input || "{}") as HookStopInput;
  if (active === true) {
    writeTextFile(statePath, stateHash);
    return 0;
  }
  const { ok, message } = ensureInstalled();
  if (!ok) {
    process.stderr.write(`${message}\n`);
    return 0;
  }
  const { reason, merged } = await collectReport(context, changed);
  if (merged) {
    writeProfile(projectRoot, merged);
  }
  writeTextFile(statePath, stateHash);
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
    `codemaster: layout=${detectLayout(projectRoot, config)}, sourceRoot=${config.sourceRoot}`,
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
