import { existsSync } from "node:fs";
import { join } from "node:path";
import { CHECK_RULE_SEVERITY } from "../consts/check.ts";
import { CONFIG_DEFAULTS, CONFIG_FILE_NAME, CONFIG_LOCAL_FILE_NAME } from "../consts/config.ts";
import type { ConfigProject, ConfigSeverity } from "../interfaces/config.ts";
import type { RoleLayout } from "../interfaces/role.ts";
import { readJsonFile } from "../helpers/infrastructure/filesystem.ts";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeType(value: unknown): string {
  if (value === null) {
    return "null";
  }
  return Array.isArray(value) ? "array" : typeof value;
}

function findValueProblem(field: string, value: unknown): string | null {
  const allowedValues: Record<string, string[]> = {
    layout: ["auto", "modular", "layered", "off"],
    testSuffix: ["test", "spec"],
    constantCase: ["upper-snake", "camel"],
    interfacePrefix: ["", "I"],
  };
  if (Object.hasOwn(allowedValues, field)) {
    const { [field]: allowed } = allowedValues;
    const listed = allowed.map((option) => (option === "" ? '""' : option)).join("|");
    return allowed.includes(value as string) ? null : `expected one of ${listed}`;
  }
  if (Array.isArray(value) && !value.every((item) => typeof item === "string")) {
    return "expected string[]";
  }
  return null;
}

function mergeValue(base: unknown, override: unknown, field: string, warnings: string[]): unknown {
  if (override === undefined) {
    return base;
  }
  if (field === "coverageCommand") {
    if (override === null || typeof override === "string") {
      return override;
    }
    warnings.push(`warning config ${field}: expected string or null`);
    return base;
  }
  const expected = describeType(base);
  if (describeType(override) !== expected) {
    warnings.push(`warning config ${field}: expected ${expected}`);
    return base;
  }
  const problem = findValueProblem(field, override);
  if (problem !== null) {
    warnings.push(`warning config ${field}: ${problem}`);
    return base;
  }
  if (!isPlainRecord(base) || !isPlainRecord(override)) {
    return override;
  }
  if (field === "rules" || field === "sources") {
    return { ...base, ...override };
  }
  const merged: Record<string, unknown> = {};
  for (const [key, baseValue] of Object.entries(base)) {
    merged[key] = mergeValue(baseValue, override[key], field === "" ? key : `${field}.${key}`, warnings);
  }
  return merged;
}

function readConfigFile(path: string, name: string, warnings: string[]): Record<string, unknown> | undefined {
  if (!existsSync(path)) {
    return undefined;
  }
  const { value, error } = readJsonFile(path);
  if (error !== null) {
    warnings.push(`warning config ${name}: invalid JSON`);
    return undefined;
  }
  if (!isPlainRecord(value)) {
    warnings.push(`warning config ${name}: expected object`);
    return undefined;
  }
  return value;
}

export function loadConfig(projectRoot: string): { config: ConfigProject; warnings: string[]; exists: boolean } {
  const warnings: string[] = [];
  let merged: unknown = structuredClone(CONFIG_DEFAULTS);
  for (const name of [CONFIG_FILE_NAME, CONFIG_LOCAL_FILE_NAME]) {
    merged = mergeValue(merged, readConfigFile(join(projectRoot, name), name, warnings), "", warnings);
  }
  return { config: merged as ConfigProject, warnings, exists: existsSync(join(projectRoot, CONFIG_FILE_NAME)) };
}

export function resolveTestsLocation(config: ConfigProject, layout: RoleLayout): string {
  const { testsLocation } = config;
  if (testsLocation !== "") {
    return testsLocation;
  }
  return layout === "layered" ? "tests" : "colocated";
}

export function resolveRuleSetting(
  config: ConfigProject,
  ruleId: string,
): { enabled: boolean; severity: ConfigSeverity; max: number | null; reason: string | null } {
  const { rules } = config;
  const setting: unknown = rules[ruleId];
  const severity = CHECK_RULE_SEVERITY[ruleId] ?? "error";
  if (setting === "off") {
    return { enabled: false, severity, max: null, reason: null };
  }
  if (setting === "error" || setting === "warning") {
    return { enabled: true, severity: setting, max: null, reason: null };
  }
  if (!isPlainRecord(setting)) {
    return { enabled: true, severity, max: null, reason: null };
  }
  const { severity: chosen, max, reason } = setting;
  return {
    enabled: true,
    severity: chosen === "error" || chosen === "warning" ? chosen : severity,
    max: typeof max === "number" ? max : null,
    reason: typeof reason === "string" ? reason : null,
  };
}
