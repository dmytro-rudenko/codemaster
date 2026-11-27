export type RoleName =
  | "module"
  | "single-file-module"
  | "interfaces"
  | "consts"
  | "helper"
  | "util"
  | "test"
  | "entrypoint"
  | "other";

export type RoleLayout = "modular" | "layered" | "off";

export interface RoleFile {
  path: string;
  role: RoleName;
  entity: string | null;
  global: boolean;
}
