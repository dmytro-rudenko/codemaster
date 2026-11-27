import { resolve } from "node:path";
import { text } from "node:stream/consumers";

async function main(): Promise<void> {
  const COMMAND_MODULES: Record<string, string> = {
    check: "../src/modules/check.ts",
    conventions: "../src/modules/conventions.ts",
    tournament: "../src/modules/tournament.ts",
    libraries: "../src/modules/libraries.ts",
    install: "../src/modules/install.ts",
    "hook-stop": "../src/modules/hook.ts",
    "hook-session-start": "../src/modules/hook.ts",
  };
  const { node: version } = process.versions;
  const [major, minor] = version.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 18)) {
    process.stdout.write(`codemaster: requires Node >= 22.18 (found ${version})\n`);
    return;
  }
  const name = process.argv[2] ?? "";
  if (!Object.hasOwn(COMMAND_MODULES, name)) {
    process.stderr.write(`usage: codemaster <${Object.keys(COMMAND_MODULES).join("|")}> [arguments]\n`);
    process.exitCode = 2;
    return;
  }
  const isHook = name.startsWith("hook-");
  try {
    const input = isHook ? await text(process.stdin) : "";
    const projectRoot: string = isHook ? (JSON.parse(input).cwd ?? process.cwd()) : process.cwd();
    const { loadConfig } = await import("../src/modules/config.ts");
    const { config, warnings } = loadConfig(projectRoot);
    const { runCommand } = await import(new URL(COMMAND_MODULES[name], import.meta.url).href);
    const extra = process.argv.slice(3);
    process.exitCode = await runCommand({
      argumentsList: isHook ? [name, ...extra] : extra,
      projectRoot,
      config,
      configWarnings: warnings,
      input,
      pluginRoot: resolve(import.meta.dirname, ".."),
    });
  } catch (error) {
    if (!isHook) {
      throw error;
    }
    process.stderr.write(`codemaster: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 0;
  }
}

main();
