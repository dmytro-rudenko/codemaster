import type { ConfigProject } from "./config.ts";

export interface CommandContext {
  argumentsList: string[];
  projectRoot: string;
  config: ConfigProject;
  configWarnings: string[];
  input: string;
  pluginRoot: string;
}

export type CommandHandler = (context: CommandContext) => Promise<number>;
