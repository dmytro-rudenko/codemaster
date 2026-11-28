---
name: codemaster-audit
version: 0.3.0
description: Use when the user asks to audit or clean up existing code with codemaster. Runs check --all, fixes errors one entity per batch with a commit each, and stops when the user says so.
disable-model-invocation: true
---

# codemaster audit

Run over the existing code, not over the changes of the branch. The user starts it with `/code-organizer:codemaster-audit [path]`; the hook never calls it.

Follow the `codemaster` skill (`code-organizer:codemaster`) for the priority order (project rules, then dominant conventions, then codemaster defaults), for the rules while coding, and for the `rules.<id>` + `reason` escape when a finding contradicts a project rule. Every command is `bash "${CLAUDE_PLUGIN_ROOT}/bin/codemaster.sh" <subcommand>`, run from the project root.

## Steps

1. Run `bash "${CLAUDE_PLUGIN_ROOT}/bin/codemaster.sh" check --all`, or `bash "${CLAUDE_PLUGIN_ROOT}/bin/codemaster.sh" check <path>` when the user gave a path. Give the user a summary: the number of findings per rule-id and per entity folder.
2. Work in batches. One batch is one entity folder in a `modular` project, or one entity across all layers (`modules`, `consts`, `interfaces`, ...) in a `layered` project. In a batch:
   1. fix the `error` findings, in the same way as steps 1 and 2 of the `codemaster` skill (fix `warning` findings only when the change is small);
   2. run the project's tests and keep them green;
   3. make one commit: `refactor(<entity>): codemaster audit`.
3. Do not run the function tournament: the functions did not change. Run coverage only for the modules of the current batch, with the command order of step 5 of the `codemaster` skill.
4. After each batch tell the user in a few lines what changed and propose the next batch. Stop when the user says stop or when no findings are left.
