# codemaster — implementation plan

**Goal:** a Claude Code plugin `codemaster` 0.1.0 in this repository: the skills `codemaster` and `codemaster-audit`, a `Stop` hook and a `SessionStart` hook, and the CLI `bin/codemaster.ts` with the subcommands `check`, `conventions`, `tournament`, `libraries`, `install`, `hook-stop` and `hook-session-start`. Together they enforce the user's code-organisation rules, adapt to each project's own conventions, and pass their own checks.
**Spec:** docs/sdd/specs/2026-11-27-codemaster.md
**Verification:** `npm test` exits 0 and its summary prints `ℹ fail 0`; then `node bin/codemaster.ts check src bin` prints a last line that starts with `codemaster: 0 errors`.

Dryer: skipped. The repository holds no code yet, so there is nothing to compare.

## Context
The user has code-organisation rules for TypeScript: two folder layouts, no constants or interfaces in services, helpers or utils, tests that mirror the code, full names, at most 5 parameters, low nesting, destructuring, and KISS. Today nothing enforces them. The model for this plugin is unclebob's ub-mode: a skill holds the principles, and deterministic scripts say what to fix. Here a `Stop` hook runs the scripts on the branch's changed files and hands the findings to the `codemaster` skill. The project's own conventions always win over the plugin's defaults.

## Global constraints
- Node ≥ 22.18 runs `.ts` natively. Use only erasable TypeScript syntax: no `enum`, no `namespace`, no parameter properties, no decorators. Every relative import carries its `.ts` extension. No build step and no `tsconfig` emit.
- Runtime dependencies are only `@ast-grep/cli@0.51.3` and `@ast-grep/napi@0.51.3`. They are installed into `${CODEMASTER_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/codemaster}` and never into the repository. `package.json` has no `dependencies` and no `devDependencies`.
- The plugin follows its own rules, with the layered layout:
  - `src/modules`, `src/consts`, `src/interfaces`, `src/helpers/{infrastructure,external,logic}` and `src/utils`, with tests in `tests/` that mirror `src/`;
  - constants live only in `src/consts/<entity>.ts` and are named `<ENTITY>_…` in UPPER_SNAKE;
  - interfaces and types live only in `src/interfaces/<entity>.ts` and are named `<Entity>…`;
  - no abbreviations from `ABBREVIATIONS_WORDS` (the allowlist applies);
  - at most 5 parameters, at most 3 levels of block nesting, at most 2 levels of callback nesting;
  - top-level functions only in modules, helpers, utils, tests, and as `main` in `bin/*.ts`.
- No comments in code, except a one-line note for a protocol quirk (for example, the Claude Code hook JSON field names).
- The hooks never break a session: every path of `hook-stop` and `hook-session-start` exits 0.
- `.claude-plugin/plugin.json`, `skills/codemaster/SKILL.md` and `skills/codemaster-audit/SKILL.md` carry `version` `0.1.0`.
- README is in English.
- End state, checked last: `git status --porcelain` is empty, the tree contains no `node_modules/` (`git ls-files | grep -c node_modules` prints `0`), and `.pasadena/` is committed only on this branch.
- Environment limits: nproc 24; memory 31201 MB total; cgroup memory.max not found; timeout not found.

Constraint check: 9 constraints. The end state is covered by Task 0: `end-state: git tree clean and free of node_modules` and `manifest: versions are 0.1.0`.

## Review Focus
- An ESLint config that throws on `--print-config` (missing plugin package). Expected: `conventions` skips the ESLint step with one `warning` line and still writes the profile. Owner: Task 11.
- A changed file that ast-grep cannot parse (a syntax error mid-edit). Expected: one `warning parse <file>:1 could not parse`, the other files are still checked, and the exit code ignores it. Owner: Task 10.
- A branch where a changed file was deleted. Expected: it is not in the changed list (only existing files are kept) and the hook does not crash. Owner: Task 2.
- A tournament variant that hangs (an infinite loop). Expected: the runner child is killed after 20 s and the variant fails with `timeout`. Owner: Task 13.
- `.codemaster.json` that is not valid JSON. Expected: one `warning config .codemaster.json: invalid JSON`, the defaults are used, and the hook still exits 0. Owner: Task 2.

## Waves
| Wave | Tasks | Why together |
|---|---|---|
| 0 | 0 | alone — acceptance tests, red until the last wave |
| 1 | 1 | alone — every later task imports its interfaces and consts |
| 2 | 2, 3, 4, 6, 15 | disjoint: infrastructure + config + bin / ast-grep install / role logic / naming logic / plugin text and manifests |
| 3 | 5, 12 | disjoint: function metrics (needs the ast-grep loader from 3) / libraries module (needs the git and filesystem helpers from 2) |
| 4 | 7, 8, 9, 13 | disjoint: declaration rules / ast-grep YAML rules / project rules / tournament (all need the metrics from 5) |
| 5 | 10, 11 | disjoint: the check module / the conventions module |
| 6 | 14 | alone — the hook calls check, conventions, tournament and libraries |
| 7 | 16 | alone — self-check fixes can touch any `src/` file |

Serialised on purpose:
- Task 14 waits for 10, 11, 12 and 13 because it imports all four.
- Task 16 runs alone because it may write any `src/` file to clear self-check findings.
- `bin/codemaster.ts` is written once, in Task 2. It dispatches through a map of module paths, so the later module tasks never touch it.

---

### Task 0: acceptance tests

**Writes:** `tests/acceptance/run-cli.ts`, `tests/acceptance/check.test.ts`, `tests/acceptance/roles.test.ts`, `tests/acceptance/conventions.test.ts`, `tests/acceptance/tournament.test.ts`, `tests/acceptance/libraries.test.ts`, `tests/acceptance/hook.test.ts`, `tests/acceptance/self-check.test.ts`, `tests/acceptance/manifest.test.ts`, `tests/acceptance/end-state.test.ts`, and everything under `tests/fixtures/`
**Executor:** claude
**Covers:** every bullet of spec §6 Verification: each rule in 3.4; file role; constant versus object; `auto` layout; tournament; libraries; `Stop` hook; `SessionStart` hook; `check --all`; project profile; project ESLint; rule settings; the self-check `codemaster: 0 errors`; version `0.1.0`; and last, «`git status` чистий, у дереві немає `node_modules/`».

Conventions for every acceptance test:
- `node:test` with `node:assert/strict`.
- Each test copies the fixture it uses into `fs.mkdtempSync(join(os.tmpdir(), "codemaster-"))`. The test is never run inside the fixture itself.
- `before()` in each file calls `runCli(["install"])` once, so ast-grep exists in the default data dir.

- [x] **Step 1: write `tests/acceptance/run-cli.ts`.** It holds three functions:
  - `export function runCli(argumentsList: string[], options: { cwd?: string; input?: string; environment?: NodeJS.ProcessEnv } = {}): { status: number; stdout: string; stderr: string }` uses `spawnSync(process.execPath, [join(PLUGIN_ROOT, "bin/codemaster.ts"), ...argumentsList], { cwd, input, env: { ...process.env, ...environment }, encoding: "utf8" })`, where `PLUGIN_ROOT = resolve(import.meta.dirname, "../..")`.
  - `export function copyFixture(name: string): string` copies `tests/fixtures/<name>` into a temp dir and returns the path.
  - `export function initRepository(directory: string): void` runs `git init -q -b main`, `git -c user.email=t@t -c user.name=t commit -q --allow-empty -m base`, then `git checkout -q -b work`.

- [x] **Step 2: write the fixtures.**
  - **`tests/fixtures/modular/src/`** (layout detected as `modular`):
    - `user/user.service.ts`: line 1 `export const USER_LIMIT = 5;` → `layout-forbidden-declaration`; line 2 `export const userService = { create() { return 1; } };` → clean; line 3 `export function createUser(first: string, second: string, third: string, fourth: string, fifth: string, sixth: string) { return first; }` → `max-params`; line 4 `const cfg = 1;` → `name-abbreviation` and `layout-forbidden-declaration`.
    - `user/user.service.test.ts`: an empty test, so `test-mirror` is satisfied.
    - `user/user.interfaces.ts`: line 1 `export interface Profile { name: string }` → `name-entity-prefix`; line 2 `export interface UserAccount { name: string }` → clean.
    - `user/user.consts.ts`: line 1 `export const MAX_AGE = 9;` → `name-entity-prefix`; line 2 `export const USER_MAX_AGE = 9;` → clean.
    - `user/user.helpers.ts`: line 1 `export class Helper {}` → `helpers-only-functions`; then a function `export function formatName(name: string) { const length = name.length; return length; }` whose `const length = name.length` line → `prefer-destructuring`.
    - `order/order.service.ts` holds a function with an `if` inside `for` inside `while` inside `if` (block depth 4) → `max-nesting`. It has no `order.service.test.ts`, so the file → `test-mirror` (error).
    - `report.ts` (a single-file module directly in `src`): `export const REPORT_LIMIT = 3; export interface ReportRow { id: string } export function buildReport() { return REPORT_LIMIT; }` → no `layout-forbidden-declaration`. Its `report.test.ts` is present.
    - `scripts/run.ts`: `export function runAll() {}` → `global-function`.
    - `old/legacy.ts`, which the hook test does not touch: `export function legacyThing(a: number, b: number, c: number, d: number, e: number, f: number) { return a; }`. It is used only by `check --all`.
  - **`tests/fixtures/layered/`**:
    - `src/modules/user.ts`: `export interface UserThing { id: string }` → allowed, because it is a single-file module.
    - `src/modules/order/order.ts`: `export interface OrderThing { id: string }` → `layout-forbidden-declaration`.
    - `src/consts/user.ts`: `export const USER_NAME = "x";` → clean.
    - `src/consts/global.ts`: `export const TIMEOUT = 5;` → clean.
    - `src/helpers/fetch-user.ts`: `import pg from "pg"; export async function loadUser() { await fetch("https://x"); return pg; }` → `helpers-mixed-kind`.
    - `src/utils/format.ts`: `export function formatValue(value: string) { return value; }`, with no mirror test → `test-mirror` (warning).
    - `tests/modules/user.test.ts` and `tests/modules/order/order.test.ts` exist.
    - `package.json`: `{"dependencies":{"axios":"1.0.0"}}` → `simple-package`.
  - **`tests/fixtures/off/src/components/button.ts`** and **`tests/fixtures/off/src/pages/home.ts`**: no role folders. `home.ts` holds a function with 6 parameters → `max-params`, and no layout rule fires.
  - **`tests/fixtures/conventions/`**:
    - `src/services/user.ts` has `export interface Leak { id: string }` on line 1.
    - `src/types/user.ts` holds 2 interfaces, `src/constants/user.ts` holds 8 data constants (6 camelCase `userLimit…`, 2 UPPER_SNAKE), and `__tests__/services/user.spec.ts` exists.
    - Variant fixture `conventions-weak/`: the same, but with 5 constants, 3 of them camelCase.
  - **`tests/fixtures/eslint/`**:
    - `node_modules/.bin/eslint` is an executable `#!/bin/sh` script that prints `{"rules":{"max-params":["error",3],"prefer-destructuring":"off"}}` when it is called with `--print-config`.
    - `src/modules/user.ts` holds a function with 4 parameters and `const name = user.name`.
  - **`tests/fixtures/libraries/`**:
    - `package.json` declares `dependencies` `{"alpha":"^1.0.0","beta":"^2.0.0","@types/node":"^20"}` and `devDependencies` `{"gamma":"^1.0.0"}`.
    - `node_modules/alpha/package.json` is `{"name":"alpha","version":"1.2.0","homepage":"https://alpha.dev"}`, with a `node_modules/alpha/README.md`.
    - `node_modules/beta/package.json` is `{"name":"beta","version":"2.1.0"}`, and `node_modules/gamma/package.json` is `{"name":"gamma","version":"1.0.0"}`.
    - `.claude/skills/codemaster-libraries/beta.md` has frontmatter `name: beta` and `version: 1.0.0` → `stale beta 1.0.0 -> 2.1.0`.
    - `.claude/skills/codemaster-libraries/zeta.md` has `name: zeta` and `version: 1.0.0` → `remove zeta`.
    - Expected output: `add alpha 1.2.0 readme=node_modules/alpha/README.md homepage=https://alpha.dev`.
  - **`tests/fixtures/libraries-many/package.json`**: 7 dependencies `p1`…`p7`, each with `node_modules/pN/package.json` version `1.0.0` → 5 `add` lines, then `… and 2 more`.
  - **`tests/fixtures/tournament/good/`**:
    - `first.ts`, `readable.ts` and `optimized.ts` each export `sumList(values: number[]): number`. `optimized.ts` returns the sum + 1, so it is wrong.
    - `cases.ts` exports `cases = [{ input: [[1, 2, 3]], expected: 6 }, { input: [[]], expected: 0 }]`.
    - `target.json` is `{"file":"src/math.ts","functionName":"sumList"}`.
  - **`tests/fixtures/tournament/no-bench/`**: the same, but `optimized` is correct and `cases.ts` also exports `benchmark = false`.
  - **`tests/fixtures/tournament/all-bad/`**: all three variants return `-1`.
  - **`tests/fixtures/candidates/src/`**:
    - `math.ts` holds `export function scoreValues(values: number[])` with complexity ≥ 5 (if, for, if, &&, ||).
    - `widget.tsx` holds a component with complexity ≥ 5.
    - `counter.ts` holds a class method `Counter.bump` that uses `this` and has complexity ≥ 5.

- [x] **Step 3: write the test files.**
  - **`check.test.ts`**:
    - `check --json src` on modular returns exactly these `{ruleId, file, line}` triples, sorted by file and then line:
      - `layout-forbidden-declaration src/user/user.service.ts:1`
      - `max-params src/user/user.service.ts:3`
      - `layout-forbidden-declaration src/user/user.service.ts:4`
      - `name-abbreviation src/user/user.service.ts:4`
      - `name-entity-prefix src/user/user.interfaces.ts:1`
      - `name-entity-prefix src/user/user.consts.ts:1`
      - `helpers-only-functions src/user/user.helpers.ts:1`
      - `prefer-destructuring src/user/user.helpers.ts:<line of const length>`
      - `max-nesting src/order/order.service.ts:<line of the 4th block>`
      - `test-mirror src/order/order.service.ts:1`
      - `global-function src/scripts/run.ts:1`
      - `max-params src/old/legacy.ts:1`
    - Exit status 1. The last line of the plain output matches `/^codemaster: \d+ errors, \d+ warnings in \d+ files$/`.
    - The layered test expects `layout-forbidden-declaration` on `src/modules/order/order.ts:1`, `helpers-mixed-kind` on `src/helpers/fetch-user.ts`, `test-mirror` with severity `warning` on `src/utils/format.ts`, and `simple-package` on `package.json`. It also checks that `src/modules/user.ts` has no finding.
    - The `off` test expects only `max-params`.
    - The `--all` test runs `initRepository`, commits all files, changes only `src/user/user.service.ts`, and runs `check --all --json`: the findings include `src/old/legacy.ts`. Plain `check --json` (with no paths) does not include it.
    - The constant-versus-object test passes when `const router = Router()` and `const cache = new Map()` added to `src/user/user.service.ts` produce no `layout-forbidden-declaration`, while `const USER_ROLES = ["a"] as const` does.
  - **`roles.test.ts`**: imports `resolveFileRole` from `src/helpers/logic/file-role.ts` (see the Task 4 interface) and asserts this table with the default roles:
    - modular: `src/user/user.interfaces.ts`→interfaces/user, `src/user/types.ts`→interfaces/user, `src/user/user.service.ts`→module/user, `src/report.ts`→single-file-module, `src/global/consts.ts`→consts with `global: true`, `src/utils/x.ts`→util, `scripts/a.ts`→other;
    - layered: `src/modules/user.ts`→single-file-module/user, `src/modules/order/order.ts`→module/order, `src/consts/global.ts`→consts with `global: true`, `src/helpers/a.ts`→helper, `tests/modules/user.test.ts`→test;
    - `bin/codemaster.ts` with entrypoints `["bin/*.ts"]`→entrypoint.
    - The test also asserts `detectLayout`: layered fixture→`layered`, modular→`modular`, off→`off`.
  - **`conventions.test.ts`**:
    - On `conventions`, `conventions --refresh` writes `.codemaster.json` with `roles.module` containing `services`, `roles.interfaces` = `["types"]`, `roles.consts` = `["constants"]`, `testsLocation` = `"__tests__"`, `testSuffix` = `"spec"` and `constantCase` = `"camel"`, and `sources.constantCase` starts with `dominant`.
    - Then `check --json src` has `layout-forbidden-declaration` on `src/services/user.ts:1`, and its message contains `types`.
    - On `conventions-weak`, `constantCase` = `"upper-snake"` and `sources.constantCase` = `"default"`.
    - A user field survives `--refresh`: the test writes `{"sourceRoot":"src","constantCase":"upper-snake"}` without `sources` and runs `--refresh`; `constantCase` stays `upper-snake`.
    - On `eslint`, `rules["max-params"].max` = 3 and `rules["prefer-destructuring"]` = `"off"`. `check --json` then reports `max-params` on the 4-parameter function and no `prefer-destructuring`.
    - With `.codemaster.json` `{"rules":{"max-params":"off"}}` on `off`, there is no `max-params` finding.
    - With `{"rules":{"name-word-count":{"max":4}}}` and a constant `userAccountProfileName`, there is no `name-word-count` finding.
  - **`tournament.test.ts`**:
    - `tournament <good>`: stdout contains `winner: readable` or `winner: first`; `result.json` `variants` has `optimized` with `passed: false`; the winner's `metrics` has the numbers `bytecodePerToken` and `desugared`; status 0.
    - `<no-bench>`: every variant's `metrics.speed` is `null`, and the result is still a winner.
    - `<all-bad>`: stdout contains `winner: none`, status 1.
    - `tournament --skip src/math.ts#sumList --reason "closure"` inside an initialised repo: `$(git rev-parse --git-path codemaster)/tournament-done.json` contains `{"key":"src/math.ts#sumList","skipped":true,"reason":"closure"}`.
    - `tournament --candidates` on `candidates`, after `initRepository` and with every file new: lists `src/math.ts:<line> scoreValues complexity=<n> lines=<n>`, and does not list `widget` or `Counter.bump`.
  - **`libraries.test.ts`**:
    - `libraries` on `libraries`: lines `add alpha 1.2.0 readme=node_modules/alpha/README.md homepage=https://alpha.dev`, `remove zeta` and `stale beta 1.0.0 -> 2.1.0`; no `gamma` and no `@types/node`.
    - With `{"libraryDigestDev":true}`, `add gamma 1.0.0` appears.
    - `libraries --prune` deletes `zeta.md`; `SKILL.md` exists with `name: codemaster-libraries` and a line containing `beta`.
    - `libraries-many` gives exactly 5 `add` lines and a last line `… and 2 more`.
    - `{"libraryDigest":false}` gives stdout `libraries: disabled`.
  - **`hook.test.ts`**: each case copies `modular`, runs `initRepository`, commits, then appends `export function sixParameters(a: number, b: number, c: number, d: number, e: number, f: number) { return a; }` to `src/user/user.service.ts`. It writes `.codemaster.json` `{"libraryDigest":false}` first, so the profile block is not the only reason.
    - `hook-stop` with input `{"cwd":"<dir>","stop_hook_active":false}`: stdout parses to `decision` = `block`, `reason` starts with `Run the codemaster skill (codemaster:codemaster) for this branch.` and contains `max-params`; status 0.
    - Run again with the same state: stdout is empty, status 0.
    - A new change with `stop_hook_active: true`: stdout is empty, and a third run without the flag is also empty, because the hash was recorded.
    - Only `package.json` changed (add `"axios"`): stdout parses to `block`.
    - `.codemaster.json` `{"hook":false}`: empty. `.codemaster.local.json` `{"hook":false}` alone: empty.
    - Outside git (a plain temp dir): empty, status 0.
    - Without `.codemaster.json`: `reason` contains `codemaster profile` and `layout`, and `.codemaster.json` now exists.
    - Install failure: `CODEMASTER_DATA_DIR=<empty temp>` and `npm_config_registry=http://127.0.0.1:9` give status 0 and stderr starting with `codemaster:`.
    - `hook-session-start` in the modular repo: stdout contains `codemaster: layout=modular`.
  - **`self-check.test.ts`**: `check src bin` in the plugin root: the last line starts with `codemaster: 0 errors`.
  - **`manifest.test.ts`**:
    - `.claude-plugin/plugin.json` `version` is `0.1.0`, and `hooks` is `./hooks/hooks.json`.
    - `hooks/hooks.json` has `Stop` and `SessionStart` commands that contain `bin/codemaster.ts hook-stop` and `hook-session-start`.
    - Both SKILL.md frontmatters have `version: 0.1.0`, with names `codemaster` and `codemaster-audit`.
    - `README.md` exists and contains `## Install`.
  - **`end-state.test.ts`**: `git ls-files` has no `node_modules`, and `package.json` has neither `dependencies` nor `devDependencies`. `git status --porcelain` is checked only when `process.env.CODEMASTER_END_STATE === "1"`; `wolowitz` sets that in Finish, after the last commit.

- [x] **Step 4: run them, watch them fail.** `node --test "tests/acceptance/*.test.ts"` should print `ℹ fail` > 0, with failures that `bin/codemaster.ts` does not exist. This means the behaviour is missing.

---

### Task 1: data shapes — interfaces, consts, utils, package.json

**Writes:** `package.json`, `.gitignore`, `src/interfaces/config.ts`, `src/interfaces/finding.ts`, `src/interfaces/role.ts`, `src/interfaces/command.ts`, `src/interfaces/tournament.ts`, `src/interfaces/library.ts`, `src/interfaces/hook.ts`, `src/consts/config.ts`, `src/consts/abbreviations.ts`, `src/consts/roles.ts`, `src/consts/check.ts`, `src/consts/install.ts`, `src/consts/tournament.ts`, `src/consts/conventions.ts`, `src/consts/hook.ts`, `src/utils/words.ts`, `src/utils/glob.ts`, `src/utils/hash.ts`, `tests/utils/words.test.ts`, `tests/utils/glob.test.ts`, `tests/utils/hash.test.ts`
**Depends on:** Task 0
**Executor:** claude
**Complexity:** complex (every later task consumes these shapes)
**Satisfies:** none directly (foundation)
**Interfaces — Produces (exact):**
```ts
// src/interfaces/config.ts
export type ConfigLayout = "auto" | "modular" | "layered" | "off";
export type ConfigSeverity = "error" | "warning";
export type ConfigRuleSetting = "off" | ConfigSeverity | { severity?: ConfigSeverity; max?: number; reason?: string };
export interface ConfigRoles { module: string[]; interfaces: string[]; consts: string[]; helper: string[]; util: string[] }
export interface ConfigWeights { readability: number; length: number; bytecode: number; speed: number; closeness: number }
export interface ConfigTournament { minComplexity: number; minLines: number; weights: ConfigWeights }
export interface ConfigProject {
  hook: boolean; layout: ConfigLayout; sourceRoot: string; entrypoints: string[];
  singleFileMaxLines: number; coverageCommand: string | null;
  abbreviationAllowlist: string[]; simplePackages: string[]; infrastructurePackages: string[];
  tournament: ConfigTournament; libraryDigest: boolean; libraryDigestDev: boolean; libraryDigestPerRun: number;
  roles: ConfigRoles; testsLocation: string; testSuffix: "test" | "spec";
  constantCase: "upper-snake" | "camel"; interfacePrefix: "" | "I"; entityPrefix: boolean;
  rules: Record<string, ConfigRuleSetting>; sources: Record<string, string>;
}
// src/interfaces/finding.ts
export interface FindingItem { severity: "error" | "warning"; ruleId: string; file: string; line: number; message: string; reason?: string }
export interface FindingSummary { errors: number; warnings: number; files: number }
// src/interfaces/role.ts
export type RoleName = "module" | "single-file-module" | "interfaces" | "consts" | "helper" | "util" | "test" | "entrypoint" | "other";
export type RoleLayout = "modular" | "layered" | "off";
export interface RoleFile { path: string; role: RoleName; entity: string | null; global: boolean }
// src/interfaces/command.ts
export interface CommandContext { argumentsList: string[]; projectRoot: string; config: ConfigProject; configWarnings: string[]; input: string; pluginRoot: string }
export type CommandHandler = (context: CommandContext) => Promise<number>;
// src/interfaces/tournament.ts
export type TournamentVariantName = "first" | "readable" | "optimized";
export interface TournamentMetrics { readability: number; length: number; bytecode: number; speed: number | null; bytecodePerToken: number; desugared: number }
export interface TournamentVariantResult { variant: TournamentVariantName; passed: boolean; failure: string | null; metrics: TournamentMetrics | null; score: number | null }
export interface TournamentResult { target: { file: string; functionName: string }; variants: TournamentVariantResult[]; winner: TournamentVariantName | "none" }
export interface TournamentCandidate { file: string; line: number; functionName: string; complexity: number; lines: number; bodyHash: string }
export interface TournamentDoneEntry { key: string; bodyHash: string | null; skipped: boolean; reason: string | null }
// src/interfaces/library.ts
export interface LibraryEntry { name: string; version: string; readme: string | null; homepage: string | null }
export interface LibraryStale { name: string; previous: string; current: string }
export interface LibraryDiff { add: LibraryEntry[]; remove: string[]; stale: LibraryStale[]; missing: string[]; more: number }
// src/interfaces/hook.ts
export interface HookStopInput { cwd?: string; stop_hook_active?: boolean }
```
These consts (exact names and values):
- `CONFIG_DEFAULTS: ConfigProject`. Its values come from spec 3.2:
  - `hook: true`, `layout: "auto"`, `sourceRoot: "src"`, `entrypoints: ["src/index.ts", "src/main.ts", "bin/*.ts"]`;
  - `singleFileMaxLines: 150`, `coverageCommand: null`;
  - `abbreviationAllowlist`, `simplePackages` and `infrastructurePackages`: the exact spec lists;
  - `tournament: { minComplexity: 5, minLines: 10, weights: all 0.2 }`;
  - `libraryDigest: true`, `libraryDigestDev: false`, `libraryDigestPerRun: 5`;
  - `roles`: `ROLES_ALIASES`;
  - `testsLocation: ""` (empty means: derive `colocated` for modular, `tests` for layered);
  - `testSuffix: "test"`, `constantCase: "upper-snake"`, `interfacePrefix: ""`, `entityPrefix: true`, `rules: {}`, `sources: {}`.
- `CONFIG_FILE_NAME = ".codemaster.json"`, `CONFIG_LOCAL_FILE_NAME = ".codemaster.local.json"`.
- `ABBREVIATIONS_WORDS`: the exact list from spec 3.4, without `util`/`utils`.
- `ROLES_ALIASES: ConfigRoles`:
  - module `["modules","services","controllers","features","domains","handlers"]`;
  - interfaces `["interfaces","types","typings","contracts","dto"]`;
  - consts `["consts","constants","enums"]`;
  - helper `["helpers"]`;
  - util `["utils","util","shared","common","lib"]`.
- `ROLES_FILE_NAMES` maps file names to roles: `interfaces/interface/types/type`→interfaces, `consts/const/constants/constant`→consts, `helpers/helper`→helper, `utils/util`→util.
- `ROLES_GLOBAL_NAMES = ["global","globals","shared","index"]`.
- `CHECK_SOURCE_EXTENSIONS = [".ts",".tsx",".mts",".cts",".js",".jsx",".mjs",".cjs"]`.
- `CHECK_IGNORED_DIRECTORIES = ["node_modules","dist","build","coverage"]`.
- `CHECK_RULE_SEVERITY: Record<string, "error"|"warning">`, one entry for every rule-id of spec 3.4, plus `single-file-module-size: warning` and `max-call-nesting: warning`.
- `CHECK_LIMITS = { maxParameters: 5, maxNesting: 3, maxCallbackNesting: 2, maxCallNesting: 3, maxWords: 3 }`.
- `INSTALL_AST_GREP_VERSION = "0.51.3"`, `INSTALL_PACKAGES = ["@ast-grep/cli@0.51.3","@ast-grep/napi@0.51.3"]`.
- `TOURNAMENT_ITERATIONS = 10000`, `TOURNAMENT_RUNS = 5`, `TOURNAMENT_DEOPT_PENALTY = 50`, `TOURNAMENT_TIE_ORDER = ["readable","first","optimized"]`, `TOURNAMENT_TIMEOUT_MILLISECONDS = 20000`.
- `CONVENTIONS_DOMINANCE_SHARE = 0.6`, `CONVENTIONS_DOMINANCE_MINIMUM = 5`, `CONVENTIONS_SOURCE_ROOTS = ["src","app","server","lib"]`, `CONVENTIONS_TEST_FOLDERS = ["tests","test","__tests__"]`.
- `HOOK_REASON_HEADER = "Run the codemaster skill (codemaster:codemaster) for this branch."`, `HOOK_FINDINGS_LIMIT = 30`.

These utils:
- `src/utils/words.ts`: `splitWords(name: string): string[]` (camelCase, PascalCase, SNAKE_CASE, kebab; lower-cased; `HTTPServer`→`["http","server"]`); `toEntityCase(entity: string, style: "upper-snake"|"camel"|"pascal"): string` (`order-item`→`ORDER_ITEM`/`orderItem`/`OrderItem`).
- `src/utils/glob.ts`: `matchesGlob(path: string, pattern: string): boolean`, which wraps `node:path` `matchesGlob`.
- `src/utils/hash.ts`: `hashText(text: string): string`, the sha256 hex.

- [x] Step 1: write `tests/utils/*.test.ts` with these cases:
  - `splitWords("userMaxAge")`→`["user","max","age"]`, `splitWords("USER_MAX_AGE")`→`["user","max","age"]`, `splitWords("HTTPServer")`→`["http","server"]`;
  - `toEntityCase("order-item","upper-snake")`→`"ORDER_ITEM"`;
  - `matchesGlob("bin/a.ts","bin/*.ts")`→`true`;
  - `hashText("a")` has length 64.
- [x] Step 2: `node --test "tests/utils/*.test.ts"` → fails because the modules are missing.
- [x] Step 3: write every file listed in Writes.
  - `package.json`: `{"name":"codemaster","version":"0.1.0","private":true,"type":"module","engines":{"node":">=22.18"},"scripts":{"test":"node --test \"tests/acceptance/*.test.ts\" \"tests/modules/*.test.ts\" \"tests/helpers/**/*.test.ts\" \"tests/utils/*.test.ts\""}}`.
  - `.gitignore`: `node_modules/`, `.metrics/`, `coverage/`, `.codemaster.local.json`.
- [x] Step 4: `node --test "tests/utils/*.test.ts"` → `ℹ fail 0`.

---

### Task 2: infrastructure helpers, config loading, CLI dispatcher

**Writes:** `src/helpers/infrastructure/git.ts`, `src/helpers/infrastructure/filesystem.ts`, `src/helpers/infrastructure/process.ts`, `src/modules/config.ts`, `bin/codemaster.ts`, `tests/helpers/infrastructure/git.test.ts`, `tests/helpers/infrastructure/filesystem.test.ts`, `tests/helpers/infrastructure/process.test.ts`, `tests/modules/config.test.ts`
**Depends on:** Task 1
**Executor:** claude
**Complexity:** complex
**Satisfies:** `hook.test.ts` outside git (together with Task 14); review focus «invalid JSON config» and «deleted changed file»
**Interfaces — Produces:**
- `git.ts`:
  - `isRepository(directory: string): boolean`;
  - `findBaseBranch(directory: string): string | null`: `git symbolic-ref --short refs/remotes/origin/HEAD`, else the first existing of `main`/`master`/`dev`, excluding the current branch when it is the same; `null` when none applies;
  - `findMergeBase(directory: string): string | null`;
  - `listChangedFiles(directory: string): string[]`: per spec 3.7, existing files only, relative paths, sorted; on a base branch with no merge-base, the uncommitted and untracked files only;
  - `listAllSourceFiles(directory: string): string[]`: `git ls-files` plus untracked, with the same filters;
  - `listChangedLineRanges(directory: string, file: string): Array<{ start: number; end: number }> | "new"`: from `git diff -U0 <merge-base> -- <file>`;
  - `isPackageManifestChanged(directory: string): boolean`;
  - `resolveStateDirectory(directory: string): string`: an absolute `git rev-parse --git-path codemaster`, created with `mkdir -p`.
- `filesystem.ts`:
  - `readTextFile(path: string): string | null`;
  - `writeTextFile(path: string, text: string): void` (makes parent directories);
  - `readJsonFile(path: string): { value: unknown; error: string | null }`;
  - `listDirectoryNames(path: string): string[]`;
  - `removeFile(path: string): void`.
- `process.ts`: `runProcess(command: string, argumentsList: string[], options: { cwd: string; input?: string; timeoutMilliseconds?: number; environment?: NodeJS.ProcessEnv }): { status: number | null; stdout: string; stderr: string; timedOut: boolean }`, built on `spawnSync` with `encoding: "utf8"` and `maxBuffer: 64 MiB`.
- `config.ts`:
  - `loadConfig(projectRoot: string): { config: ConfigProject; warnings: string[]; exists: boolean }`. It deep-merges `CONFIG_DEFAULTS` ← `.codemaster.json` ← `.codemaster.local.json`. A field of the wrong type gives `warning config <field>: expected <type>` and the default. Invalid JSON gives `warning config <file>: invalid JSON`. Unknown fields are ignored. `exists` is true when `.codemaster.json` exists. When `testsLocation` is `""`, it stays `""`; `resolveTestsLocation` resolves it.
  - `resolveTestsLocation(config: ConfigProject, layout: RoleLayout): string`: returns `config.testsLocation` when it is non-empty, else `colocated` for modular and off, `tests` for layered.
  - `resolveRuleSetting(config: ConfigProject, ruleId: string): { enabled: boolean; severity: "error"|"warning"; max: number | null; reason: string | null }`.
- `bin/codemaster.ts`: the only top-level function is `async function main()`.
  - Node version guard: `process.versions.node` below 22.18 → stdout `codemaster: requires Node >= 22.18 (found <v>)`, exit 0.
  - It reads `process.argv[2]` as the subcommand and loads the handler with `await import(new URL(COMMAND_MODULES[name], import.meta.url))`. Each module exports `runCommand: CommandHandler`.
  - `COMMAND_MODULES` is a const inside `main` (the file is an entrypoint, so no top-level const): `check`→`../src/modules/check.ts`, `conventions`→`../src/modules/conventions.ts`, `tournament`→`../src/modules/tournament.ts`, `libraries`→`../src/modules/libraries.ts`, `install`→`../src/modules/install.ts`, `hook-stop` and `hook-session-start`→`../src/modules/hook.ts`. For the hook module, `argumentsList[0]` is the subcommand name.
  - It reads stdin fully only for `hook-*` subcommands. `projectRoot` is `JSON.parse(input).cwd ?? process.cwd()` for hooks and `process.cwd()` otherwise. `pluginRoot` is `resolve(import.meta.dirname, "..")`.
  - An unknown subcommand prints the usage to stderr and exits 2.
  - For `hook-*`, any thrown error goes to stderr as `codemaster: <message>` and the exit is 0.

- [x] Step 1: write the tests.
  - git: on a temp repo, a new file and a modified committed file are listed, a deleted file is not, and `node_modules/x.ts` and `a.d.ts` are excluded.
  - config: a local override wins; `{"hook":"yes"}` gives a warning and `hook: true`; invalid JSON gives a warning.
  - process: `runProcess("node", ["-e","process.exit(3)"])` gives status 3; a timeout of 100 ms on `setTimeout(()=>{},5000)` gives `timedOut: true`.
- [x] Step 2: `node --test "tests/helpers/infrastructure/*.test.ts" tests/modules/config.test.ts` → fails.
- [x] Step 3: implement.
- [x] Step 4: the same command → `ℹ fail 0`.

---

### Task 3: install module and ast-grep loader

**Writes:** `src/modules/install.ts`, `src/helpers/infrastructure/ast-grep.ts`, `tests/modules/install.test.ts`, `tests/helpers/infrastructure/ast-grep.test.ts`
**Depends on:** Task 1
**Executor:** claude
**Complexity:** routine
**Satisfies:** `hook.test.ts` install failure (together with Task 14)
**Interfaces — Produces:**
- `install.ts`:
  - `resolveDataDirectory(): string` = `CODEMASTER_DATA_DIR`, else `$XDG_DATA_HOME/codemaster`, else `~/.local/share/codemaster`;
  - `isInstalled(): boolean`: `<data>/node_modules/@ast-grep/napi/package.json` version equals `INSTALL_AST_GREP_VERSION`, and the same for `@ast-grep/cli`;
  - `ensureInstalled(): { ok: boolean; message: string | null }`: when the packages are missing, it runs `npm install --prefix <data> --no-save --no-audit --no-fund ...INSTALL_PACKAGES` with a timeout of 180000 ms. On success the message is `codemaster: installed ast-grep 0.51.3 into <data>`. On failure it is `codemaster: install failed (<first stderr line>)`.
  - `runCommand`: calls `ensureInstalled` and prints the message to stderr; the exit code is 0 either way.
- `ast-grep.ts`:
  - `loadAstGrep(): Promise<typeof import("@ast-grep/napi")>`: `createRequire(join(resolveDataDirectory(), "node_modules", "noop.js"))("@ast-grep/napi")`;
  - `resolveAstGrepBinary(): string`: `<data>/node_modules/.bin/ast-grep`;
  - `parseSource(path: string, text: string): Promise<SgRoot>`: picks `Lang.Tsx` for `.tsx`/`.jsx`, `Lang.TypeScript` for `.ts/.mts/.cts`, and `Lang.JavaScript` for `.js/.mjs/.cjs`. The type import uses `import type { SgRoot } from "@ast-grep/napi"`, written as an inline `type` alias in the function signature through `Awaited<ReturnType<...>>`, because types may not be declared outside `interfaces/`.

- [x] Step 1: tests.
  - `ensureInstalled` with `CODEMASTER_DATA_DIR=<temp>` and `npm_config_registry=http://127.0.0.1:9` → `ok: false`, and the message starts with `codemaster: install failed`.
  - With the default dir, after `ensureInstalled()`, `parseSource("a.ts","const value = 1").root().kind()` is `"program"`.
- [x] Step 2: `node --test tests/modules/install.test.ts tests/helpers/infrastructure/ast-grep.test.ts` → fails.
- [x] Step 3: implement.
- [x] Step 4: the same command → `ℹ fail 0`.

---

### Task 4: file roles and layout detection

**Writes:** `src/helpers/logic/file-role.ts`, `tests/helpers/logic/file-role.test.ts`
**Depends on:** Task 1
**Executor:** claude
**Complexity:** routine
**Satisfies:** `roles.test.ts` (all cases)
**Interfaces — Produces:**
- `resolveFileRole(path: string, options: { layout: RoleLayout; config: ConfigProject }): RoleFile`. This is exactly spec 3.3: roles come through `config.roles`, file names through `ROLES_FILE_NAMES`, and an optional `<entity>.` prefix is stripped before matching. Order: test (suffix `.test.`/`.spec.`, or the first segment in `CONVENTIONS_TEST_FOLDERS` or equal to `config.testsLocation`) → entrypoint (`config.entrypoints` globs) → outside `sourceRoot` → `other` → the layout rules.
  - Layered: when the first segment inside `sourceRoot` is an alias of role R and the path has only 2 segments (`modules/user.ts`), the role is `single-file-module` for R = module, and R otherwise. A file directly in `sourceRoot` → `single-file-module`.
  - Modular: a file directly in `sourceRoot` → `single-file-module`. The first segment that is in the util aliases → `util`. Otherwise the entity is the first segment, and the role comes from the file name or the nearest folder name (`user/interfaces/a.ts` → interfaces). Entity `global` or `shared` → `global: true`.
  - Off: every non-test, non-entrypoint file is `module` with entity `null`.
- `detectLayout(projectRoot: string, config: ConfigProject): RoleLayout`. An explicit `config.layout` wins unless it is `auto`. Otherwise, per spec 3.2: role folders of ≥ 2 distinct roles directly in `sourceRoot` → `layered`; else some subfolder of `sourceRoot` holding a file or folder whose name maps to interfaces/consts/helper → `modular`; else `off`.

- [x] Step 1: write the unit test with the same table as `roles.test.ts`, plus `src/user/interfaces/a.ts`→interfaces and `src/modules/user.ts` under modular→module/modules.
- [x] Step 2: `node --test tests/helpers/logic/file-role.test.ts` → fails.
- [x] Step 3: implement.
- [x] Step 4: the same command plus `node --test tests/acceptance/roles.test.ts` → both `ℹ fail 0`.

---

### Task 5: function metrics on the ast-grep tree

**Writes:** `src/helpers/logic/function-metrics.ts`, `tests/helpers/logic/function-metrics.test.ts`
**Depends on:** Task 3
**Executor:** claude
**Complexity:** complex
**Satisfies:** none directly (it is used by 7, 10 and 13)
**Interfaces — Produces** (all take an `SgNode` from `parseSource(...).root()`):
- `listFunctions(root): Array<{ node; name: string | null; line: number; endLine: number; parameterCount: number; usesThis: boolean; bodyText: string }>`:
  - kinds `function_declaration`, `function_expression`, `arrow_function`, `method_definition`, `generator_function_declaration`;
  - naming: a declaration uses its name; a method is `<Class>.<method>`, with the class found through the nearest ancestor `class_declaration`; an arrow or expression that is the value of a `variable_declarator` takes the declarator name; anything else is `null`;
  - `line` is 1-based;
  - `parameterCount` counts the named children of `formal_parameters`, without `this` parameters;
  - `usesThis` is true when the body contains a `this` node that is not inside a nested non-arrow function.
- `measureBlockNesting(functionNode): number`: the maximum depth of `if_statement`, `for_statement`, `for_in_statement`, `while_statement`, `do_statement`, `switch_statement`, `try_statement`, counted inside this function only (it stops at nested functions). An `else if` does not add depth.
- `measureCallbackNesting(functionNode): number`: the maximum depth of function literals that are direct children of `arguments`, nested in each other.
- `findThenInThen(root): number[]`: the lines of `.then(` calls inside a callback of another `.then(`.
- `measureCallNesting(root): Array<{ line: number; depth: number }>`: for each outermost `call_expression`, the depth of calls nested as arguments. `a(b(c(d())))` = 4.
- `measureCognitiveComplexity(functionNode): number`, SonarSource rules:
  - +1 for each `if`, `else if`, `else`, ternary, `switch`, `for`/`for…in`/`for…of`, `while`, `do`, `catch`, `break`/`continue` to a label, and each sequence of like boolean operators (`&&` runs, `||` runs, `??` runs);
  - + nesting for `if`, ternary, `switch`, loops and `catch` nested in those structures or in nested functions;
  - +1 for each recursion call to its own name.
- `countBodyLines(functionNode): number`: non-blank lines of the body text, without the braces.
- `countTokens(functionNode): number`: leaf nodes, excluding `comment`.
- `countDesugared(functionNode): number`: the count of `spread_element`, `rest_pattern`, `object_pattern`, `array_pattern`, `optional_chain` (`?.`), `??` binary operators, `yield_expression`, `await_expression`, the `async` keyword (once per function), nested functions that reference an identifier declared in the outer function, `try_statement`, and `template_substitution`.

- [x] Step 1: tests on inline sources:
  - `function sumList(values){let total=0;for(const value of values){if(value>0){total+=value}}return total}` → complexity 3 (for +1, if +2), block nesting 2;
  - `a(b(c(d())))` → call depth 4;
  - `p.then(x => q.then(y => y))` → one `findThenInThen` line;
  - `class Counter { bump(){ return this.value } }` → name `Counter.bump`, `usesThis` true;
  - `const add = (first, second) => first + second` → name `add`, parameterCount 2;
  - `function f({a}, ...rest){ return a?.b ?? `${rest}` }` → desugared ≥ 5.
- [x] Step 2: `node --test tests/helpers/logic/function-metrics.test.ts` → fails.
- [x] Step 3: implement.
- [x] Step 4: the same command → `ℹ fail 0`.

---

### Task 6: naming logic

**Writes:** `src/helpers/logic/naming.ts`, `tests/helpers/logic/naming.test.ts`
**Depends on:** Task 1
**Executor:** claude
**Complexity:** routine
**Satisfies:** none directly (it is used by 7)
**Interfaces — Produces:**
- `findAbbreviation(name: string, allowlist: string[]): string | null`: the first word of `splitWords(name)` that is in `ABBREVIATIONS_WORDS` and not in the allowlist. A single-letter name other than `_` returns that letter.
- `countNameWords(name: string, entityPrefix: string | null): number`: the word count after stripping the case-insensitive entity prefix.
- `checkEntityPrefix(name: string, options: { kind: "constant" | "type"; entity: string | null; constantCase: "upper-snake" | "camel"; interfacePrefix: "" | "I"; entityPrefix: boolean }): string | null`: returns `null` when the name is fine, otherwise the message `<name> should start with <expected>`. For example `USER_` for an upper-snake constant, `user` for a camel constant, `IUser` or `User` for a type, and the case shape only when the entity is `null`.

- [x] Step 1: tests:
  - `findAbbreviation("cfgValue",[])`→`"cfg"`, `findAbbreviation("userId",["id"])`→`null`;
  - `countNameWords("USER_MAX_AGE","user")`→2;
  - `checkEntityPrefix("MAX_AGE",{kind:"constant",entity:"user",constantCase:"upper-snake",interfacePrefix:"",entityPrefix:true})` → contains `USER_`;
  - `checkEntityPrefix("userLimit",{...,constantCase:"camel"})`→`null`;
  - `checkEntityPrefix("Profile",{kind:"type",entity:"user",...})` → contains `User`.
- [x] Step 2: `node --test tests/helpers/logic/naming.test.ts` → fails.
- [x] Step 3: implement.
- [x] Step 4: the same command → `ℹ fail 0`.

---

### Task 7: declaration rules

**Writes:** `src/helpers/logic/declaration-rules.ts`, `tests/helpers/logic/declaration-rules.test.ts`
**Depends on:** Tasks 4, 5, 6
**Executor:** claude
**Complexity:** complex
**Satisfies:** the `check.test.ts` modular and layered triples for `layout-forbidden-declaration`, `helpers-only-functions`, `single-file-module-size`, `global-function`, `helpers-mixed-kind`, `name-abbreviation`, `name-word-count`, `name-entity-prefix`, `max-params`, `max-nesting`; constant versus object (together with Task 10)
**Interfaces — Produces:**
- `isDataInitializer(valueNode): boolean`. Per spec 3.4, data is:
  - the kinds `string`, `number`, `true`, `false`, `null`, `regex`, and `template_string` without `template_substitution`;
  - `array` and `object` whose elements and pair values are all data (shorthand properties are not data);
  - `as_expression` with `const`, or `satisfies`, wrapping data;
  - `call_expression` of `Object.freeze` with a data argument;
  - `unary_expression` `-` on a number.
- `collectDeclarations(root): Array<{ kind: "constant" | "data-variable" | "interface" | "type" | "enum" | "class" | "function" | "object"; name: string; line: number; node }>`: the top-level declarations, unwrapping `export_statement`. `const` with a data initializer → `constant`; `let`/`var` with data → `data-variable`; `const` with an arrow or function expression → `function`; any other initializer → `object`.
- `checkDeclarations(input: { path: string; text: string; root; role: RoleFile; config: ConfigProject }): FindingItem[]`. It returns findings with the default severities from `CHECK_RULE_SEVERITY`; Task 10 applies overrides. The rules, per spec 3.4:
  - `layout-forbidden-declaration`: roles module/helper/util with kinds constant, data-variable, interface, type or enum. The message is `<kind> <name> belongs in <first alias of roles.consts or roles.interfaces>`, so it names the project's own folder.
  - `helpers-only-functions`: roles helper/util with class or object.
  - `single-file-module-size`: role single-file-module with constants, interfaces or types, and more than `singleFileMaxLines` non-blank lines.
  - `global-function`: top-level `function` declarations in roles `other` or `interfaces`/`consts`, and in role `entrypoint` when the name is not `main`. It also catches any role assigning a function to `globalThis.*`, `window.*` or `global.*`, and `declare global` blocks with function members.
  - `helpers-mixed-kind`: role helper importing from an `infrastructurePackages` entry and containing `fetch(` or `http.request`/`https.request`, or mixing functions with and without such calls.
  - `name-abbreviation`: every declared identifier — top-level declarations, function names, parameter identifiers, class and method names, and `variable_declarator` names in functions — through `findAbbreviation`.
  - `name-word-count`: more than `max` (default `CHECK_LIMITS.maxWords`) words.
  - `name-entity-prefix`: roles consts/interfaces, through `checkEntityPrefix`, with entity `null` when `role.global`.
  - `max-params`: `listFunctions` entries with `parameterCount` above `max` (default 5). Message: `function <name> has <n> parameters (max <m>)`.
  - `max-nesting`: functions with block nesting above `max` (default 3), or with callback nesting above 2, and every `findThenInThen` line.
  - `max-call-nesting`: calls with depth above `max` (default 3).
- Layout rules (`layout-forbidden-declaration`, `helpers-only-functions`, `single-file-module-size`, `helpers-mixed-kind`, `name-entity-prefix`) are skipped when the layout is `off`. Role `other` gets only the naming, `max-params`, `max-nesting` and `max-call-nesting` rules.

- [x] Step 1: tests:
  - each rule fires once on an inline source with the matching role and stays silent on a clean twin;
  - the `isDataInitializer` cases: `5`, `["a"] as const`, `Object.freeze({a:1})` → true; `Router()`, `new Map()`, `{ create() {} }` → false;
  - the `layout-forbidden-declaration` message contains `types` when `config.roles.interfaces = ["types"]`.
- [x] Step 2: `node --test tests/helpers/logic/declaration-rules.test.ts` → fails.
- [x] Step 3: implement.
- [x] Step 4: the same command → `ℹ fail 0`.

---

### Task 8: ast-grep YAML rules and scanner

**Writes:** `rules/typescript/prefer-destructuring.yml`, `rules/typescript/global-assignment.yml`, `src/helpers/infrastructure/ast-grep-scan.ts`, `tests/helpers/infrastructure/ast-grep-scan.test.ts`
**Depends on:** Task 3
**Executor:** claude
**Complexity:** routine
**Satisfies:** the `check.test.ts` triple for `prefer-destructuring` (together with Task 10)
**Interfaces — Produces:**
- `rules/typescript/prefer-destructuring.yml`: `id: prefer-destructuring`, `language: TypeScript`, `severity: warning`, `message: use destructuring`, with `rule.any` of patterns `const $NAME = $OBJECT.$NAME` and `const $NAME = $OBJECT["$NAME"]`.
- `global-assignment.yml`: `id: global-function`, `severity: error`, patterns `globalThis.$PROPERTY = $VALUE`, `window.$PROPERTY = $VALUE`, `global.$PROPERTY = $VALUE`.
- `scanWithRules(input: { pluginRoot: string; projectRoot: string; files: string[] }): FindingItem[]`: runs `<resolveAstGrepBinary()> scan --rule <file> --json=stream <files...>` once per YAML rule, in `projectRoot`. Each JSON line maps to `{ severity, ruleId, file, line: range.start.line + 1, message }`. For `.tsx`/`.jsx` files it repeats the rule with `language: Tsx` through a temporary rule copy in `os.tmpdir()`.

- [x] Step 1: test: on a temp file `const name = user.name;\nglobalThis.run = () => 1;`, `scanWithRules` returns `prefer-destructuring` on line 1 and `global-function` on line 2.
- [x] Step 2: `node --test tests/helpers/infrastructure/ast-grep-scan.test.ts` → fails.
- [x] Step 3: implement.
- [x] Step 4: the same command → `ℹ fail 0`.

---

### Task 9: project rules — test-mirror and simple-package

**Writes:** `src/helpers/logic/project-rules.ts`, `tests/helpers/logic/project-rules.test.ts`
**Depends on:** Tasks 2, 4
**Executor:** claude
**Complexity:** routine
**Satisfies:** the `check.test.ts` triples for `test-mirror` (error and warning) and `simple-package`
**Interfaces — Produces:**
- `checkTestMirror(input: { projectRoot: string; role: RoleFile; layout: RoleLayout; config: ConfigProject }): FindingItem[]`:
  - roles module/single-file-module give `error`, roles helper/util give `warning`;
  - colocated: `<dirname>/<base>.<testSuffix>.<ext>`, where the other suffix (`test`/`spec`) is also accepted;
  - folder location: `<testsLocation>/<path relative to sourceRoot without ext>.<suffix>.<ext>`;
  - `<ext>` accepts any of `CHECK_SOURCE_EXTENSIONS`;
  - line 1, message `missing test <expected path>`.
- `checkSimplePackages(input: { projectRoot: string; config: ConfigProject }): FindingItem[]`: one finding per package of `simplePackages` found in `dependencies` or `devDependencies`, with file `package.json`, line = the line of that key, and message `<name>: write simple HTTP code yourself (fetch)`.

- [x] Step 1: tests:
  - a temp layered project with `src/modules/user.ts` and no test → error `missing test tests/modules/user.test.ts`;
  - with `tests/modules/user.spec.ts` → none;
  - colocated with `testSuffix: "spec"` → it expects `user.spec.ts`;
  - `package.json` with `axios` on line 3 → line 3.
- [x] Step 2: `node --test tests/helpers/logic/project-rules.test.ts` → fails.
- [x] Step 3: implement.
- [x] Step 4: the same command → `ℹ fail 0`.

---

### Task 10: check module

**Writes:** `src/modules/check.ts`, `tests/modules/check.test.ts`
**Depends on:** Tasks 2, 3, 4, 7, 8, 9
**Executor:** claude
**Complexity:** complex
**Satisfies:** `check.test.ts` (all), the `conventions.test.ts` rule-settings cases, the `--all` case, and review focus «unparsable file»
**Interfaces — Produces:**
- `runChecks(input: { projectRoot: string; pluginRoot: string; config: ConfigProject; files: string[] }): Promise<{ findings: FindingItem[]; summary: FindingSummary; layout: RoleLayout }>`:
  1. `detectLayout`.
  2. For each file: `resolveFileRole`, read it, `parseSource`. A thrown parse error gives `warning parse <file>:1 could not parse`.
  3. `checkDeclarations`, then `checkTestMirror` for applicable roles.
  4. `scanWithRules` once for all files, dropping `prefer-destructuring` findings on test files.
  5. `checkSimplePackages` when `package.json` exists.
  6. Apply `resolveRuleSetting`: drop `off`, replace the severity, attach `reason`.
  7. Sort by file, then line, then ruleId.
- `runCommand`:
  - flags `--json` and `--all`; positional paths are files or directories, expanded through `listAllSourceFiles` filtered by prefix;
  - no paths → `listChangedFiles`; when `!isRepository` with no paths, print `codemaster: not a git repository; pass paths` and return 0;
  - plain output: one line per finding, `<severity> <ruleId> <file>:<line> <message>`, then the last line `codemaster: <E> errors, <W> warnings in <N> files`. Config warnings are printed first, as `warning config ...` lines;
  - `--json`: `JSON.stringify({ findings, summary })`;
  - returns 1 when `E > 0`, else 0.

- [x] Step 1: unit test: `runChecks` on an inline temp project with one `max-params` violation and `rules: {"max-params": {"severity": "warning", "reason": "legacy"}}` → severity `warning`, `reason: "legacy"`, and `summary.errors === 0`.
- [x] Step 2: `node --test tests/modules/check.test.ts` → fails.
- [x] Step 3: implement.
- [x] Step 4: `node --test tests/modules/check.test.ts "tests/acceptance/check.test.ts"` → `ℹ fail 0`.

---

### Task 11: conventions module

**Writes:** `src/modules/conventions.ts`, `tests/modules/conventions.test.ts`
**Depends on:** Tasks 2, 4, 7
**Executor:** claude
**Complexity:** complex
**Satisfies:** the `conventions.test.ts` profile, weak-profile, user-field and ESLint cases; review focus «ESLint print-config throws»
**Interfaces — Produces:**
- `scanConventions(projectRoot: string, current: { config: ConfigProject; raw: Record<string, unknown> }): Promise<{ profile: Partial<ConfigProject>; sources: Record<string, string>; warnings: string[] }>`:
  - `sourceRoot`: the first existing of `CONVENTIONS_SOURCE_ROOTS`, else `.`;
  - `roles`: per role, the aliases that exist as folder names anywhere under `sourceRoot` (depth ≤ 3); a role with none found keeps the full `ROLES_ALIASES` list; the source is `found: <names>`;
  - `testsLocation`: test files from `listAllSourceFiles`, counted colocated versus under each `CONVENTIONS_TEST_FOLDERS`; `testSuffix`: `.test.` versus `.spec.`;
  - `constantCase`: over the `collectDeclarations` constants in consts-role files (the share of camel versus upper-snake); `interfacePrefix`: the share of interfaces matching `/^I[A-Z]/`; `entityPrefix`: the share of constants that already start with their entity;
  - a value is taken only when its share is ≥ `CONVENTIONS_DOMINANCE_SHARE` and its count is ≥ `CONVENTIONS_DOMINANCE_MINIMUM`; the source is `dominant <percent>% (<n>/<total>)`, else the default with source `default`;
  - ESLint: when `node_modules/.bin/eslint` exists, run it with `--print-config <first source file>` (timeout 30000 ms) and map:
    - `max-params` [_, n] → `rules["max-params"] = { max: n }`, and severity `off`/0 → `"off"`;
    - `max-depth` → `rules["max-nesting"].max`;
    - `prefer-destructuring` off → `"off"`;
    - `@typescript-eslint/naming-convention` entries with selector `variable` and modifiers `const`/`global` with format `["UPPER_CASE"]` → `upper-snake`, `["camelCase"]` → `camel`;
    - selector `interface` with `prefix: ["I"]` → `interfacePrefix: "I"`;
    - the source is `eslint --print-config`;
    - a non-zero exit gives `warning conventions eslint: <first stderr line>`;
  - without ESLint, read `biome.json` `linter.rules.complexity.useMaxParams.options.max` and `style.useNamingConvention`;
  - fields present in `current.raw` without a `sources` entry are user-owned and are never overwritten.
- `writeProfile(projectRoot: string, merged: Record<string, unknown>): void`: writes `.codemaster.json` with 2-space JSON and a trailing newline.
- `formatProfile(profile, sources): string`: lines `codemaster profile:` then `  <field> = <JSON value>  (<source>)` for `layout`, `sourceRoot`, `roles`, `testsLocation`, `testSuffix`, `constantCase`, `interfacePrefix`, `entityPrefix` and `rules`. `layout` is the result of `detectLayout`.
- `runCommand`: `--refresh` or a missing file → scan, write, print `formatProfile` to stdout, return 0. With an existing file and no `--refresh` → print the current profile and return 0.

- [x] Step 1: unit test: on a temp project with only `src/types/a.ts` and 5 UPPER constants in `src/constants/a.ts` → `roles.interfaces` = `["types"]`, `constantCase` = `upper-snake` with a dominant source.
- [x] Step 2: `node --test tests/modules/conventions.test.ts` → fails.
- [x] Step 3: implement.
- [x] Step 4: `node --test tests/modules/conventions.test.ts tests/acceptance/conventions.test.ts` → `ℹ fail 0`, except the hook-dependent cases (none in this file).

---

### Task 12: libraries module

**Writes:** `src/modules/libraries.ts`, `tests/modules/libraries.test.ts`
**Depends on:** Task 2
**Executor:** claude
**Complexity:** routine
**Satisfies:** `libraries.test.ts` (all)
**Interfaces — Produces:**
- `diffLibraries(input: { projectRoot: string; config: ConfigProject }): LibraryDiff`, per spec 3.6:
  - the file name is `@a/b` → `a__b.md`, and the frontmatter is parsed by a line split between `---` fences;
  - `stale` means the major version (the first integer of the version) differs;
  - `add` and `stale` are sorted by name and capped together at `libraryDigestPerRun`, and `more` = the overflow;
  - `missing` lists declared packages with no `node_modules/<name>/package.json`.
- `formatLibraryDiff(diff): string[]`: the `add …`, `stale …`, `remove …`, `missing <name> (not installed)` lines, and `… and <more> more` when `more > 0`.
- `rebuildIndex(projectRoot: string): void`: writes `.claude/skills/codemaster-libraries/SKILL.md` with frontmatter `name: codemaster-libraries` and `description: Summaries of this project's libraries: key APIs, pitfalls and documentation links. Use before implementing something a dependency may already do.`, then one line per `<name>.md`: `- [<name>](<file>) — <first sentence under ## Purpose>`.
- `runCommand`:
  - when `libraryDigest` is false → print `libraries: disabled`, return 0;
  - `--prune` deletes the `remove` files, then rebuilds the index;
  - `--index` only rebuilds the index;
  - it prints the lines and returns 0.

- [x] Step 1: unit test: `diffLibraries` on an inline temp project with `@scope/pkg` → `add` with that name, and the file name `scope__pkg.md` is recognised for `remove`.
- [x] Step 2: `node --test tests/modules/libraries.test.ts` → fails.
- [x] Step 3: implement.
- [x] Step 4: `node --test tests/modules/libraries.test.ts tests/acceptance/libraries.test.ts` → `ℹ fail 0`.

---

### Task 13: tournament module and runner

**Writes:** `src/modules/tournament.ts`, `bin/tournament-runner.ts`, `tests/modules/tournament.test.ts`
**Depends on:** Tasks 2, 3, 5
**Executor:** claude
**Complexity:** complex
**Satisfies:** `tournament.test.ts` (all); review focus «hanging variant»
**Interfaces — Produces:**
- `bin/tournament-runner.ts`: only `async function main()`. Its arguments are `<mode verify|measure> <variantPath> <casesPath> <functionName> <iterations>`. It imports both files; the function is `module[functionName]`.
  - `verify`: for each case, `await fn(...input)` compared with `isDeepStrictEqual`. It prints `CODEMASTER_RESULT {"passed":true}` or `{"passed":false,"failure":"case <i>: expected <json> got <json>"}`.
  - `measure`: `iterations` calls cycling through the cases, timed with `process.hrtime.bigint()`. It prints `CODEMASTER_RESULT {"nanosecondsPerCall":<n>}`.
- `findCandidates(input: { projectRoot: string; config: ConfigProject }): Promise<TournamentCandidate[]>`:
  - changed files are `.ts/.mts/.cts/.js/.mjs/.cjs` only, not tests and not role helper with `/infrastructure/` or `/external/` in the path;
  - functions come from `listFunctions` with a name, `usesThis` false, and a range that overlaps `listChangedLineRanges` (or the file is `"new"`), with complexity ≥ `minComplexity` or lines ≥ `minLines`;
  - `bodyHash = hashText(bodyText)`;
  - entries whose key and bodyHash are in `tournament-done.json` are dropped (`skipped` entries match by key alone).
- `runTournament(directory: string, config: ConfigProject): Promise<TournamentResult>`:
  - verify every variant with `runProcess(process.execPath, [runner, "verify", ...], { timeoutMilliseconds: TOURNAMENT_TIMEOUT_MILLISECONDS })`; a timeout gives `failure: "timeout"`;
  - for each passed variant:
    - `bytecode`: run `node --print-bytecode --print-bytecode-filter=<functionName> --trace-deopt <runner> measure ... 10000` once. The value is the sum of `/Bytecode length: (\d+)/`, taking the first match, plus `TOURNAMENT_DEOPT_PENALTY` × the count of lines matching `new RegExp("\\[bailout \\(kind: [^)]*\\): begin\\. deoptimizing \\S+ <JSFunction " + functionName + " ")`;
    - `speed`: the median of `TOURNAMENT_RUNS` separate `measure` processes, or `null` when `cases.ts` exports `benchmark === false`;
    - `readability`, `length`, `bytecodePerToken = bytecodeLength / countTokens` and `desugared` come from `parseSource` of the variant file, through `function-metrics`;
  - score per spec 3.5: `(min+1)/(value+1)`; `bytecodePerToken` is `min/value`; `closeness` is the mean of its two sub-scores; a `null` metric's weight is shared equally among the rest; ties follow `TOURNAMENT_TIE_ORDER`;
  - it writes `<dir>/result.json`.
- `runCommand`:
  - `--candidates` prints `<file>:<line> <functionName> complexity=<c> lines=<l>`;
  - `--skip <key> --reason <text>` and `--done <dir>` (which reads `target.json` and the current body hash of the target function from the project file) append to `tournament-done.json` in `resolveStateDirectory`;
  - `<dir>` prints a table (`variant | passed | readability | length | bytecode | speed | bytecodePerToken | desugared | score`), then `winner: <name>`, and returns 1 for `none`.

- [x] Step 1: unit test: the scoring function `scoreVariants(metricsList, weights)` (exported from `tournament.ts`) with two variants, where one is better on everything → that one wins; with `speed: null` for both → the weights sum to 1 without speed.
- [x] Step 2: `node --test tests/modules/tournament.test.ts` → fails.
- [x] Step 3: implement.
- [x] Step 4: `node --test tests/modules/tournament.test.ts tests/acceptance/tournament.test.ts` → `ℹ fail 0`.

---

### Task 14: hook module

**Writes:** `src/modules/hook.ts`, `tests/modules/hook.test.ts`
**Depends on:** Tasks 10, 11, 12, 13
**Executor:** claude
**Complexity:** complex (persisted state: the hash file)
**Satisfies:** `hook.test.ts` (all)
**Interfaces — Consumes:** `runChecks` (10), `scanConventions`/`writeProfile`/`formatProfile` (11), `diffLibraries`/`formatLibraryDiff` (12), `findCandidates` (13), `ensureInstalled` (3), `loadConfig` (2).
**Produces:** `runCommand`, which dispatches on `argumentsList[0]`.
- `hook-stop` follows spec 3.8 step by step:
  1. `config.hook` false → 0. `isRepository` false → 0. `listChangedFiles` empty and `isPackageManifestChanged` false → 0.
  2. The state hash is `hashText(changed.map(path + "\0" + content).join("\0") + "\0" + packageJsonText)`, compared with `<state>/last-checked`.
  3. `stop_hook_active === true` → write the hash, return 0.
  4. `ensureInstalled()`; when it is not ok → stderr message, return 0 without writing the hash.
  5. No `.codemaster.json` → `scanConventions` + `writeProfile`, and the report starts with `formatProfile` (the profile alone is a reason to block). Then `runChecks` on the changed files, `findCandidates`, and, when `libraryDigest` is on, `diffLibraries`.
  6. Nothing to report → write the hash, return 0.
  7. Otherwise print `JSON.stringify({ decision: "block", reason })` and write the hash, so the same state never blocks twice. `reason` = `HOOK_REASON_HEADER`, the profile block (if any), `Findings (<E> errors, <W> warnings):` plus up to `HOOK_FINDINGS_LIMIT` finding lines and `… and <n> more`, `Tournament candidates (<n>):` lines, and `Libraries:` lines. Empty blocks are omitted.
- `hook-session-start`: when `config.hook` is false → nothing. Otherwise print three lines:
  - `codemaster: layout=<detectLayout>, sourceRoot=<sourceRoot>`;
  - `Before a task, check whether the framework or an installed library already does it` + (`; see the codemaster-libraries skill.` when `.claude/skills/codemaster-libraries/SKILL.md` exists, else `.`);
  - `Follow the codemaster skill rules while coding.`

- [x] Step 1: unit test: a temp repo where the second identical call returns no output, using a stubbed-free real run on a one-file project.
- [x] Step 2: `node --test tests/modules/hook.test.ts` → fails.
- [x] Step 3: implement.
- [x] Step 4: `node --test tests/modules/hook.test.ts tests/acceptance/hook.test.ts` → `ℹ fail 0`.

---

### Task 15: plugin manifests, hooks config, skills, README

**Writes:** `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `hooks/hooks.json`, `skills/codemaster/SKILL.md`, `skills/codemaster/references/rules.md`, `skills/codemaster/references/tournament.md`, `skills/codemaster/references/libraries.md`, `skills/codemaster-audit/SKILL.md`, `README.md`
**Depends on:** Task 1
**Executor:** claude
**Complexity:** routine
**Satisfies:** `manifest.test.ts` (all)
**Content:**
- `plugin.json`: `{"name":"codemaster","version":"0.1.0","description":"Code-organisation rules for TypeScript projects: a Stop hook runs deterministic checks (layout, names, parameters, nesting), a three-variant function tournament and a library digest, and the codemaster skill fixes what they find while following the project's own conventions first.","hooks":"./hooks/hooks.json","author":{"name":"dmytro-rudenko"},"license":"MIT","keywords":["claude-code","lint","code-style","typescript","ast-grep","hooks"]}`.
- `marketplace.json`: `{"name":"codemaster","owner":{"name":"dmytro-rudenko"},"plugins":[{"name":"codemaster","source":"./","version":"0.1.0","description":<same as plugin.json>,"category":"Development"}]}`.
- `hooks/hooks.json`: `{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"node \"${CLAUDE_PLUGIN_ROOT}/bin/codemaster.ts\" hook-stop","timeout":300}]}],"SessionStart":[{"matcher":"startup|resume|clear|compact","hooks":[{"type":"command","command":"node \"${CLAUDE_PLUGIN_ROOT}/bin/codemaster.ts\" hook-session-start","timeout":10}]}]}}`.
- `skills/codemaster/SKILL.md`:
  - frontmatter: `name: codemaster`, `version: 0.1.0`, `description: Use while writing or changing code in this project and whenever the codemaster Stop hook asks for it. Applies the code-organisation rules (layout, names, parameters, nesting, destructuring, KISS) after the project's own conventions, runs the codemaster checks, the function tournament, coverage and the library digest, and fixes what they find.`;
  - body, in English and under 200 lines, made of these sections:
    - `## Priority`: project rules (CLAUDE.md, AGENTS.md, CONTRIBUTING, linter config) > dominant conventions > codemaster defaults; never rename existing folders;
    - `## Rules while coding`: every text-only rule of spec 3.11, verbatim in English;
    - `## After the Stop hook`: steps 1–7 of spec 3.11, with the exact commands `node "${CLAUDE_PLUGIN_ROOT}/bin/codemaster.ts" check`, `tournament --candidates`, `tournament <dir>`, `tournament --done <dir>`, `tournament --skip <file>#<name> --reason "<text>"`, `libraries`, `libraries --prune --index` and `conventions --refresh`, the coverage-command detection order, and the `rules.<id>` + `reason` escape for conflicts with project rules;
    - `## Configuration`: a pointer to `references/rules.md`.
- `references/rules.md`: a table of every rule-id (spec 3.4 plus `single-file-module-size` and `max-call-nesting`) with one bad and one good example for each, plus the `.codemaster.json` field table of spec 3.2.
- `references/tournament.md`: the `<dir>` format (`first.ts`, `readable.ts`, `optimized.ts`, `cases.ts`, `target.json`), the metric definitions and the scoring of spec 3.5.
- `references/libraries.md`: the summary template (`## Purpose`, `## Key APIs`, `## Pitfalls`, `## Documentation`, ≤ 60 lines, frontmatter `name` and `version`) and its sources (the node_modules README, then `homepage`).
- `skills/codemaster-audit/SKILL.md`:
  - frontmatter: `name: codemaster-audit`, `version: 0.1.0`, `description: Use when the user asks to audit or clean up existing code with codemaster. Runs check --all, fixes errors one entity per batch with a commit each, and stops when the user says so.`, `disable-model-invocation: true`;
  - body: steps 1–4 of spec 3.12.
- `README.md` (English): `# codemaster`, then `## Install` (`/plugin marketplace add <path or repo>` then `/plugin install codemaster@codemaster`), `## What it does`, `## Configuration` (`.codemaster.json`, `.codemaster.local.json`, the profile), `## Commands`, `## Requirements` (Node ≥ 22.18; ast-grep auto-installed into `~/.local/share/codemaster`, override with `CODEMASTER_DATA_DIR`), and `## Limits` (TS/JS only).

- [x] Step 1: `node --test tests/acceptance/manifest.test.ts` → fails (files missing).
- [x] Step 2: write the files.
- [x] Step 3: the same command → `ℹ fail 0`.

---

### Task 16: self-check and full green

**Writes:** any of `src/**/*.ts`, `bin/*.ts` and `tests/{modules,helpers,utils}/**/*.test.ts`, only to clear findings; no new behaviour
**Depends on:** Tasks 14, 15
**Executor:** claude
**Complexity:** routine
**Satisfies:** `self-check.test.ts`; the whole suite
- [x] Step 1: `node bin/codemaster.ts check src bin` → lists the plugin's own violations, if any.
- [x] Step 2: fix each violation by following the rule (move the constant into `src/consts/<entity>.ts`, rename, split the function). Never use `rules` overrides in the plugin's own `.codemaster.json`, and do not create one.
- [x] Step 3: `node bin/codemaster.ts check src bin` → the last line starts with `codemaster: 0 errors`.
- [x] Step 4: `npm test` → `ℹ fail 0`.
