# codemaster

A Claude Code plugin that keeps TypeScript and JavaScript code organised. After each answer a `Stop` hook runs deterministic checks on the files changed on the branch (layout, names, parameters, nesting), looks for functions worth a three-variant tournament and for dependencies without a library summary. When there is something to fix, the hook asks Claude to run the `codemaster` skill.

The project's own style comes first: explicit rules (`CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING*`, linter config) outrank the dominant conventions of the existing code, and those outrank the codemaster defaults. The plugin never asks to rename existing folders; any rule can be switched off or tuned in `.codemaster.json`.

## Install

From GitHub:

```
/plugin marketplace add dmytro-rudenko/codemaster
/plugin install codemaster@codemaster
```

From a local clone, either add the folder as a marketplace (`/plugin marketplace add <path>`) or load it for one session:

```
claude --plugin-dir <path>
```

## What it does

- **`Stop` hook.** Runs after every answer. It stays silent when the changed code files hash the same as at the last check, and it never blocks twice in a row. Otherwise it blocks once with a report and the instruction to run the `codemaster` skill. The hook never breaks a session: every internal error is one line on stderr and exit code 0.
- **`SessionStart` hook.** Prints the detected layout and two reminders into the context: follow the codemaster rules, and check what the framework or an installed library already does.
- **Deterministic checks.** ast-grep rules plus a Node script for the folder layout and test mirrors:

  | Rule | Checks |
  |---|---|
  | `layout-forbidden-declaration` | no interfaces, types, enums or constants in modules, helpers and utils |
  | `single-file-module-size` | a single-file module with its own declarations grows past `singleFileMaxLines` |
  | `helpers-only-functions` | helpers and utils hold only functions |
  | `test-mirror` | every module, helper and util has a test file |
  | `helpers-mixed-kind` | a helper mixes database and network work |
  | `name-abbreviation` | no abbreviations such as `cfg`, `msg`, `req` |
  | `name-word-count` | a name has at most 3 words |
  | `name-entity-prefix` | constants and interfaces carry the entity prefix (`USER_`, `User`) |
  | `max-params` | at most 5 parameters |
  | `max-nesting` | at most 3 levels of blocks, no callback hell |
  | `max-call-nesting` | no `a(b(c(d())))` |
  | `global-function` | top-level functions only in modules, helpers and utils |
  | `prefer-destructuring` | `const { name } = user` instead of `const name = user.name` |
  | `simple-package` | no `axios`-like packages for what `fetch` does |

- **Function tournament.** For a changed function that is complex enough, Claude writes three variants (`first`, `readable`, `optimized`) and test cases. The runner drops the variants that fail a case and scores the rest by cognitive complexity, length, V8 bytecode, speed and closeness to what V8 runs. The winner goes into the code.
- **Library digest.** For each dependency Claude writes a short summary into `.claude/skills/codemaster-libraries/`, so that later sessions check what an installed library already does before writing the same code.
- **Coverage.** The `codemaster` skill brings line coverage of the changed modules to 100%.
- **Audit.** `/codemaster:codemaster-audit [path]` runs the checks over the existing code and fixes it one entity per batch, with a commit for each.

## Configuration

`.codemaster.json` in the project root is optional. Without it, the first hook run scans the project and writes the profile (the `sourceRoot`, the folder names of each role, the test location and suffix, the naming conventions, and the limits found in a Biome config). The hook never runs the project's own ESLint, because that would execute repository code; run `conventions --refresh` yourself to import ESLint limits. Each written field has its source in `sources`: a config path, `dominant 83% (41/49)` or `default`. The profile is printed at the top of the first report; correct the file if something is wrong. A field written by hand is never overwritten.

```json
{
  "layout": "auto",
  "sourceRoot": "src",
  "roles": { "helper": ["helpers", "support"] },
  "testsLocation": "tests",
  "rules": {
    "prefer-destructuring": "off",
    "max-params": { "max": 8, "reason": "CLAUDE.md allows 8 parameters in handlers" }
  }
}
```

`.codemaster.local.json` next to it has the same format and overrides `.codemaster.json` for one developer. Add it to `.gitignore`.

Every field, the defaults, the layout detection and examples for each rule are in [skills/codemaster/references/rules.md](skills/codemaster/references/rules.md).

## Commands

The hooks and skills call the CLI; you can call it too: `node <plugin>/bin/codemaster.ts <command>`.

| Command | Does |
|---|---|
| `check [paths...] [--all] [--json]` | checks the changed files (or the given paths, or all files); exit code 1 when there are errors |
| `conventions [--refresh]` | scans the project and writes the profile into `.codemaster.json` |
| `tournament --candidates` | lists changed functions worth a tournament |
| `tournament <dir>` | runs a tournament on a prepared directory |
| `tournament --done <dir>` | marks a tournament target as done |
| `tournament --skip <file>#<name> --reason "<text>"` | skips a function that cannot be isolated |
| `libraries [--prune] [--index]` | lists dependencies that need a summary; prunes and indexes the summaries |
| `install` | installs ast-grep into the data directory |
| `hook-stop`, `hook-session-start` | the hook entry points |

Skills:

- `codemaster:codemaster` is invoked by the hook and while you write code.
- `codemaster:codemaster-audit` is started by you with `/codemaster:codemaster-audit [path]`.

## Requirements

- Node 22.18 or newer. On an older version the CLI prints `codemaster: requires Node >= 22.18` and exits with code 0.
- ast-grep (`@ast-grep/cli` and `@ast-grep/napi`) is installed automatically on the first hook run into `~/.local/share/codemaster` (`$XDG_DATA_HOME/codemaster` when set). Set `CODEMASTER_DATA_DIR` to use another folder. Nothing is installed into your project.
- A git repository. Outside git the hooks stay silent.

## Limits

- TypeScript and JavaScript only: `.ts .tsx .mts .cts .js .jsx .mjs .cjs`, without `node_modules/`, `dist/`, `build/`, `coverage/` and `*.d.ts`.
- The tournament skips `.tsx`/`.jsx` functions, methods that use `this`, and helpers that talk to a database or the network.
- Only the files changed on the branch are checked by the hook; use the audit skill for existing code.
- The text of `CLAUDE.md`, `AGENTS.md` and `CONTRIBUTING*` is read by Claude in the skill, not by the scanner.
