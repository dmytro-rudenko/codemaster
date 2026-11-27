export type ConfigLayout = "auto" | "modular" | "layered" | "off";

export type ConfigSeverity = "error" | "warning";

export type ConfigRuleSetting = "off" | ConfigSeverity | { severity?: ConfigSeverity; max?: number; reason?: string };

export interface ConfigRoles {
  module: string[];
  interfaces: string[];
  consts: string[];
  helper: string[];
  util: string[];
}

export interface ConfigWeights {
  readability: number;
  length: number;
  bytecode: number;
  speed: number;
  closeness: number;
}

export interface ConfigTournament {
  minComplexity: number;
  minLines: number;
  weights: ConfigWeights;
}

export interface ConfigProject {
  hook: boolean;
  layout: ConfigLayout;
  sourceRoot: string | string[];
  exclude: string[];
  entrypoints: string[];
  singleFileMaxLines: number;
  coverageCommand: string | null;
  abbreviationAllowlist: string[];
  simplePackages: string[];
  infrastructurePackages: string[];
  tournament: ConfigTournament;
  libraryDigest: boolean;
  libraryDigestDev: boolean;
  libraryDigestPerRun: number;
  roles: ConfigRoles;
  testsLocation: string;
  testSuffix: "test" | "spec";
  constantCase: "upper-snake" | "camel";
  interfacePrefix: "" | "I";
  entityPrefix: boolean;
  rules: Record<string, ConfigRuleSetting>;
  sources: Record<string, string>;
}
