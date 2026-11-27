import { existsSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_FILE_NAME } from "../consts/config.ts";
import { HOOK_FINDINGS_LIMIT, HOOK_REASON_HEADER } from "../consts/hook.ts";
import type { CommandContext } from "../interfaces/command.ts";
import type { ConfigProject } from "../interfaces/config.ts";
import type { FindingItem, FindingSummary } from "../interfaces/finding.ts";
import type { HookStopInput } from "../interfaces/hook.ts";
import { readTextFile, writeTextFile } from "../helpers/infrastructure/filesystem.ts";
import { isPackageManifestChanged, isRepository, listChangedFiles, resolveStateDirectory } from "../helpers/infrastructure/git.ts";
import { detectLayout } from "../helpers/logic/file-role.ts";
import { hashText } from "../utils/hash.ts";
import { runChecks } from "./check.ts";
import { loadConfig } from "./config.ts";
import { formatProfile, scanConventions, writeProfile } from "./conventions.ts";
import { ensureInstalled } from "./install.ts";
import { diffLibraries, formatLibraryDiff } from "./libraries.ts";
import { findCandidates } from "./tournament.ts";

export function buildStopReason(input: {
  profile: string | null;
  findings: FindingItem[];
  summary: FindingSummary;
  candidates: string[];
  libraries: string[];
}): string {
  const { profile, findings, summary, candidates, libraries } = input;
  const lines = [HOOK_REASON_HEADER];
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

async function writeFirstProfile(projectRoot: string, config: ConfigProject): Promise<string> {
  const { profile, sources } = await scanConventions(projectRoot, { config, raw: {} });
  writeProfile(projectRoot, { ...profile, sources });
  const written = loadConfig(projectRoot).config;
  return formatProfile({ ...written, layout: detectLayout(projectRoot, written) }, { layout: "auto", ...sources });
}

async function collectReport(context: CommandContext, changed: string[]): Promise<string | null> {
  const { projectRoot, pluginRoot } = context;
  const profile = existsSync(join(projectRoot, CONFIG_FILE_NAME)) ? null : await writeFirstProfile(projectRoot, context.config);
  const { config } = profile ? loadConfig(projectRoot) : context;
  const { findings, summary } = await runChecks({ projectRoot, pluginRoot, config, files: changed });
  const candidates = (await findCandidates({ projectRoot, config })).map(
    ({ file, line, functionName, complexity, lines }) => `${file}:${line} ${functionName} complexity=${complexity} lines=${lines}`,
  );
  const libraries = config.libraryDigest ? formatLibraryDiff(diffLibraries({ projectRoot, config })) : [];
  const empty = !profile && findings.length === 0 && candidates.length === 0 && libraries.length === 0;
  return empty ? null : buildStopReason({ profile, findings, summary, candidates, libraries });
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
  const reason = await collectReport(context, changed);
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
