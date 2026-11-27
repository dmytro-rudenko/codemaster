export interface HookStopInput {
  cwd?: string;
  // Field name fixed by the Claude Code Stop hook payload.
  stop_hook_active?: boolean;
}
