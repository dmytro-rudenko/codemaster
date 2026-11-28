# Function tournament

Three variants of one function compete; the winner replaces the function in the project. The runner of the function's language checks every variant against the cases and measures it: `node` for TypeScript and JavaScript (Node 22.18 or newer for `.ts`), `python3` for Python, `ruby` for Ruby, `php` for PHP and `go` for Go. Rust, Java, Kotlin, C#, C and C++ have no runner, so their functions are never candidates.

## Candidates

`bash "${CLAUDE_PLUGIN_ROOT}/bin/codemaster" tournament --candidates` lists changed functions with cognitive complexity of at least `tournament.minComplexity` (default 5) or a body of at least `tournament.minLines` (default 10) non-empty lines, that are not yet in `<git-path codemaster>/tournament-done.json`. Line format: `<file>:<line> <functionName> complexity=<c> lines=<l>`.

- A function is changed when its line range meets a hunk of `git diff -U0 <merge-base>`, or the file is new.
- The name is the function name; a TypeScript or JavaScript class method is `<Class>.<method>`; an anonymous function assigned to a variable takes the variable name. Other anonymous functions are never candidates.
- Not candidates: functions in `.tsx` and `.jsx`, methods that use `this` (TypeScript, JavaScript), methods of classes, structs and modules (Python, Ruby, PHP, Go), functions in `helpers/infrastructure` and `helpers/external` (they need a database or a network), and functions of a language whose runner is not installed.
- A function that cannot be isolated (closure over module state, path aliases, project imports) is skipped with `tournament --skip <file>#<functionName> --reason "<text>"`.

## The `<dir>` format

Create it in the scratchpad as `<scratchpad>/tournament/<functionName>/`.

| File | Content |
|---|---|
| `first.<ext>` | the function as first written |
| `readable.<ext>` | a version written for the smallest cognitive complexity, same name and signature |
| `optimized.<ext>` | a version written for the fewest bytecode and the best speed, same name and signature |
| `cases.json` | `{"cases": [{"input": [<arguments>], "expected": <result>}], "benchmark": true}` |
| `target.json` | `{"file": "<path in the project>", "functionName": "<name>"}` |

`<ext>` is the extension of the language: `.ts`, `.js`, `.mts` or `.mjs` (the function is exported under its name), `.py`, `.rb` (a top-level method), `.php` (a top-level function, the file starts with `<?php`), `.go` (any package name; the runner compiles it as `package main` with a harness, so the variant must not declare `main`).

Rules for the files:

- Prefer self-contained variants: copy the helpers and constants they need into the file, because `<dir>` is outside the project. Use only the standard library of the language.
- `cases.json` covers the normal path, the edge cases and every branch of the function. Inputs and results are JSON values: arrays, objects (dicts, hashes, maps, structs), strings, numbers, booleans and `null`. Set `"benchmark": false` for functions whose timing is not meaningful (they touch time, randomness or the file system).
- For TypeScript and JavaScript `cases.ts` (or `.js`) with `export const cases = [...]` and `export const benchmark = false` is also accepted, for inputs that JSON cannot hold.
- The function may be `async` (TypeScript, JavaScript, Python); the runner awaits every call. A Go function may return `(value, error)`; a non-nil error counts as a thrown error.

Example `cases.json`:

```json
{
  "cases": [
    { "input": ["a-b", "-"], "expected": ["a", "b"] },
    { "input": ["", "-"], "expected": [""] }
  ]
}
```

Example `target.json`:

```json
{ "file": "src/helpers/logic/split.py", "functionName": "split_by" }
```

## Steps

1. Correctness. For every case of every variant the runner calls the function with the inputs and compares the result with `expected`: `node:util.isDeepStrictEqual` in Node; a strict deep comparison after a JSON round trip of the result in Python, Ruby, PHP and Go (so a tuple equals a list, but `true` never equals `1`). A variant with one mismatch or exception is out, with the reason printed.
2. Metrics (lower is better) for every variant still in:
   - `readability`: cognitive complexity by the SonarSource rules (computed from the ast-grep tree);
   - `length`: non-empty lines of the function body;
   - `bytecode`: Node: `Bytecode length` from `node --print-bytecode --print-bytecode-filter=<functionName>` after 10 000 calls over the cases, plus 50 for every deoptimisation line of the function in `--trace-deopt`; Python: the number of CPython instructions (`dis`); Ruby: the number of YARV instructions (`RubyVM::InstructionSequence`); not measured for PHP and Go;
   - `speed`: the median ns/op over 5 runs of 10 000 calls over the cases, each run in its own process; not measured when `benchmark` is `false`;
   - `closeness`: how far the source is from what the runtime executes, made of two sub-metrics:
     - `bytecodePerToken`: the bytecode count (without the deoptimisation penalty) divided by the number of source tokens of the function (leaf nodes of the ast-grep tree, comments excluded); only where `bytecode` is measured;
     - `desugared`: the number of constructs the runtime expands into hidden operations: spread and rest, destructuring, optional chaining, `??`, generators and `yield`, `async`/`await`, nested functions that capture variables of the outer function (closures), `try`/`catch`, template strings with substitutions, comprehensions and decorators (Python), `defer` and `go` (Go), blocks (Ruby).
3. Scoring. For each metric `score = (min + 1) / (value + 1)`, where `min` is the smallest value among the variants. `bytecodePerToken` is compared as is, without `+1`: `score = min / value`. The `closeness` score is the mean of the scores of its measured sub-metrics. The total is the sum of `score x weight` with `tournament.weights` (default 0.2 for each of `readability`, `length`, `bytecode`, `speed`, `closeness`). A metric that is not measured drops out and its weight is shared equally among the rest. A tie goes to the earlier one in the order `readable`, `first`, `optimized`.
4. Output. A table of variants with raw values and the total, the line `winner: <variant>`, and the file `<dir>/result.json`. When all three variants are out, the output is `winner: none` and the exit code is 1.

After moving the winner into the project and getting the project's tests green, run `bash "${CLAUDE_PLUGIN_ROOT}/bin/codemaster" tournament --done <dir>`. It records the target (key `<file>#<functionName>` plus the git blob hash of the body) in `tournament-done.json`, so the function is not offered again until its body changes.
