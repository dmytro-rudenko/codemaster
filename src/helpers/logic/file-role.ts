import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { CONVENTIONS_TEST_FOLDERS } from "../../consts/conventions.ts";
import { ROLES_FILE_NAMES, ROLES_GLOBAL_NAMES } from "../../consts/roles.ts";
import { matchesGlob } from "../../utils/glob.ts";
import { listSourceRoots } from "../../modules/config.ts";
import type { ConfigProject, ConfigRoles } from "../../interfaces/config.ts";
import type { RoleFile, RoleLayout, RoleName } from "../../interfaces/role.ts";

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function withoutExtension(name: string): string {
  return name.replace(/\.[^./]+$/, "");
}

function entityOf(fileName: string): string {
  return withoutExtension(fileName).split(".")[0];
}

function stemOf(fileName: string): string {
  return withoutExtension(fileName).split(".").at(-1) as string;
}

function aliasRole(name: string, roles: ConfigRoles): RoleName | null {
  for (const key of ["module", "interfaces", "consts", "helper", "util"] as const) {
    if (roles[key].includes(name)) {
      return key;
    }
  }
  return null;
}

function nameRole(name: string, roles: ConfigRoles): RoleName | null {
  const aliased = aliasRole(name, roles);
  if (aliased !== null) {
    return aliased;
  }
  return Object.hasOwn(ROLES_FILE_NAMES, name) ? ROLES_FILE_NAMES[name] : null;
}

function isTestPath(normalized: string, config: ConfigProject): boolean {
  const segments = normalized.split("/");
  if (/\.(test|spec)\./.test(segments[segments.length - 1])) {
    return true;
  }
  if (CONVENTIONS_TEST_FOLDERS.includes(segments[0])) {
    return true;
  }
  const location = config.testsLocation.replace(/\/+$/, "");
  return location !== "" && (normalized === location || normalized.startsWith(`${location}/`));
}

function relativeSegments(normalized: string, config: ConfigProject): string[] | null {
  const segments = normalized.split("/");
  const holding = listSourceRoots(config)
    .map((root) => root.split("/").filter((part) => part !== ""))
    .filter((root) => segments.length > root.length && root.every((part, position) => segments[position] === part))
    .sort((left, right) => right.length - left.length);
  return holding.length === 0 ? null : segments.slice(holding[0].length);
}

function resolveLayered(relative: string[], config: ConfigProject): Omit<RoleFile, "path"> {
  const [first] = relative;
  if (relative.length === 1) {
    return { role: "single-file-module", entity: entityOf(first), global: false };
  }
  const role = aliasRole(first, config.roles);
  if (role === null) {
    return { role: "module", entity: first, global: false };
  }
  if (relative.length > 2) {
    return { role, entity: relative[1], global: false };
  }
  const entity = entityOf(relative[1]);
  if (role === "module") {
    return { role: "single-file-module", entity, global: false };
  }
  const isGlobal = (role === "consts" || role === "interfaces") && ROLES_GLOBAL_NAMES.includes(entity);
  return { role, entity: isGlobal ? null : entity, global: isGlobal };
}

function resolveModular(relative: string[], config: ConfigProject): Omit<RoleFile, "path"> {
  const [first] = relative;
  if (relative.length === 1) {
    return { role: "single-file-module", entity: entityOf(first), global: false };
  }
  if (config.roles.util.includes(first)) {
    return { role: "util", entity: null, global: false };
  }
  const names = [stemOf(relative[relative.length - 1]), ...relative.slice(1, -1).reverse()];
  const role = names.map((name) => nameRole(name, config.roles)).find((found) => found !== null) ?? "module";
  return { role, entity: first, global: first === "global" || first === "shared" };
}

export function resolveFileRole(path: string, options: { layout: RoleLayout; config: ConfigProject }): RoleFile {
  const { layout, config } = options;
  const normalized = normalizePath(path);
  if (isTestPath(normalized, config)) {
    return { path, role: "test", entity: null, global: false };
  }
  if (config.entrypoints.some((pattern) => matchesGlob(normalized, pattern))) {
    return { path, role: "entrypoint", entity: null, global: false };
  }
  const relative = relativeSegments(normalized, config);
  if (relative === null) {
    return { path, role: "other", entity: null, global: false };
  }
  if (layout === "off") {
    return { path, role: "module", entity: null, global: false };
  }
  const resolved = layout === "layered" ? resolveLayered(relative, config) : resolveModular(relative, config);
  return { path, ...resolved };
}

function holdsRoleFile(directory: string, config: ConfigProject): boolean {
  return readdirSync(directory).some((name) => {
    const role = nameRole(stemOf(name), config.roles);
    return role === "interfaces" || role === "consts" || role === "helper";
  });
}

export function detectLayout(projectRoot: string, config: ConfigProject): RoleLayout {
  if (config.layout !== "auto") {
    return config.layout;
  }
  const roots = listSourceRoots(config)
    .map((root) => join(projectRoot, root))
    .filter((root) => existsSync(root) && statSync(root).isDirectory());
  const folders = roots.flatMap((root) =>
    readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({ name: entry.name, path: join(root, entry.name) })),
  );
  const roles = new Set(folders.map(({ name }) => aliasRole(name, config.roles)).filter((role) => role !== null));
  if (roles.size >= 2) {
    return "layered";
  }
  return folders.some(({ path }) => holdsRoleFile(path, config)) ? "modular" : "off";
}
