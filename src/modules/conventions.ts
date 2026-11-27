import { existsSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { CHECK_IGNORED_DIRECTORIES, CHECK_SOURCE_EXTENSIONS } from "../consts/check.ts";
import { CONFIG_DEFAULTS, CONFIG_FILE_NAME } from "../consts/config.ts";
import {
  CONVENTIONS_DOMINANCE_MINIMUM,
  CONVENTIONS_DOMINANCE_SHARE,
  CONVENTIONS_SOURCE_ROOTS,
  CONVENTIONS_TEST_FOLDERS,
} from "../consts/conventions.ts";
import { ROLES_ALIASES } from "../consts/roles.ts";
import { parseSource } from "../helpers/infrastructure/ast-grep.ts";
import { readJsonFile, readTextFile, writeTextFile } from "../helpers/infrastructure/filesystem.ts";
import { isRepository, listAllSourceFiles } from "../helpers/infrastructure/git.ts";
import { runProcess } from "../helpers/infrastructure/process.ts";
import { collectDeclarations } from "../helpers/logic/declaration-rules.ts";
import { detectLayout, resolveFileRole } from "../helpers/logic/file-role.ts";
import type { CommandContext } from "../interfaces/command.ts";
import type { ConfigProject } from "../interfaces/config.ts";

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function isUserOwned(raw: Record<string, unknown>, key: string): boolean {
  if (Object.hasOwn(asRecord(raw.sources), key)) {
    return false;
  }
  return key.startsWith("rules.") ? Object.hasOwn(asRecord(raw.rules), key.slice(6)) : Object.hasOwn(raw, key);
}

function walkFiles(projectRoot: string, relative: string): string[] {
  return readdirSync(join(projectRoot, relative), { withFileTypes: true }).flatMap((entry) => {
    const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
    if (entry.name.startsWith(".") || CHECK_IGNORED_DIRECTORIES.includes(entry.name)) {
      return [];
    }
    if (entry.isDirectory()) {
      return walkFiles(projectRoot, path);
    }
    return CHECK_SOURCE_EXTENSIONS.includes(extname(entry.name)) && !entry.name.endsWith(".d.ts") ? [path] : [];
  });
}

function tally(keys: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const key of keys) {
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function pickDominant(counts: Record<string, number>, fallback: unknown): { value: unknown; source: string } {
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const [best, count] = Object.entries(counts).sort((left, right) => right[1] - left[1])[0] ?? ["", 0];
  if (count < CONVENTIONS_DOMINANCE_MINIMUM || count / total < CONVENTIONS_DOMINANCE_SHARE) {
    return { value: fallback, source: "default" };
  }
  return { value: best, source: `dominant ${Math.round((count / total) * 100)}% (${count}/${total})` };
}

function findRoles(files: string[], sourceRoot: string): { value: unknown; source: string } {
  const prefix = sourceRoot === "." ? "" : `${sourceRoot}/`;
  const inside = files.filter((file) => file.startsWith(prefix));
  const folders = new Set(inside.flatMap((file) => file.slice(prefix.length).split("/").slice(0, -1).slice(0, 3)));
  const names = Object.values(ROLES_ALIASES).flatMap((aliases) => aliases.filter((alias) => folders.has(alias)));
  const roles = Object.entries(ROLES_ALIASES).map(([role, aliases]) => {
    const present = aliases.filter((alias) => folders.has(alias));
    return [role, present.length > 0 ? present : [...aliases]];
  });
  return { value: Object.fromEntries(roles), source: names.length > 0 ? `found: ${names.join(", ")}` : "default" };
}

function describeTest(file: string): { location: string; suffix: string | null } | null {
  const segments = file.split("/");
  const suffix = /\.(test|spec)\./.exec(segments[segments.length - 1])?.[1] ?? null;
  const inFolder = CONVENTIONS_TEST_FOLDERS.includes(segments[0]);
  return suffix === null && !inFolder ? null : { location: inFolder ? segments[0] : "colocated", suffix };
}

function caseOf(name: string): string | null {
  if (/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/.test(name)) {
    return "upper-snake";
  }
  return /^[a-z][a-zA-Z0-9]*$/.test(name) ? "camel" : null;
}

async function scanDeclarations(projectRoot: string, files: string[], config: ConfigProject) {
  const layout = detectLayout(projectRoot, config);
  const tallies = { cases: [] as string[], prefixes: [] as string[], entities: [] as string[] };
  for (const file of files) {
    const { role, entity } = resolveFileRole(file, { layout, config });
    const text = role === "test" || role === "other" ? null : readTextFile(join(projectRoot, file));
    const declarations = text === null ? [] : collectDeclarations((await parseSource(file, text)).root());
    tallies.prefixes.push(...declarations.filter((item) => item.kind === "interface").map((item) => (/^I[A-Z]/.test(item.name) ? "I" : "")));
    const constants = role === "consts" ? declarations.filter((item) => item.kind === "constant") : [];
    tallies.cases.push(...constants.flatMap((item) => caseOf(item.name) ?? []));
    const stem = (entity ?? "").replaceAll(/[-_]/g, "").toLowerCase();
    const named = entity === null ? [] : constants.map((item) => item.name.replaceAll("_", "").toLowerCase().startsWith(stem));
    tallies.entities.push(...named.map(String));
  }
  return tallies;
}

function isOff(setting: unknown): boolean {
  const level = Array.isArray(setting) ? setting[0] : setting;
  return level === "off" || level === 0;
}

function limitSetting(setting: unknown): unknown {
  if (setting === undefined || isOff(setting)) {
    return setting === undefined ? null : "off";
  }
  const option = Array.isArray(setting) ? setting[1] : undefined;
  const max = typeof option === "number" ? option : asRecord(option).max;
  return typeof max === "number" ? { max } : null;
}

function mapConvention(convention: Record<string, unknown>): Record<string, unknown> {
  const selectors = [convention.selector].flat();
  const modifiers = [convention.modifiers ?? []].flat();
  const formats = [convention.format ?? convention.formats ?? []].flat();
  const naming = formats.length === 1 ? asRecord({ UPPER_CASE: "upper-snake", CONSTANT_CASE: "upper-snake", camelCase: "camel" })[String(formats[0])] : undefined;
  const constant = selectors.includes("variable") && (modifiers.includes("const") || modifiers.includes("global"));
  const prefixed = selectors.includes("interface") && [convention.prefix ?? []].flat().includes("I");
  return { ...(constant && naming !== undefined ? { constantCase: naming } : {}), ...(prefixed ? { interfacePrefix: "I" } : {}) };
}

function mapEslintRules(rules: Record<string, unknown>): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  for (const [name, target] of [["max-params", "rules.max-params"], ["max-depth", "rules.max-nesting"]]) {
    const limit = limitSetting(rules[name]);
    if (limit !== null) {
      mapped[target] = limit;
    }
  }
  if (isOff(rules["prefer-destructuring"])) {
    mapped["rules.prefer-destructuring"] = "off";
  }
  const naming = rules["@typescript-eslint/naming-convention"];
  const conventions = Array.isArray(naming) && !isOff(naming) ? naming.slice(1) : [];
  return Object.assign(mapped, ...conventions.map((convention) => mapConvention(asRecord(convention))));
}

function mapBiomeRules(projectRoot: string): Record<string, unknown> {
  const rules = asRecord(asRecord(asRecord(readJsonFile(join(projectRoot, "biome.json")).value).linter).rules);
  const parameterLimit = asRecord(rules.complexity).useMaxParams;
  const level = typeof parameterLimit === "string" ? parameterLimit : asRecord(parameterLimit).level;
  const { max } = asRecord(asRecord(parameterLimit).options);
  const limit = level === "off" ? "off" : typeof max === "number" ? { max } : null;
  const { conventions } = asRecord(asRecord(asRecord(rules.style).useNamingConvention).options);
  const constants = (Array.isArray(conventions) ? conventions : []).map(asRecord).filter((convention) => {
    const { kind } = asRecord(convention.selector);
    return kind === "const" || kind === "variable";
  });
  const naming = constants.map((convention) => mapConvention({ ...convention, selector: "variable", modifiers: ["const"] }));
  return Object.assign(limit === null ? {} : { "rules.max-params": limit }, ...naming);
}

function runEslint(projectRoot: string, file: string): { mapped: Record<string, unknown>; warnings: string[] } {
  const binary = join(projectRoot, "node_modules", ".bin", "eslint");
  const run = runProcess(binary, ["--print-config", file], { cwd: projectRoot, timeoutMilliseconds: 30000 });
  const firstLine = run.stderr.split("\n").find((line) => line.trim() !== "")?.trim();
  if (run.status !== 0) {
    const reason = firstLine ?? (run.timedOut ? "timed out" : `exit ${run.status}`);
    return { mapped: {}, warnings: [`warning conventions eslint: ${reason}`] };
  }
  try {
    return { mapped: mapEslintRules(asRecord(asRecord(JSON.parse(run.stdout)).rules)), warnings: [] };
  } catch (error) {
    return { mapped: {}, warnings: [`warning conventions eslint: ${error instanceof Error ? error.message : String(error)}`] };
  }
}

function scanLinters(projectRoot: string, file: string | undefined): { found: Record<string, { value: unknown; source: string }>; warnings: string[] } {
  const hasEslint = existsSync(join(projectRoot, "node_modules", ".bin", "eslint"));
  const { mapped, warnings } = hasEslint
    ? file === undefined ? { mapped: {}, warnings: [] } : runEslint(projectRoot, file)
    : { mapped: mapBiomeRules(projectRoot), warnings: [] };
  const source = hasEslint ? "eslint --print-config" : "biome.json";
  return { found: Object.fromEntries(Object.entries(mapped).map(([key, value]) => [key, { value, source }])), warnings };
}

export async function scanConventions(
  projectRoot: string,
  current: { config: ConfigProject; raw: Record<string, unknown> },
): Promise<{ profile: Partial<ConfigProject>; sources: Record<string, string>; warnings: string[] }> {
  const { config, raw } = current;
  const files = isRepository(projectRoot) ? listAllSourceFiles(projectRoot) : walkFiles(projectRoot, "").sort();
  const root = CONVENTIONS_SOURCE_ROOTS.find((name) => existsSync(join(projectRoot, name)) && statSync(join(projectRoot, name)).isDirectory()) ?? ".";
  const found: Record<string, { value: unknown; source: string }> = {
    sourceRoot: { value: root, source: root === "." ? "default" : `found: ${root}` },
    roles: findRoles(files, root),
  };
  const effective = (key: "sourceRoot" | "roles") => (isUserOwned(raw, key) ? config[key] : found[key].value);
  const scanConfig = { ...config, sourceRoot: effective("sourceRoot"), roles: effective("roles") } as ConfigProject;
  const tests = files.map(describeTest).filter((test) => test !== null);
  found.testsLocation = pickDominant(tally(tests.map((test) => test.location)), CONFIG_DEFAULTS.testsLocation);
  found.testSuffix = pickDominant(tally(tests.flatMap((test) => test.suffix ?? [])), CONFIG_DEFAULTS.testSuffix);
  const tallies = await scanDeclarations(projectRoot, files, scanConfig);
  found.constantCase = pickDominant(tally(tallies.cases), CONFIG_DEFAULTS.constantCase);
  found.interfacePrefix = pickDominant(tally(tallies.prefixes), CONFIG_DEFAULTS.interfacePrefix);
  const entityPrefix = pickDominant(tally(tallies.entities), String(CONFIG_DEFAULTS.entityPrefix));
  found.entityPrefix = { value: entityPrefix.value === "true", source: entityPrefix.source };
  const prefix = scanConfig.sourceRoot === "." ? "" : `${scanConfig.sourceRoot}/`;
  const linted = files.find((file) => file.startsWith(prefix) && describeTest(file) === null) ?? files[0];
  const linters = scanLinters(projectRoot, linted);
  Object.assign(found, linters.found);
  const profile: Record<string, unknown> = {};
  const sources: Record<string, string> = {};
  for (const [key, { value, source }] of Object.entries(found).filter(([key]) => !isUserOwned(raw, key))) {
    sources[key] = source;
    if (key.startsWith("rules.")) {
      profile.rules = { ...asRecord(profile.rules), [key.slice(6)]: value };
    } else {
      profile[key] = value;
    }
  }
  return { profile: profile as Partial<ConfigProject>, sources, warnings: linters.warnings };
}

export function writeProfile(projectRoot: string, merged: Record<string, unknown>): void {
  writeTextFile(join(projectRoot, CONFIG_FILE_NAME), `${JSON.stringify(merged, null, 2)}\n`);
}

export function formatProfile(profile: Partial<ConfigProject>, sources: Record<string, string>): string {
  const fields = ["layout", "sourceRoot", "roles", "testsLocation", "testSuffix", "constantCase", "interfacePrefix", "entityPrefix", "rules"] as const;
  const ruleSources = [...new Set(Object.entries(sources).filter(([key]) => key.startsWith("rules.")).map(([, source]) => source))];
  const sourceOf = (field: string) => (field === "rules" && ruleSources.length > 0 ? ruleSources.join(", ") : sources[field] ?? "default");
  const lines = fields.filter((field) => profile[field] !== undefined).map((field) => `  ${field} = ${JSON.stringify(profile[field])}  (${sourceOf(field)})`);
  return `${["codemaster profile:", ...lines].join("\n")}\n`;
}

function describeProfile(projectRoot: string, config: ConfigProject, raw: Record<string, unknown>): string {
  const sources: Record<string, string> = { layout: config.layout === "auto" ? "auto" : "user", ...config.sources };
  for (const key of Object.keys(raw).filter((name) => isUserOwned(raw, name))) {
    sources[key] = "user";
  }
  return formatProfile({ ...config, layout: detectLayout(projectRoot, config) }, sources);
}

export async function runCommand(context: CommandContext): Promise<number> {
  const { argumentsList, projectRoot, config } = context;
  const path = join(projectRoot, CONFIG_FILE_NAME);
  const parsed = existsSync(path) ? readJsonFile(path) : { value: {}, error: null };
  if (parsed.error !== null) {
    process.stderr.write(`warning config ${CONFIG_FILE_NAME}: invalid JSON; profile not written\n`);
    return 1;
  }
  const raw = asRecord(parsed.value);
  if (existsSync(path) && !argumentsList.includes("--refresh")) {
    process.stdout.write(describeProfile(projectRoot, config, raw));
    return 0;
  }
  const { profile, sources, warnings } = await scanConventions(projectRoot, { config, raw });
  const rules = { ...asRecord(raw.rules), ...asRecord(profile.rules) };
  const merged = { ...raw, ...profile, ...(Object.keys(rules).length > 0 ? { rules } : {}), sources: { ...asRecord(raw.sources), ...sources } };
  writeProfile(projectRoot, merged);
  for (const warning of warnings) {
    process.stderr.write(`${warning}\n`);
  }
  process.stdout.write(describeProfile(projectRoot, { ...config, ...merged } as ConfigProject, merged));
  return 0;
}
