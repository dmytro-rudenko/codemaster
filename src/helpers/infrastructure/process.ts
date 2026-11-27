import { spawnSync } from "node:child_process";

export function runProcess(
  command: string,
  argumentsList: string[],
  options: { cwd: string; input?: string; timeoutMilliseconds?: number; environment?: NodeJS.ProcessEnv },
): { status: number | null; stdout: string; stderr: string; timedOut: boolean } {
  const { cwd, input, timeoutMilliseconds, environment } = options;
  const { status, stdout, stderr, error } = spawnSync(command, argumentsList, {
    cwd,
    input,
    timeout: timeoutMilliseconds,
    env: environment ?? process.env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const timedOut = (error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
  return { status, stdout: stdout ?? "", stderr: stderr ?? "", timedOut };
}
