import { existsSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";
import type { CommandContext } from "../interfaces/command.ts";
import type { ConfigProject } from "../interfaces/config.ts";
import type { LibraryDiff, LibraryEntry, LibraryStale } from "../interfaces/library.ts";
import { readJsonFile, readTextFile, removeFile, writeTextFile } from "../helpers/infrastructure/filesystem.ts";
import {
  LIBRARIES_GUARDED_PATHS,
  LIBRARIES_INDEX_FILE,
  LIBRARIES_INDEX_HEADER,
  LIBRARIES_MANIFEST_FILE,
  LIBRARIES_MANIFEST_INVALID,
  LIBRARIES_MANIFEST_MISSING,
  LIBRARIES_NAME_PATTERN,
  LIBRARIES_README_NAMES,
  LIBRARIES_SKILL_DIRECTORY,
  LIBRARIES_TYPES_PREFIX,
} from "../consts/libraries.ts";

function fileNameFor(name: string): string {
  return `${name.replace(/^@/, "").replace("/", "__")}.md`;
}

function parseFrontmatter(text: string): Record<string, string> {
  const block = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
  const pairs = block.split("\n").map((line) => line.match(/^([\w-]+):\s*(.*)$/));
  return Object.fromEntries(pairs.flatMap((match) => (match ? [[match[1], match[2].trim()]] : [])));
}

function readSummaries(
  projectRoot: string,
): { fileName: string; name: string; version: string; text: string; managed: boolean }[] {
  const directory = join(projectRoot, LIBRARIES_SKILL_DIRECTORY);
  const fileNames = existsSync(directory) ? readdirSync(directory) : [];
  return fileNames
    .filter((fileName) => fileName.endsWith(".md") && fileName !== LIBRARIES_INDEX_FILE)
    .sort()
    .map((fileName) => {
      const text = (readTextFile(join(directory, fileName)) ?? "").replaceAll("\r\n", "\n");
      const frontmatter = parseFrontmatter(text);
      const { name = fileName.replace(/\.md$/, "").replace(/^(.+?)__(.+)$/, "@$1/$2"), version = "" } = frontmatter;
      const managed = "name" in frontmatter && "version" in frontmatter;
      return { fileName, name, version, text, managed };
    });
}

function findManifestProblem(projectRoot: string): string | null {
  const path = join(projectRoot, LIBRARIES_MANIFEST_FILE);
  const { value, error } = readJsonFile(path);
  if (error === null && typeof value === "object" && value !== null && !Array.isArray(value)) {
    return null;
  }
  return existsSync(path) ? LIBRARIES_MANIFEST_INVALID : LIBRARIES_MANIFEST_MISSING;
}

function readDeclared(projectRoot: string, config: ConfigProject): string[] {
  const { value } = readJsonFile(join(projectRoot, "package.json"));
  const manifest = (value ?? {}) as Record<string, Record<string, string> | undefined>;
  const groups = [manifest.dependencies, config.libraryDigestDev ? manifest.devDependencies : undefined];
  const names = new Set(groups.flatMap((group) => Object.keys(group ?? {})));
  return [...names].filter((name) => !name.startsWith(LIBRARIES_TYPES_PREFIX)).sort();
}

function readInstalled(projectRoot: string, name: string): LibraryEntry | null {
  if (!LIBRARIES_NAME_PATTERN.test(name)) {
    return null;
  }
  const directory = join(projectRoot, "node_modules", name);
  const { value, error } = readJsonFile(join(directory, "package.json"));
  if (error !== null) {
    return null;
  }
  const { version = "", homepage = null } = (value ?? {}) as { version?: string; homepage?: string };
  const readmeName = LIBRARIES_README_NAMES.find((fileName) => existsSync(join(directory, fileName)));
  const readme = readmeName === undefined ? null : `node_modules/${name}/${readmeName}`;
  return { name, version, readme, homepage };
}

function findOrphans(projectRoot: string, config: ConfigProject): ReturnType<typeof readSummaries> {
  if (findManifestProblem(projectRoot) !== null) {
    return [];
  }
  const declaredFiles = new Set(readDeclared(projectRoot, config).map(fileNameFor));
  return readSummaries(projectRoot).filter(({ fileName, managed }) => managed && !declaredFiles.has(fileName));
}

export function diffLibraries(input: { projectRoot: string; config: ConfigProject }): LibraryDiff {
  const { projectRoot, config } = input;
  const summaries = readSummaries(projectRoot);
  const declared = readDeclared(projectRoot, config);
  const summaryByFile = new Map(summaries.map((summary) => [summary.fileName, summary]));
  const remove = findOrphans(projectRoot, config).map(({ name }) => name).sort();
  const missing: string[] = [];
  const pending: Array<LibraryEntry | LibraryStale> = [];
  for (const name of declared) {
    const installed = readInstalled(projectRoot, name);
    const summary = summaryByFile.get(fileNameFor(name));
    if (installed === null) {
      missing.push(name);
    } else if (summary === undefined) {
      pending.push(installed);
    } else if (summary.version.match(/\d+/)?.[0] !== installed.version.match(/\d+/)?.[0]) {
      pending.push({ name, previous: summary.version, current: installed.version });
    }
  }
  const kept = pending.slice(0, config.libraryDigestPerRun);
  const add = kept.filter((item): item is LibraryEntry => !("previous" in item));
  const stale = kept.filter((item): item is LibraryStale => "previous" in item);
  return { add, remove, stale, missing, more: Math.max(0, pending.length - config.libraryDigestPerRun) };
}

export function formatLibraryDiff({ add, remove, stale, missing, more }: LibraryDiff): string[] {
  const lines = [
    ...add.map((item) => `add ${item.name} ${item.version} readme=${item.readme ?? "-"} homepage=${item.homepage ?? "-"}`),
    ...stale.map(({ name, previous, current }) => `stale ${name} ${previous} -> ${current}`),
    ...remove.map((name) => `remove ${name}`),
    ...missing.map((name) => `missing ${name} (not installed)`),
  ];
  return more > 0 ? [...lines, `… and ${more} more`] : lines;
}

function readPurpose(text: string): string {
  const body = (text.match(/(?:^|\n)## Purpose[ \t]*\n([\s\S]*?)(?=\n## |$)/)?.[1] ?? "").replace(/\s+/g, " ").trim();
  return body.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? body;
}

function assertWritable(projectRoot: string): void {
  const directory = join(projectRoot, LIBRARIES_SKILL_DIRECTORY);
  const linked = LIBRARIES_GUARDED_PATHS.some(
    (path) => lstatSync(join(projectRoot, path), { throwIfNoEntry: false })?.isSymbolicLink(),
  );
  const outside = existsSync(directory) && !realpathSync(directory).startsWith(realpathSync(projectRoot) + sep);
  if (linked || outside) {
    throw new Error(`refusing to write ${LIBRARIES_SKILL_DIRECTORY}: symlink or outside the project`);
  }
}

export function rebuildIndex(projectRoot: string): void {
  assertWritable(projectRoot);
  const rows = readSummaries(projectRoot).map(({ name, fileName, text }) => {
    const purpose = readPurpose(text);
    return purpose === "" ? `- [${name}](${fileName})` : `- [${name}](${fileName}) — ${purpose}`;
  });
  const body = rows.length > 0 ? `\n${rows.join("\n")}\n` : "";
  writeTextFile(join(projectRoot, LIBRARIES_SKILL_DIRECTORY, LIBRARIES_INDEX_FILE), LIBRARIES_INDEX_HEADER + body);
}

function pruneSummaries(projectRoot: string, config: ConfigProject): void {
  assertWritable(projectRoot);
  for (const { fileName } of findOrphans(projectRoot, config)) {
    removeFile(join(projectRoot, LIBRARIES_SKILL_DIRECTORY, fileName));
  }
}

export async function runCommand(context: CommandContext): Promise<number> {
  const { argumentsList, projectRoot, config } = context;
  if (!config.libraryDigest) {
    process.stdout.write("libraries: disabled\n");
    return 0;
  }
  const prune = argumentsList.includes("--prune");
  const index = argumentsList.includes("--index");
  const problem = findManifestProblem(projectRoot);
  if (problem !== null) {
    process.stderr.write(`warning libraries ${LIBRARIES_MANIFEST_FILE}: ${problem}; nothing pruned\n`);
    if (prune) {
      return 1;
    }
  }
  try {
    const diff = diffLibraries({ projectRoot, config });
    if (prune) {
      pruneSummaries(projectRoot, config);
    }
    if (prune || index) {
      rebuildIndex(projectRoot);
    }
    if (prune || !index) {
      process.stdout.write(formatLibraryDiff(diff).map((line) => `${line}\n`).join(""));
    }
  } catch (error) {
    process.stderr.write(`codemaster: ${error instanceof Error ? error.message : error}\n`);
  }
  return 0;
}
