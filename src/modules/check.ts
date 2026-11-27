import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import { CHECK_IGNORED_DIRECTORIES, CHECK_SOURCE_EXTENSIONS } from "../consts/check.ts";
import type { CommandContext } from "../interfaces/command.ts";
import type { ConfigProject } from "../interfaces/config.ts";
import type { FindingItem, FindingSummary } from "../interfaces/finding.ts";
import type { RoleLayout } from "../interfaces/role.ts";
import { parseSource } from "../helpers/infrastructure/ast-grep.ts";
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

async function checkFile(input: { projectRoot: string; file: string; layout: RoleLayout; config: ConfigProject }) {
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

function applySettings(findings: FindingItem[], config: ConfigProject): FindingItem[] {
  return findings.flatMap((finding) => {
    const { enabled, severity, reason } = resolveRuleSetting(config, finding.ruleId);
    if (!enabled) {
      return [];
    }
    const setting = config.rules[finding.ruleId];
    const explicit = typeof setting === "string" || (typeof setting === "object" && setting.severity !== undefined);
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

function summarize(findings: FindingItem[]): FindingSummary {
  return {
    errors: findings.filter((finding) => finding.severity === "error").length,
    warnings: findings.filter((finding) => finding.severity === "warning").length,
    files: new Set(findings.map((finding) => finding.file)).size,
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
  const results = await Promise.all(files.map((file) => checkFile({ projectRoot, file, layout, config: settings })));
  const parsedFiles = files.filter((_, position) => results[position].parsed);
  const testFiles = new Set(files.filter((_, position) => results[position].test));
  const scanned = parsedFiles.length === 0 ? [] : scanWithRules({ pluginRoot, projectRoot, files: parsedFiles });
  const kept = scanned.filter((finding) => finding.ruleId !== "prefer-destructuring" || !testFiles.has(finding.file));
  const packages = existsSync(join(projectRoot, "package.json")) ? checkSimplePackages({ projectRoot, config }) : [];
  const collected = [...results.flatMap((result) => result.findings), ...kept, ...packages];
  const findings = applySettings(collected, config).sort(compareFindings);
  return { findings, summary: summarize(findings), layout };
}

function isSourceFile(path: string): boolean {
  return CHECK_SOURCE_EXTENSIONS.includes(extname(path)) && !path.endsWith(".d.ts");
}

function walkSourceFiles(projectRoot: string, target: string): string[] {
  const absolute = resolve(projectRoot, target);
  const path = relative(projectRoot, absolute).split(sep).join("/");
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

function selectFiles(projectRoot: string, argumentsList: string[]): string[] | null {
  const paths = argumentsList.filter((argument) => !argument.startsWith("--"));
  if (paths.length > 0) {
    return [...new Set(paths.flatMap((path) => walkSourceFiles(projectRoot, path)))].sort();
  }
  const repository = isRepository(projectRoot);
  if (argumentsList.includes("--all")) {
    return repository ? listAllSourceFiles(projectRoot) : walkSourceFiles(projectRoot, "").sort();
  }
  return repository ? listChangedFiles(projectRoot) : null;
}

export async function runCommand(context: CommandContext): Promise<number> {
  const { argumentsList, projectRoot, pluginRoot, config, configWarnings } = context;
  const lines = [...configWarnings];
  const files = selectFiles(projectRoot, argumentsList);
  if (files === null) {
    lines.push("codemaster: not a git repository; pass paths");
    process.stdout.write(`${lines.join("\n")}\n`);
    return 0;
  }
  const { findings, summary } = await runChecks({ projectRoot, pluginRoot, config, files });
  if (argumentsList.includes("--json")) {
    lines.push(JSON.stringify({ findings, summary }));
  } else {
    lines.push(...findings.map(({ severity, ruleId, file, line, message }) => `${severity} ${ruleId} ${file}:${line} ${message}`));
    lines.push(`codemaster: ${summary.errors} errors, ${summary.warnings} warnings in ${summary.files} files`);
  }
  process.stdout.write(`${lines.join("\n")}\n`);
  return summary.errors > 0 ? 1 : 0;
}
