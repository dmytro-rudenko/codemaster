# Library digest

The digest is a project skill kept in git: one short summary per npm dependency (other package managers are not read yet), so that later sessions know what an installed library already does before they write the same thing.

## Commands

`bash "${CLAUDE_PLUGIN_ROOT}/bin/codemaster.sh" libraries` reads `dependencies` of every `package.json` in the project and its subfolders (and `devDependencies` when `libraryDigestDev` is `true`), without `@types/*`. It skips `node_modules`, `.git`, folders that are their own git repository (worktrees, submodules) and paths matching `exclude`. A package is looked up in the `node_modules` of its manifest's folder, then of each parent folder up to the project root. The names are compared with `.claude/skills/codemaster-libraries/<name>.md`. A scoped name `@a/b` is stored as `a__b.md`. At most `libraryDigestPerRun` (default 5) `add` and `stale` lines are printed, in alphabetical order, with a final `... and <N> more` line; the rest come on the next runs.

| Line | Meaning | What to do |
|---|---|---|
| `add <name> <version> readme=<path or -> homepage=<url or ->` | no summary yet | write `<name>.md` |
| `stale <name> <old> -> <new>` | the major version changed | rewrite `<name>.md` and set the new `version` |
| `remove <name>` | no `package.json` declares the package any more | `libraries --prune` deletes the file |
| `missing <name> (not installed)` | the package is not in `node_modules` | run the project's install, or skip it |

When `libraryDigest` is `false` the command prints `libraries: disabled` and does nothing.

After writing the files run `bash "${CLAUDE_PLUGIN_ROOT}/bin/codemaster.sh" libraries --prune --index`. It deletes the files of removed packages and rebuilds `.claude/skills/codemaster-libraries/SKILL.md`: the frontmatter (`name: codemaster-libraries`, `description`) and one line per library with one sentence from its file.

## Sources

Read, in this order:

1. the `README` in `node_modules/<name>/` (the `readme=` path on the `add` line);
2. the `homepage` of the package (the `homepage=` url), for the documentation pages the README only links to.

Write only what the sources say. Do not fill gaps from memory.

## Summary template

One file per library, at most 60 lines:

```markdown
---
name: <name>
version: <version from node_modules/<name>/package.json>
---

## Purpose

One or two sentences: what the library does and when to reach for it instead of writing the code.

## Key APIs

- `functionOrClass(args)`: what it does, in one line.

## Pitfalls

- Version-specific traps, defaults that surprise, things that look supported but are not.

## Documentation

- [Page title](https://example.com/exact-page): what it covers.
```

`Documentation` links to concrete pages (a guide, an API reference), not to the site root. The index takes one sentence from each file, so write `Purpose` so that its first sentence stands alone.
