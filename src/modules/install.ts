import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  INSTALL_AST_GREP_VERSION,
  INSTALL_FAILED_FILE,
  INSTALL_PACKAGE_NAMES,
  INSTALL_PACKAGES,
  INSTALL_RETRY_MILLISECONDS,
  INSTALL_TIMEOUT_MILLISECONDS,
} from "../consts/install.ts";
import { readTextFile, removeFile, writeTextFile } from "../helpers/infrastructure/filesystem.ts";

export function resolveDataDirectory(): string {
  const explicit = process.env.CODEMASTER_DATA_DIR;
  if (explicit) {
    return explicit;
  }
  const dataHome = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  return join(dataHome, "codemaster");
}

function readInstalledVersion(packageName: string): string | null {
  const manifestPath = join(resolveDataDirectory(), "node_modules", packageName, "package.json");
  if (!existsSync(manifestPath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(manifestPath, "utf8")).version ?? null;
  } catch {
    return null;
  }
}

export function isInstalled(): boolean {
  return INSTALL_PACKAGE_NAMES.every(
    (packageName) => readInstalledVersion(packageName) === INSTALL_AST_GREP_VERSION,
  );
}

function runInstall(dataDirectory: string): { ok: boolean; message: string | null } {
  try {
    mkdirSync(dataDirectory, { recursive: true });
  } catch (error) {
    const failure = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `codemaster: install failed (${failure.split("\n")[0]})` };
  }
  const outcome = spawnSync(
    "npm",
    ["install", "--prefix", dataDirectory, "--no-save", "--no-audit", "--no-fund", "--fetch-retries=1", "--fetch-timeout=20000", ...INSTALL_PACKAGES],
    { encoding: "utf8", timeout: INSTALL_TIMEOUT_MILLISECONDS },
  );
  if (outcome.status === 0 && isInstalled()) {
    return {
      ok: true,
      message: `codemaster: installed ast-grep ${INSTALL_AST_GREP_VERSION} into ${dataDirectory}`,
    };
  }
  const reason =
    (outcome.stderr ?? "").split("\n").find((line) => line.trim() !== "") ??
    outcome.error?.message ??
    `exit ${outcome.status}`;
  return { ok: false, message: `codemaster: install failed (${reason.trim()})` };
}

function findRetryTime(markerPath: string): number | null {
  const failedAt = Date.parse(readTextFile(markerPath) ?? "");
  const retryAt = failedAt + INSTALL_RETRY_MILLISECONDS;
  return Number.isNaN(failedAt) || retryAt <= Date.now() ? null : retryAt;
}

function recordOutcome(markerPath: string, succeeded: boolean): void {
  try {
    if (succeeded) {
      removeFile(markerPath);
    } else {
      writeTextFile(markerPath, new Date().toISOString());
    }
  } catch {
    return;
  }
}

export function ensureInstalled(): { ok: boolean; message: string | null } {
  if (isInstalled()) {
    return { ok: true, message: null };
  }
  const dataDirectory = resolveDataDirectory();
  const markerPath = join(dataDirectory, INSTALL_FAILED_FILE);
  const retryAt = findRetryTime(markerPath);
  if (retryAt !== null) {
    return { ok: false, message: `codemaster: install failed recently; retrying after ${new Date(retryAt).toISOString()}; run codemaster install to retry now` };
  }
  const outcome = runInstall(dataDirectory);
  recordOutcome(markerPath, outcome.ok);
  return outcome;
}

export async function runCommand(): Promise<number> {
  recordOutcome(join(resolveDataDirectory(), INSTALL_FAILED_FILE), true);
  const outcome = ensureInstalled();
  if (outcome.message) {
    process.stderr.write(`${outcome.message}\n`);
  }
  return 0;
}
