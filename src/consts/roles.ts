import type { ConfigRoles } from "../interfaces/config.ts";
import type { RoleName } from "../interfaces/role.ts";

export const ROLES_ALIASES: ConfigRoles = {
  module: ["modules", "services", "controllers", "features", "domains", "handlers"],
  interfaces: ["interfaces", "types", "typings", "contracts", "dto"],
  consts: ["consts", "constants", "enums"],
  helper: ["helpers"],
  util: ["utils", "util", "shared", "common", "lib"],
};

export const ROLES_FILE_NAMES: Record<string, RoleName> = {
  interfaces: "interfaces",
  interface: "interfaces",
  types: "interfaces",
  type: "interfaces",
  consts: "consts",
  const: "consts",
  constants: "consts",
  constant: "consts",
  helpers: "helper",
  helper: "helper",
  utils: "util",
  util: "util",
};

export const ROLES_GLOBAL_NAMES = ["global", "globals", "shared", "index"];
