import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { CHECK_SCAN_BATCH_SIZE } from "../../consts/check.ts";
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
    if (language === null) {
      continue;
    }
    const group = groups.get(language);
    if (group === undefined) {
      groups.set(language, [file]);
    } else {
      group.push(file);
    }
  }
  return groups;
}

function parseFinding(line: string): FindingItem[] {
  try {
    const parsed = JSON.parse(line);
    return [
      {
        severity: parsed.severity === "error" ? "error" : "warning",
        ruleId: parsed.ruleId,
        file: parsed.file,
        line: parsed.range.start.line + 1,
        message: parsed.message,
      },
    ];
  } catch {
    return [];
  }
}

function describeFailure(status: number | null, stderr: string): FindingItem {
  const firstLine = stderr.split("\n").find((line) => line.trim() !== "");
  const reason = firstLine?.trim() ?? (status === null ? "did not run" : `exit ${status}`);
  return { severity: "warning", ruleId: "ast-grep", file: "(ast-grep)", line: 1, message: `ast-grep failed: ${reason}` };
}

function splitBatches(files: string[]): string[][] {
  const batches: string[][] = [];
  for (let start = 0; start < files.length; start += CHECK_SCAN_BATCH_SIZE) {
    batches.push(files.slice(start, start + CHECK_SCAN_BATCH_SIZE));
  }
  return batches;
}

function runBatch(input: { rulePath: string; projectRoot: string; files: string[] }): FindingItem[] {
  const { rulePath, projectRoot, files } = input;
  const { status, stdout, stderr } = runProcess(
    resolveAstGrepBinary(),
    ["scan", "--rule", rulePath, "--json=stream", "--", ...files],
    { cwd: projectRoot },
  );
  const findings = stdout
    .split("\n")
    .filter((line) => line.trim() !== "")
    .flatMap(parseFinding);
  const reportedFindings = status === 1 && findings.length > 0;
  return status === 0 || reportedFindings ? findings : [...findings, describeFailure(status, stderr)];
}

function runRule(input: { rulePath: string; projectRoot: string; files: string[] }): FindingItem[] {
  const { rulePath, projectRoot, files } = input;
  return splitBatches(files).flatMap((batch) => runBatch({ rulePath, projectRoot, files: batch }));
}

function removeDuplicateFailures(findings: FindingItem[]): FindingItem[] {
  const seen = new Set<string>();
  return findings.filter(({ ruleId, message }) => {
    if (ruleId !== "ast-grep") {
      return true;
    }
    const known = seen.has(message);
    seen.add(message);
    return !known;
  });
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
    const findings = [...groupByLanguage(files)].flatMap(([language, group]) =>
      scanLanguage({ language, files: group, rulePaths, projectRoot, directory }),
    );
    return removeDuplicateFailures(findings);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
