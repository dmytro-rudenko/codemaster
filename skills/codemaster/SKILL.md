---
name: codemaster
version: 0.3.0
description: Use while writing or changing code in this project and whenever the codemaster Stop hook asks for it. Applies the code-organisation rules (layout, names, parameters, nesting, destructuring, KISS) after the project's own conventions, runs the codemaster checks, the function tournament, coverage and the library digest, and fixes what they find.
---

# codemaster

codemaster keeps code organised in TypeScript, JavaScript, Python, Go, Rust, Java, Kotlin, C#, PHP, Ruby, C and C++. A Stop hook runs deterministic checks after each answer. This skill is the working procedure for writing code under those rules and for fixing what the hook reports.

Every command below is `bash "${CLAUDE_PLUGIN_ROOT}/bin/codemaster" <subcommand>`, run from the project root.

## Priority

Apply rules in this order and stop at the first one that speaks:

1. The project's explicit rules: `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING*`, linter config (ESLint, Biome, Ruff, golangci-lint, Clippy, Checkstyle, RuboCop and the like).
2. The dominant conventions of the existing code (recorded in `.codemaster.json` by `conventions`).
3. The codemaster defaults, only where the project is silent.

Never rename existing folders to match codemaster names. If the project calls a role `services` or `types`, the `roles` field of `.codemaster.json` maps it; the code stays where it is.

## Rules while coding

These rules are not all checked by a script. Follow them in every change.

- KISS. Pick the simplest code that works.
- Before a task, check whether the framework or an installed library already does it. Read `.claude/skills/codemaster-libraries/SKILL.md` when it exists.
- Write simple things yourself (HTTP requests, CRUD). For complex ones (a cron scheduler, queues, parsers) look for a ready-made tool first.
- Keep call nesting low and avoid callback hell: use async/await (or the language's equivalent) and early returns.
- Use destructuring (unpacking, pattern matching) where the language has it and it fits.
- Use full names, and two words where two are enough.
- All tests live in the one tests folder (`testsLocation`, default `tests/`) mirroring the source tree; never next to the code, never a second test folder.
- Write tests only for functions; constants, interfaces and types get none.
- Name constants, interfaces and stylesheet files by role only: `user/consts.ts`, `user/interfaces.ts`, `button/button.css`, never `user.consts.ts`, `button.styles.css`, `button.module.css`.
- Build repeated elements with a loop (`for`/`for…of`, or `map` over a data array in JSX), not a long literal array, including list items, rows and icons in components.
- Replace a chain of `if (x == literal) return literal` with a lookup table (object, map, array).
- On the frontend use a component approach and MVC, unless the project sets another structure.
- Split helpers into `infrastructure` (database, redis, internal tools), `external` (third-party APIs) and `logic` (pure functions). This is a recommendation for projects that have no helper layout of their own.

The checked rules (layout, naming, parameters, nesting, tests, packages) are listed with examples in `references/rules.md`. Write new code so that `check` has nothing to say.

## After the Stop hook

The hook blocks with a report that starts with `Run the codemaster skill (codemaster:codemaster) for this branch.` Work through these steps in order.

1. Read the report, then `CLAUDE.md`, `AGENTS.md` and `CONTRIBUTING*`.
   - Project rules outrank codemaster. When a `check` finding contradicts a project rule, do not fix it. Write `rules.<id>` into `.codemaster.json` (`"off"` or a new value, for example `{"max": 8}`) with a `reason` that quotes the project rule, and name this in the final report.
   - When the profile printed at the top of the report disagrees with the project's rules, correct the fields in `.codemaster.json` by hand, or run `bash "${CLAUDE_PLUGIN_ROOT}/bin/codemaster" conventions --refresh`. Fields you wrote yourself (no entry in `sources`) are never overwritten by the scanner.
   - When you create `.codemaster.local.json` for the first time, add it to the project's `.gitignore`.
2. Fix every `error`. Fix a `warning` when the change is small; otherwise name it in the report.
3. For each tournament candidate (`<file>:<line> <functionName> complexity=<c> lines=<l>`):
   1. Create `<scratchpad>/tournament/<functionName>/` and write `first.<ext>`, `readable.<ext>`, `optimized.<ext>` (the extension of the function's language), `cases.json` and `target.json` in it, as described in `references/tournament.md`.
   2. Run `bash "${CLAUDE_PLUGIN_ROOT}/bin/codemaster" tournament <dir>`.
   3. Move the printed `winner: <variant>` into the code, in place of the function. `winner: none` (exit 1) means every variant failed a case: fix the cases or the variants and run again.
   4. Run the project's tests.
   5. Run `bash "${CLAUDE_PLUGIN_ROOT}/bin/codemaster" tournament --done <dir>`.
   - A function that cannot be isolated (closure over module state, path aliases) is skipped: `bash "${CLAUDE_PLUGIN_ROOT}/bin/codemaster" tournament --skip <file>#<name> --reason "<text>"`. Name every skipped function in the final report.
   - List the open candidates at any time with `bash "${CLAUDE_PLUGIN_ROOT}/bin/codemaster" tournament --candidates`.
4. Libraries. For every `add` and `stale` line of the report, write the library summary as described in `references/libraries.md`. Run `bash "${CLAUDE_PLUGIN_ROOT}/bin/codemaster" libraries` to see the full list, and `bash "${CLAUDE_PLUGIN_ROOT}/bin/codemaster" libraries --prune --index` after the files are written. It deletes the `remove` files and rebuilds the index.
5. Coverage. Run the project's tests with coverage and bring line coverage of the changed files with the roles `module` and `single-file-module` to 100% of the lines of functions, adding tests to their mirror test files. The command is, in this order:
   1. `coverageCommand` from `.codemaster.json` — it comes from the repository, so show the exact command to the user and run it only after they approve it in this session;
   2. the coverage command of the project's own test setup, as its manifest declares it: `npx vitest run --coverage` when `package.json` lists `vitest`, `npx jest --coverage` when it lists `jest`, `node --test --experimental-test-coverage` for other Node projects; `pytest --cov` (or `coverage run -m pytest`) for Python; `go test -cover ./...` for Go; `cargo llvm-cov` or `cargo tarpaulin` for Rust when installed; the JaCoCo task of Maven or Gradle for Java and Kotlin; `dotnet test --collect:"XPlat Code Coverage"` for C#; `phpunit --coverage-text` for PHP; SimpleCov through the test suite for Ruby; `gcov`/`llvm-cov` through the build for C and C++;
   3. when the project has no coverage tool, say so in the report instead of installing one.

   A line that cannot honestly be covered (a defensive branch for an impossible state) is named in the report. Do not write an empty test for it.
6. Run `bash "${CLAUDE_PLUGIN_ROOT}/bin/codemaster" check` again. Tell the user about every remaining `error` and why it remains.
7. Report: what was fixed, coverage of the changed modules, tournament winners and skipped functions, which libraries were added or removed, and every `rules.<id>` you wrote with its reason.

## Configuration

Fields of `.codemaster.json` and `.codemaster.local.json`, the layout detection, and every rule-id with a bad and a good example are in `references/rules.md`.
