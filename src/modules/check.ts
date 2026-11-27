import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import { CHECK_IGNORED_DIRECTORIES, CHECK_SOURCE_EXTENSIONS } from "../consts/check.ts";
import type { CommandContext } from "../interfaces/command.ts";
import type { ConfigProject } from "../interfaces/config.ts";
import type { FindingItem, FindingSummary } from "../interfaces/finding.ts";
import type { RoleLayout } from "../interfaces/role.ts";
import { loadAstGrep, parseSource } from "../helpers/infrastructure/ast-grep.ts";
import { scanWithRules } from "../helpers/infrastructure/ast-grep-scan.ts";
import { isRepository, listAllSourceFiles, listChangedFiles } from "../helpers/infrastructure/git.ts";
import { checkDeclarations } from "../helpers/logic/declaration-rules.ts";
import { detectLayout, resolveFileRole } from "../helpers/logic/file-role.ts";
import { checkSimplePackages, checkTestMirror } from "../helpers/logic/project-rules.ts";
import { resolveRuleSetting } from "./config.ts";

async function parseRoot(file: string, text: string) {
  try {
    const root = (await parseSource(file, text)).root();
    return root.find({ rule: { kind: "ERROR" } }) === null ? root : null;
  } catch {
    return null;
  }
}

async function analyzeFile(input: { projectRoot: string; file: string; layout: RoleLayout; config: ConfigProject }) {
  const { projectRoot, file, layout, config } = input;
  const role = resolveFileRole(file, { layout, config });
  const text = readFileSync(join(projectRoot, file), "utf8");
  const root = await parseRoot(file, text);
  if (root === null) {
    const failure: FindingItem = { severity: "warning", ruleId: "parse", file, line: 1, message: "could not parse" };
    return { findings: [failure], parsed: false, test: role.role === "test" };
  }
  const declarations = checkDeclarations({ path: file, text, root, role, config });
  const mirror = layout === "off" ? [] : checkTestMirror({ projectRoot, role, layout, config });
  return { findings: [...declarations, ...mirror], parsed: true, test: role.role === "test" };
}

async function checkFile(input: { projectRoot: string; file: string; layout: RoleLayout; config: ConfigProject }) {
  try {
    return await analyzeFile(input);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const [firstLine] = reason.split("\n");
    const failure: FindingItem = {
      severity: "warning",
      ruleId: "parse",
      file: input.file,
      line: 1,
      message: `could not check: ${firstLine}`,
    };
    return { findings: [failure], parsed: false, test: false };
  }
}

function applySettings(findings: FindingItem[], config: ConfigProject): FindingItem[] {
  return findings.flatMap((finding) => {
    const { enabled, severity, explicit, reason } = resolveRuleSetting(config, finding.ruleId);
    if (!enabled) {
      return [];
    }
    const adjusted = { ...finding, severity: explicit ? severity : finding.severity };
    return [reason === null ? adjusted : { ...adjusted, reason }];
  });
}

function compareFindings(left: FindingItem, right: FindingItem): number {
  if (left.file !== right.file) {
    return left.file < right.file ? -1 : 1;
  }
  if (left.line !== right.line) {
    return left.line - right.line;
  }
  return left.ruleId < right.ruleId ? -1 : left.ruleId > right.ruleId ? 1 : 0;
}

function summarize(findings: FindingItem[], files: string[]): FindingSummary {
  return {
    errors: findings.filter((finding) => finding.severity === "error").length,
    warnings: findings.filter((finding) => finding.severity === "warning").length,
    files: new Set(files).size,
  };
}

export async function runChecks(input: {
  projectRoot: string;
  pluginRoot: string;
  config: ConfigProject;
  files: string[];
}): Promise<{ findings: FindingItem[]; summary: FindingSummary; layout: RoleLayout }> {
  const { projectRoot, pluginRoot, config, files } = input;
  const layout = detectLayout(projectRoot, config);
  const settings = { ...config, layout };
  await loadAstGrep();
  const results = await Promise.all(files.map((file) => checkFile({ projectRoot, file, layout, config: settings })));
  const parsedFiles = files.filter((_, position) => results[position].parsed);
  const testFiles = new Set(files.filter((_, position) => results[position].test));
  const scanned = parsedFiles.length === 0 ? [] : scanWithRules({ pluginRoot, projectRoot, files: parsedFiles });
  const kept = scanned.filter((finding) => finding.ruleId !== "prefer-destructuring" || !testFiles.has(finding.file));
  const packages = existsSync(join(projectRoot, "package.json")) ? checkSimplePackages({ projectRoot, config }) : [];
  const collected = [...results.flatMap((result) => result.findings), ...kept, ...packages];
  const findings = applySettings(collected, config).sort(compareFindings);
  return { findings, summary: summarize(findings, files), layout };
}

function isSourceFile(path: string): boolean {
  return CHECK_SOURCE_EXTENSIONS.includes(extname(path)) && !path.endsWith(".d.ts");
}

function walkSourceFiles(projectRoot: string, target: string): string[] {
  const absolute = resolve(projectRoot, target);
  const path = toProjectPath(projectRoot, target);
  if (!existsSync(absolute)) {
    return [];
  }
  if (!statSync(absolute).isDirectory()) {
    return isSourceFile(path) ? [path] : [];
  }
  return readdirSync(absolute, { withFileTypes: true })
    .filter(({ name }) => name !== ".git" && !CHECK_IGNORED_DIRECTORIES.includes(name))
    .flatMap(({ name }) => walkSourceFiles(projectRoot, path === "" ? name : `${path}/${name}`));
}

function toProjectPath(projectRoot: string, target: string): string {
  return relative(projectRoot, resolve(projectRoot, target)).split(sep).join("/");
}

function expandPath(projectRoot: string, target: string, tracked: string[] | null): string[] {
  if (tracked === null) {
    return walkSourceFiles(projectRoot, target);
  }
  const prefix = toProjectPath(projectRoot, target);
  return tracked.filter((file) => prefix === "" || file === prefix || file.startsWith(`${prefix}/`));
}

function selectFiles(projectRoot: string, argumentsList: string[]): { files: string[]; missing: string | null } | null {
  const paths = argumentsList.filter((argument) => !argument.startsWith("--"));
  const repository = isRepository(projectRoot);
  if (paths.length > 0) {
    const tracked = repository ? listAllSourceFiles(projectRoot) : null;
    const expanded = paths.map((path) => ({ path, files: expandPath(projectRoot, path, tracked) }));
    const missing = expanded.find(({ files }) => files.length === 0)?.path ?? null;
    return { files: [...new Set(expanded.flatMap(({ files }) => files))].sort(), missing };
  }
  if (argumentsList.includes("--all")) {
    return { files: repository ? listAllSourceFiles(projectRoot) : walkSourceFiles(projectRoot, "").sort(), missing: null };
  }
  return repository ? { files: listChangedFiles(projectRoot), missing: null } : null;
}

export async function runCommand(context: CommandContext): Promise<number> {
  const { argumentsList, projectRoot, pluginRoot, config, configWarnings } = context;
  const json = argumentsList.includes("--json");
  const lines = json ? [] : [...configWarnings];
  if (json && configWarnings.length > 0) {
    process.stderr.write(`${configWarnings.join("\n")}\n`);
  }
  const selection = selectFiles(projectRoot, argumentsList);
  if (selection === null || selection.missing !== null) {
    const status = selection === null ? 0 : 2;
    lines.push(selection === null ? "codemaster: not a git repository; pass paths" : `codemaster: no source files match ${selection.missing}`);
    process.stdout.write(`${lines.join("\n")}\n`);
    return status;
  }
  const { findings, summary } = await runChecks({ projectRoot, pluginRoot, config, files: selection.files });
  if (json) {
    lines.push(JSON.stringify({ findings, summary }));
  } else {
    lines.push(...findings.map(({ severity, ruleId, file, line, message }) => `${severity} ${ruleId} ${file}:${line} ${message}`));
    lines.push(`codemaster: ${summary.errors} errors, ${summary.warnings} warnings in ${summary.files} files`);
  }
  process.stdout.write(`${lines.join("\n")}\n`);
  return summary.errors > 0 ? 1 : 0;
}
