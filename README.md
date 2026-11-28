# codemaster

A Claude Code plugin that keeps code organised in TypeScript, JavaScript, Python, Go, Rust, Java, Kotlin, C#, PHP, Ruby, C and C++. After each answer a `Stop` hook runs deterministic checks on the files changed on the branch (layout, names, parameters, nesting), looks for functions worth a three-variant tournament and for dependencies without a library summary. When there is something to fix, the hook asks Claude to run the `codemaster` skill.

The project's own style comes first: explicit rules (`CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING*`, linter config) outrank the dominant conventions of the existing code, and those outrank the codemaster defaults. The plugin never asks to rename existing folders; any rule can be switched off or tuned in `.codemaster.json`.

The plugin is written in bash and POSIX awk. It runs on macOS (the stock bash 3.2 and BSD awk), Linux (gawk, mawk or BusyBox awk) and Windows (Git Bash, which Claude Code uses for hooks) without installing a runtime: no Node, Python or npm is needed.

## Install

From GitHub:

```
/plugin marketplace add dmytro-rudenko/codemaster
/plugin install code-organizer@codemaster
```

From a local clone, either add the folder as a marketplace (`/plugin marketplace add <path>`) or load it for one session:

```
claude --plugin-dir <path>
```

## What it does

- **`Stop` hook.** Runs after every answer. It stays silent when the changed code files hash the same as at the last check, and it never blocks twice in a row. Otherwise it blocks once with a report and the instruction to run the `codemaster` skill. The hook never breaks a session: every internal error is one line on stderr and exit code 0.
- **`SessionStart` hook.** Prints the detected layout and two reminders into the context: follow the codemaster rules, and check what the framework or an installed library already does.
- **Deterministic checks.** ast-grep parses every file into a syntax tree; awk programs walk the tree with the node kinds of each language's grammar. The same rules apply to every language:

  | Rule | Checks |
  |---|---|
  | `layout-forbidden-declaration` | no interfaces, types, enums or constants in modules, helpers and utils |
  | `single-file-module-size` | a single-file module with its own declarations grows past `singleFileMaxLines` |
  | `helpers-only-functions` | helpers and utils hold only functions |
  | `test-mirror` | every module, helper and util has a test file, named the way the language names tests |
  | `helpers-mixed-kind` | a helper mixes database and network work |
  | `name-abbreviation` | no abbreviations such as `cfg`, `msg`, `req` |
  | `name-word-count` | a name has at most 3 words |
  | `name-entity-prefix` | constants and interfaces carry the entity prefix (`USER_`, `User`) |
  | `max-params` | at most 5 parameters |
  | `max-nesting` | at most 3 levels of blocks, no callback hell |
  | `max-call-nesting` | no `a(b(c(d())))` |
  | `global-function` | top-level functions only in modules, helpers and utils |
  | `prefer-destructuring` | `const { name } = user` instead of `const name = user.name` (TypeScript and JavaScript) |
  | `simple-package` | no `axios`-like packages for what `fetch` does (`package.json`) |

- **Function tournament.** For a changed function that is complex enough, Claude writes three variants (`first`, `readable`, `optimized`) and test cases. The runner of the language (Node for TypeScript and JavaScript, Python, Ruby, PHP, Go) drops the variants that fail a case and scores the rest by cognitive complexity, length, bytecode (V8, CPython or YARV), speed and closeness to what the runtime executes. The winner goes into the code.
- **Library digest.** For each npm dependency Claude writes a short summary into `.claude/skills/codemaster-libraries/`, so that later sessions check what an installed library already does before writing the same code.
- **Coverage.** The `codemaster` skill brings line coverage of the changed modules to 100%.
- **Audit.** `/code-organizer:codemaster-audit [path]` runs the checks over the existing code and fixes it one entity per batch, with a commit for each.

### Languages

| Language | Files | Tests the `test-mirror` rule accepts | Tournament runner |
|---|---|---|---|
| TypeScript, JavaScript | `.ts .tsx .mts .cts .js .jsx .mjs .cjs` | `name.test.ts`, `name.spec.ts` in the mirror folder | `node` (22.18+ for `.ts`) |
| Python | `.py` | `test_name.py`, `name_test.py` | `python3` |
| Go | `.go` | `name_test.go` next to the file | `go` |
| Rust | `.rs` | a `#[cfg(test)]` module in the file, or `tests/name.rs` | — |
| Java, Kotlin | `.java .kt .kts` | `NameTest`, `NameTests`, `NameIT`; `src/main/` mirrors to `src/test/` | — |
| C# | `.cs` | `NameTests.cs`, `NameTest.cs` | — |
| PHP | `.php` | `NameTest.php` | `php` |
| Ruby | `.rb` | `name_spec.rb`, `name_test.rb`, `test_name.rb` | `ruby` |
| C, C++ | `.c .h .cc .cpp .cxx .hpp .hh .hxx` | `name_test.c`, `test_name.c`, `name_tests.cpp` | — |

For the languages whose tests usually live in their own tree (Python, Java, Kotlin, C#, PHP, Ruby, C, C++), a test file with an accepted name anywhere in the project counts. The `languages` field of `.codemaster.json` limits the check to some languages.

## Configuration

`.codemaster.json` in the project root is optional. Without it, the first hook run scans the project and writes the profile (the `sourceRoot`, the folder names of each role, the test location and suffix, the naming conventions, and the limits found in a Biome config). The hook never runs the project's own ESLint, because that would execute repository code; run `conventions --refresh` yourself to import ESLint limits. Each written field has its source in `sources`: a config path, `dominant 83% (41/49)` or `default`. The profile is printed at the top of the first report; correct the file if something is wrong. A field written by hand is never overwritten.

```json
{
  "layout": "auto",
  "sourceRoot": "src",
  "languages": ["python", "go"],
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

The hooks and skills call the CLI; you can call it too: `bash <plugin>/bin/codemaster.sh <command>`.

| Command | Does |
|---|---|
| `check [paths...] [--all] [--json]` | checks the changed files (or the given paths, or all files); exit code 1 when there are errors |
| `conventions [--refresh]` | scans the project and writes the profile into `.codemaster.json` |
| `tournament --candidates` | lists changed functions worth a tournament |
| `tournament <dir>` | runs a tournament on a prepared directory |
| `tournament --done <dir>` | marks a tournament target as done |
| `tournament --skip <file>#<name> --reason "<text>"` | skips a function that cannot be isolated |
| `libraries [--prune] [--index]` | lists dependencies that need a summary; prunes and indexes the summaries |
| `install` | downloads ast-grep into the data directory |
| `version` | prints the version |
| `hook-stop`, `hook-session-start` | the hook entry points |

Skills:

- `code-organizer:codemaster` is invoked by the hook and while you write code.
- `code-organizer:codemaster-audit` is started by you with `/code-organizer:codemaster-audit [path]`.

## Requirements

- bash (3.2 or newer), git, and the POSIX tools every system has: `awk`, `sed`, `grep`, `sort`, `find`, `tar`, and `curl` or `wget` for the first download.
- ast-grep. On first use the CLI downloads the prebuilt ast-grep binary for the machine (macOS, Linux glibc or musl, Windows; x64 or arm64) from the npm registry with `curl` and unpacks it with `tar` into `~/.local/share/codemaster` (`$XDG_DATA_HOME/codemaster` when set). Set `CODEMASTER_DATA_DIR` to use another folder, `CODEMASTER_REGISTRY` for a registry mirror, or `CODEMASTER_AST_GREP` to point at an ast-grep you installed yourself. When the download fails and `ast-grep` is on `PATH`, that one is used. After a failed download the next try waits an hour; `codemaster install` retries at once. Nothing is installed into your project.
- A git repository. Outside git the `Stop` hook stays silent; the `SessionStart` hook still prints its context.
- For the tournament only: the runtime of the function's language (`node`, `python3`, `ruby`, `php` or `go`). Without it the language's functions are not offered as candidates.

## Tests

```
bash tests/run.sh [file filter] [test filter]
```

The suite has no dependencies beyond the plugin's own. `CODEMASTER_TEST_AWKS="/usr/bin/mawk /usr/bin/original-awk"` also compares the results of other awk implementations with the default one.

## Limits

- Files are read whole, as one ast-grep argument: on Windows a file over about 30 KB, on Linux over about 120 KB, is skipped with a `parse` warning.
- Generated and vendored code is skipped: `node_modules/`, `dist/`, `build/`, `coverage/`, `vendor/`, `target/`, `__pycache__/`, `.venv/`, `venv/`, `obj/`, `*.d.ts`, `*.min.js`, `*.pb.go`, `*_pb2.py`.
- The tournament skips `.tsx`/`.jsx` functions, methods (methods that use `this` in TypeScript and JavaScript), and helpers that talk to a database or the network. Rust, Java, Kotlin, C#, C and C++ functions are checked but have no tournament runner.
- The library digest reads `package.json` dependencies only.
- Only the files changed on the branch are checked by the hook; use the audit skill for existing code.
- The text of `CLAUDE.md`, `AGENTS.md` and `CONTRIBUTING*` is read by Claude in the skill, not by the scanner.
