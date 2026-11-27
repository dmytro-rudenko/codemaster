import type { ConfigProject } from "../interfaces/config.ts";
import { ROLES_ALIASES } from "./roles.ts";

export const CONFIG_FILE_NAME = ".codemaster.json";

export const CONFIG_LOCAL_FILE_NAME = ".codemaster.local.json";

export const CONFIG_SOURCE_ROOT_PATTERN = /^[A-Za-z0-9_@.\/-]{1,100}$/;

export const CONFIG_RULE_PROBLEM = 'expected "off", a severity or {severity, max, reason}';

export const CONFIG_DEFAULTS: ConfigProject = {
  hook: true,
  layout: "auto",
  sourceRoot: "src",
  entrypoints: ["src/index.ts", "src/main.ts", "bin/*.ts"],
  singleFileMaxLines: 150,
  coverageCommand: null,
  abbreviationAllowlist: ["id", "url", "uri", "api", "http", "https", "json", "html", "css", "sql", "uuid", "io", "ui"],
  simplePackages: ["axios", "node-fetch", "got", "superagent", "request"],
  infrastructurePackages: [
    "pg", "mysql2", "mongodb", "mongoose", "ioredis", "redis", "@prisma/client", "typeorm", "knex", "sequelize", "drizzle-orm",
  ],
  tournament: {
    minComplexity: 5,
    minLines: 10,
    weights: { readability: 0.2, length: 0.2, bytecode: 0.2, speed: 0.2, closeness: 0.2 },
  },
  libraryDigest: true,
  libraryDigestDev: false,
  libraryDigestPerRun: 5,
  roles: ROLES_ALIASES,
  testsLocation: "",
  testSuffix: "test",
  constantCase: "upper-snake",
  interfacePrefix: "",
  entityPrefix: true,
  rules: {},
  sources: {},
};
