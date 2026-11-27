import { existsSync } from "node:fs";
import { extname, join, posix } from "node:path";
import { CHECK_SOURCE_EXTENSIONS } from "../../consts/check.ts";
import { readJsonFile, readTextFile } from "../infrastructure/filesystem.ts";
import { listSourceRoots, resolveTestsLocation } from "../../modules/config.ts";
import type { ConfigProject } from "../../interfaces/config.ts";
import type { FindingItem } from "../../interfaces/finding.ts";
import type { RoleFile, RoleLayout } from "../../interfaces/role.ts";

function mirrorDirectory(path: string, location: string, roots: string[]): string {
  const directory = posix.dirname(path);
  if (location === "colocated") {
    return directory;
  }
  const holding = roots
    .filter((root) => root === "" || directory === root || directory.startsWith(`${root}/`))
    .sort((left, right) => right.length - left.length)[0];
  const relative = holding === undefined || holding === "" ? directory : posix.relative(holding, directory) || ".";
  return posix.join(location, relative);
}

export function checkTestMirror(input: {
  projectRoot: string;
  role: RoleFile;
  layout: RoleLayout;
  config: ConfigProject;
}): FindingItem[] {
  const { projectRoot, role, layout, config } = input;
  const strict = role.role === "module" || role.role === "single-file-module";
  const lenient = role.role === "helper" || role.role === "util";
  if (!strict && !lenient) {
    return [];
  }
  const path = role.path.replaceAll("\\", "/");
  const extension = extname(path);
  const name = posix.basename(path, extension);
  const location = resolveTestsLocation(config, layout);
  const directory = mirrorDirectory(path, location, listSourceRoots(config));
  const otherSuffix = config.testSuffix === "test" ? "spec" : "test";
  const expected = posix.join(directory, `${name}.${config.testSuffix}${extension}`);
  const found = [config.testSuffix, otherSuffix].some((suffix) =>
    CHECK_SOURCE_EXTENSIONS.some((candidate) =>
      existsSync(join(projectRoot, directory, `${name}.${suffix}${candidate}`)),
    ),
  );
  if (found) {
    return [];
  }
  return [
    {
      severity: strict ? "error" : "warning",
      ruleId: "test-mirror",
      file: path,
      line: 1,
      message: `missing test ${expected}`,
    },
  ];
}

function listKeys(manifest: unknown, section: string): string[] {
  if (typeof manifest !== "object" || manifest === null) {
    return [];
  }
  const entries = (manifest as Record<string, unknown>)[section];
  if (typeof entries !== "object" || entries === null) {
    return [];
  }
  return Object.keys(entries);
}

function findKeyLine(lines: string[], section: string, name: string): number {
  const sectionIndex = lines.findIndex((line) => line.trim().startsWith(`"${section}"`));
  const keyIndex = lines.findIndex(
    (line, position) => position > sectionIndex && line.trim().startsWith(`"${name}"`),
  );
  return (keyIndex === -1 ? Math.max(sectionIndex, 0) : keyIndex) + 1;
}

export function checkSimplePackages(input: { projectRoot: string; config: ConfigProject }): FindingItem[] {
  const manifestPath = join(input.projectRoot, "package.json");
  const text = readTextFile(manifestPath);
  const { value, error } = readJsonFile(manifestPath);
  if (text === null || error !== null) {
    return [];
  }
  const lines = text.split("\n");
  const findings: FindingItem[] = [];
  for (const name of input.config.simplePackages) {
    const section = ["dependencies", "devDependencies"].find((candidate) => listKeys(value, candidate).includes(name));
    if (section !== undefined) {
      findings.push({
        severity: "warning",
        ruleId: "simple-package",
        file: "package.json",
        line: findKeyLine(lines, section, name),
        message: `${name}: write simple HTTP code yourself (fetch)`,
      });
    }
  }
  return findings;
}
