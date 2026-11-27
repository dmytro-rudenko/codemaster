import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import type { FindingItem } from "../../interfaces/finding.ts";
import { resolveAstGrepBinary } from "./ast-grep.ts";
import { runProcess } from "./process.ts";

function resolveLanguage(file: string): string | null {
  const extension = extname(file).toLowerCase();
  if ([".ts", ".mts", ".cts"].includes(extension)) {
    return "TypeScript";
  }
  if (extension === ".tsx") {
    return "Tsx";
  }
  if ([".js", ".mjs", ".cjs", ".jsx"].includes(extension)) {
    return "JavaScript";
  }
  return null;
}

function groupByLanguage(files: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const file of files) {
    const language = resolveLanguage(file);
    if (language !== null) {
      groups.set(language, [...(groups.get(language) ?? []), file]);
    }
  }
  return groups;
}

function parseFinding(line: string): FindingItem {
  const parsed = JSON.parse(line);
  return {
    severity: parsed.severity === "error" ? "error" : "warning",
    ruleId: parsed.ruleId,
    file: parsed.file,
    line: parsed.range.start.line + 1,
    message: parsed.message,
  };
}

function runRule(input: { rulePath: string; projectRoot: string; files: string[] }): FindingItem[] {
  const { rulePath, projectRoot, files } = input;
  const { stdout } = runProcess(
    resolveAstGrepBinary(),
    ["scan", "--rule", rulePath, "--json=stream", "--", ...files],
    { cwd: projectRoot },
  );
  return stdout
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map(parseFinding);
}

function writeLanguageRule(rulePath: string, directory: string, language: string): string {
  const text = readFileSync(rulePath, "utf8").replace(/^language: .*$/m, `language: ${language}`);
  const copyPath = join(directory, `${language}-${basename(rulePath)}`);
  writeFileSync(copyPath, text);
  return copyPath;
}

function scanLanguage(input: {
  language: string;
  files: string[];
  rulePaths: string[];
  projectRoot: string;
  directory: string;
}): FindingItem[] {
  const { language, files, rulePaths, projectRoot, directory } = input;
  return rulePaths.flatMap((rulePath) =>
    runRule({
      rulePath: language === "TypeScript" ? rulePath : writeLanguageRule(rulePath, directory, language),
      projectRoot,
      files,
    }),
  );
}

export function scanWithRules(input: {
  pluginRoot: string;
  projectRoot: string;
  files: string[];
}): FindingItem[] {
  const { pluginRoot, projectRoot, files } = input;
  const rulesDirectory = join(pluginRoot, "rules", "typescript");
  const rulePaths = readdirSync(rulesDirectory)
    .filter((name) => name.endsWith(".yml"))
    .sort()
    .map((name) => join(rulesDirectory, name));
  const directory = mkdtempSync(join(tmpdir(), "codemaster-rule-"));
  try {
    return [...groupByLanguage(files)].flatMap(([language, group]) =>
      scanLanguage({ language, files: group, rulePaths, projectRoot, directory }),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
