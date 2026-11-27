import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG_DEFAULTS } from "../../src/consts/config.ts";
import { buildStopReason, runCommand } from "../../src/modules/hook.ts";
import type { FindingItem } from "../../src/interfaces/finding.ts";

function finding(line: number): FindingItem {
  return { severity: "error", ruleId: "max-params", file: "src/a.ts", line, message: "too many" };
}

async function captureOutput(action: () => Promise<number>): Promise<{ status: number; output: string }> {
  const original = process.stdout.write.bind(process.stdout);
  let output = "";
  process.stdout.write = ((chunk: string) => {
    output += chunk;
    return true;
  }) as typeof process.stdout.write;
  try {
    const status = await action();
    return { status, output };
  } finally {
    process.stdout.write = original;
  }
}

test("the reason starts with the header and lists findings with their summary", () => {
  const reason = buildStopReason({
    profile: null,
    findings: [finding(3)],
    summary: { errors: 1, warnings: 0, files: 1 },
    candidates: [],
    libraries: [],
  });
  const lines = reason.split("\n");
  assert.equal(lines[0], "Run the codemaster skill (codemaster:codemaster) for this branch.");
  assert.ok(lines.includes("Findings (1 errors, 0 warnings):"), reason);
  assert.ok(lines.includes("error max-params src/a.ts:3 too many"), reason);
  assert.ok(!reason.includes("Tournament candidates"), reason);
  assert.ok(!reason.includes("Libraries:"), reason);
});

test("the reason caps findings at 30 lines and says how many are left", () => {
  const findings = Array.from({ length: 33 }, (_, index) => finding(index + 1));
  const reason = buildStopReason({
    profile: null,
    findings,
    summary: { errors: 33, warnings: 0, files: 1 },
    candidates: [],
    libraries: [],
  });
  const findingLines = reason.split("\n").filter((line) => line.startsWith("error max-params"));
  assert.equal(findingLines.length, 30);
  assert.ok(reason.includes("… and 3 more"), reason);
});

test("the reason puts the profile before findings and lists candidates and libraries", () => {
  const reason = buildStopReason({
    profile: "codemaster profile:\n  layout = \"modular\"  (auto)\n",
    findings: [],
    summary: { errors: 0, warnings: 0, files: 0 },
    candidates: ["src/math.ts:1 scoreValues complexity=6 lines=9"],
    libraries: ["add alpha 1.2.0 readme=- homepage=-"],
  });
  const lines = reason.split("\n");
  assert.equal(lines[1], "codemaster profile:");
  assert.ok(lines.includes("Tournament candidates (1):"), reason);
  assert.ok(lines.includes("src/math.ts:1 scoreValues complexity=6 lines=9"), reason);
  assert.ok(lines.includes("Libraries:"), reason);
  assert.ok(lines.includes("add alpha 1.2.0 readme=- homepage=-"), reason);
  assert.ok(!reason.includes("Findings ("), reason);
});

test("session start prints three lines and points to the library skill when it exists", async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "codemaster-hook-"));
  try {
    mkdirSync(join(projectRoot, "src/user"), { recursive: true });
    writeFileSync(join(projectRoot, "src/user/user.interfaces.ts"), "export interface UserThing { id: string }\n");
    const context = {
      argumentsList: ["hook-session-start"],
      projectRoot,
      config: CONFIG_DEFAULTS,
      configWarnings: [],
      input: "{}",
      pluginRoot: projectRoot,
    };
    const without = await captureOutput(() => runCommand(context));
    const lines = without.output.trim().split("\n");
    assert.equal(lines.length, 3);
    assert.equal(lines[0], "codemaster: layout=modular, sourceRoot=src");
    assert.equal(lines[1], "Before a task, check whether the framework or an installed library already does it.");
    assert.equal(lines[2], "Follow the codemaster skill rules while coding.");
    mkdirSync(join(projectRoot, ".claude/skills/codemaster-libraries"), { recursive: true });
    writeFileSync(join(projectRoot, ".claude/skills/codemaster-libraries/SKILL.md"), "---\nname: codemaster-libraries\n---\n");
    const withIndex = await captureOutput(() => runCommand(context));
    assert.equal(
      withIndex.output.trim().split("\n")[1],
      "Before a task, check whether the framework or an installed library already does it; see the codemaster-libraries skill.",
    );
    assert.equal(withIndex.status, 0);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("session start is silent when the hook is switched off", async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "codemaster-hook-"));
  try {
    const context = {
      argumentsList: ["hook-session-start"],
      projectRoot,
      config: { ...CONFIG_DEFAULTS, hook: false },
      configWarnings: [],
      input: "{}",
      pluginRoot: projectRoot,
    };
    const { status, output } = await captureOutput(() => runCommand(context));
    assert.equal(status, 0);
    assert.equal(output, "");
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
