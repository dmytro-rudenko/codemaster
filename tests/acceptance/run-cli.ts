import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdtempSync, readdirSync, renameSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const PLUGIN_ROOT = resolve(import.meta.dirname, "../..");

export interface CliResult { status: number; stdout: string; stderr: string }

export function runCli(
  argumentsList: string[],
  options: { cwd?: string; input?: string; environment?: NodeJS.ProcessEnv } = {},
): CliResult {
  const { cwd = PLUGIN_ROOT, input, environment = {} } = options;
  const result = spawnSync(process.execPath, [join(PLUGIN_ROOT, "bin/codemaster.ts"), ...argumentsList], {
    cwd,
    input,
    env: { ...process.env, ...environment },
    encoding: "utf8",
    timeout: 600000,
  });
  return { status: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function makeExecutable(directory: string): void {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) {
      makeExecutable(path);
    } else if (directory.endsWith(".bin")) {
      chmodSync(path, 0o755);
    }
  }
}

export function copyFixture(name: string): string {
  const directory = mkdtempSync(join(tmpdir(), "codemaster-"));
  cpSync(join(PLUGIN_ROOT, "tests/fixtures", name), directory, { recursive: true });
  const fake = join(directory, "fake_modules");
  if (existsSync(fake)) {
    renameSync(fake, join(directory, "node_modules"));
    makeExecutable(join(directory, "node_modules"));
  }
  return directory;
}

export function git(directory: string, argumentsList: string[]): string {
  const result = spawnSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=test", ...argumentsList], {
    cwd: directory,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`git ${argumentsList.join(" ")}: ${result.stderr}`);
  }
  return result.stdout;
}

export function initializeRepository(directory: string, options: { commitFiles?: boolean } = {}): void {
  const { commitFiles = true } = options;
  git(directory, ["init", "-q", "-b", "main"]);
  if (commitFiles) {
    git(directory, ["add", "-A"]);
  }
  git(directory, ["commit", "-q", "--allow-empty", "-m", "base"]);
  git(directory, ["checkout", "-q", "-b", "work"]);
}

export interface FindingShape { severity: string; ruleId: string; file: string; line: number; message: string; reason?: string }

export function checkJson(directory: string, argumentsList: string[]): { status: number; findings: FindingShape[] } {
  const result = runCli(["check", "--json", ...argumentsList], { cwd: directory });
  const lastLine = result.stdout.trim().split("\n").pop() ?? "";
  const parsed = JSON.parse(lastLine) as { findings: FindingShape[] };
  return { status: result.status, findings: parsed.findings };
}

export function triples(findings: FindingShape[]): string[] {
  return findings
    .filter((finding) => finding.ruleId !== "parse")
    .map((finding) => `${finding.ruleId} ${finding.file}:${finding.line}`)
    .sort();
}

export function stateDirectory(directory: string): string {
  return resolve(directory, git(directory, ["rev-parse", "--git-path", "codemaster"]).trim());
}
