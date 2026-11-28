import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { MANIFEST_FILE, MANIFEST_SKIPPED_DIRECTORIES } from "../../consts/manifest.ts";
import { matchesGlob } from "../../utils/glob.ts";

function walkManifests(projectRoot: string, directory: string): string[] {
  const absolute = join(projectRoot, directory);
  if (directory !== "" && existsSync(join(absolute, ".git"))) {
    return [];
  }
  const entries = readdirSync(absolute, { withFileTypes: true });
  const own = entries.some((entry) => entry.isFile() && entry.name === MANIFEST_FILE) ? [join(directory, MANIFEST_FILE)] : [];
  const nested = entries
    .filter((entry) => entry.isDirectory() && !MANIFEST_SKIPPED_DIRECTORIES.includes(entry.name))
    .flatMap((entry) => walkManifests(projectRoot, join(directory, entry.name)));
  return [...own, ...nested];
}

export function listManifests(projectRoot: string, exclude: string[]): string[] {
  const found = existsSync(projectRoot) ? walkManifests(projectRoot, "") : [];
  return found.filter((path) => !exclude.some((pattern) => matchesGlob(path, pattern))).sort();
}
