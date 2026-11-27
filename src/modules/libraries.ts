import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { CommandContext } from "../interfaces/command.ts";
import type { ConfigProject } from "../interfaces/config.ts";
import type { LibraryDiff, LibraryEntry, LibraryStale } from "../interfaces/library.ts";
import { readJsonFile, readTextFile, removeFile, writeTextFile } from "../helpers/infrastructure/filesystem.ts";

const LIBRARIES_SKILL_DIRECTORY = ".claude/skills/codemaster-libraries";
const LIBRARIES_INDEX_FILE = "SKILL.md";
const LIBRARIES_INDEX_NAME = "codemaster-libraries";
const LIBRARIES_INDEX_DESCRIPTION =
  "Summaries of this project's libraries: key APIs, pitfalls and documentation links. Use before implementing something a dependency may already do.";
const LIBRARIES_TYPES_PREFIX = "@types/";

function fileNameFor(name: string): string {
  return `${name.replace(/^@/, "").replace("/", "__")}.md`;
}

function nameFromFile(fileName: string): string {
  const stem = fileName.replace(/\.md$/, "");
  const [scope, rest] = stem.split("__");
  return rest === undefined ? stem : `@${scope}/${rest}`;
}

function parseFrontmatter(text: string): Record<string, string> {
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---") {
    return {};
  }
  const end = lines.findIndex((line, position) => position > 0 && line.trim() === "---");
  const fields: Record<string, string> = {};
  for (const line of lines.slice(1, end === -1 ? lines.length : end)) {
    const match = line.match(/^([\w-]+):\s*(.*)$/);
    if (match) {
      fields[match[1]] = match[2].trim();
    }
  }
  return fields;
}

function listSummaryFiles(directory: string): string[] {
  try {
    return readdirSync(directory)
      .filter((fileName) => fileName.endsWith(".md") && fileName !== LIBRARIES_INDEX_FILE)
      .sort();
  } catch {
    return [];
  }
}

function readSummaries(projectRoot: string): { fileName: string; name: string; version: string; text: string }[] {
  const directory = join(projectRoot, LIBRARIES_SKILL_DIRECTORY);
  return listSummaryFiles(directory).map((fileName) => {
    const text = readTextFile(join(directory, fileName)) ?? "";
    const { name = nameFromFile(fileName), version = "" } = parseFrontmatter(text);
    return { fileName, name, version, text };
  });
}

function readDeclared(projectRoot: string, config: ConfigProject): string[] {
  const { value } = readJsonFile(join(projectRoot, "package.json"));
  const manifest = (value ?? {}) as Record<string, Record<string, string> | undefined>;
  const groups = [manifest.dependencies, config.libraryDigestDev ? manifest.devDependencies : undefined];
  const names = groups.flatMap((group) => Object.keys(group ?? {}));
  return [...new Set(names)].filter((name) => !name.startsWith(LIBRARIES_TYPES_PREFIX)).sort();
}

function readInstalled(projectRoot: string, name: string): LibraryEntry | null {
  const directory = join(projectRoot, "node_modules", name);
  const { value, error } = readJsonFile(join(directory, "package.json"));
  if (error !== null) {
    return null;
  }
  const manifest = (value ?? {}) as { version?: string; homepage?: string };
  const readme = existsSync(join(directory, "README.md")) ? `node_modules/${name}/README.md` : null;
  return { name, version: manifest.version ?? "", readme, homepage: manifest.homepage ?? null };
}

function majorOf(version: string): string | null {
  return version.match(/\d+/)?.[0] ?? null;
}

export function diffLibraries(input: { projectRoot: string; config: ConfigProject }): LibraryDiff {
  const { projectRoot, config } = input;
  const summaries = readSummaries(projectRoot);
  const declared = readDeclared(projectRoot, config);
  const declaredFiles = new Set(declared.map(fileNameFor));
  const summaryByFile = new Map(summaries.map((summary) => [summary.fileName, summary]));
  const remove = summaries
    .filter((summary) => !declaredFiles.has(summary.fileName))
    .map((summary) => summary.name)
    .sort();
  const missing: string[] = [];
  const pending: Array<LibraryEntry | LibraryStale> = [];
  for (const name of declared) {
    const installed = readInstalled(projectRoot, name);
    const summary = summaryByFile.get(fileNameFor(name));
    if (installed === null) {
      missing.push(name);
    } else if (summary === undefined) {
      pending.push(installed);
    } else if (majorOf(summary.version) !== majorOf(installed.version)) {
      pending.push({ name, previous: summary.version, current: installed.version });
    }
  }
  const add: LibraryEntry[] = [];
  const stale: LibraryStale[] = [];
  for (const item of pending.slice(0, config.libraryDigestPerRun)) {
    if ("previous" in item) {
      stale.push(item);
    } else {
      add.push(item);
    }
  }
  return { add, remove, stale, missing, more: Math.max(0, pending.length - config.libraryDigestPerRun) };
}

export function formatLibraryDiff(diff: LibraryDiff): string[] {
  const { add, remove, stale, missing, more } = diff;
  const lines = [
    ...add.map(
      ({ name, version, readme, homepage }) =>
        `add ${name} ${version} readme=${readme ?? "-"} homepage=${homepage ?? "-"}`,
    ),
    ...stale.map(({ name, previous, current }) => `stale ${name} ${previous} -> ${current}`),
    ...remove.map((name) => `remove ${name}`),
    ...missing.map((name) => `missing ${name} (not installed)`),
  ];
  if (more > 0) {
    lines.push(`… and ${more} more`);
  }
  return lines;
}

function readPurpose(text: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.trim() === "## Purpose");
  if (start === -1) {
    return "";
  }
  const section = lines.slice(start + 1);
  const end = section.findIndex((line) => line.startsWith("## "));
  const body = (end === -1 ? section : section.slice(0, end)).join(" ").replace(/\s+/g, " ").trim();
  return body.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? body;
}

export function rebuildIndex(projectRoot: string): void {
  const rows = readSummaries(projectRoot).map(({ name, fileName, text }) => {
    const purpose = readPurpose(text);
    return purpose === "" ? `- [${name}](${fileName})` : `- [${name}](${fileName}) — ${purpose}`;
  });
  const header = `---\nname: ${LIBRARIES_INDEX_NAME}\ndescription: ${LIBRARIES_INDEX_DESCRIPTION}\n---\n`;
  const body = rows.length > 0 ? `\n${rows.join("\n")}\n` : "";
  writeTextFile(join(projectRoot, LIBRARIES_SKILL_DIRECTORY, LIBRARIES_INDEX_FILE), header + body);
}

function pruneSummaries(projectRoot: string, names: string[]): void {
  for (const summary of readSummaries(projectRoot)) {
    if (names.includes(summary.name)) {
      removeFile(join(projectRoot, LIBRARIES_SKILL_DIRECTORY, summary.fileName));
    }
  }
}

export async function runCommand(context: CommandContext): Promise<number> {
  const { argumentsList, projectRoot, config } = context;
  if (!config.libraryDigest) {
    process.stdout.write("libraries: disabled\n");
    return 0;
  }
  if (argumentsList.includes("--index")) {
    rebuildIndex(projectRoot);
    return 0;
  }
  const diff = diffLibraries({ projectRoot, config });
  if (argumentsList.includes("--prune")) {
    pruneSummaries(projectRoot, diff.remove);
    rebuildIndex(projectRoot);
  }
  for (const line of formatLibraryDiff(diff)) {
    process.stdout.write(`${line}\n`);
  }
  return 0;
}
