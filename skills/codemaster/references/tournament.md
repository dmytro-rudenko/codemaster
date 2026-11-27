# Function tournament

Three variants of one function compete; the winner replaces the function in the project. The tournament runs on Node and `@ast-grep/napi`; it does not need the TypeScript compiler.

## Candidates

`node "${CLAUDE_PLUGIN_ROOT}/bin/codemaster.ts" tournament --candidates` lists changed functions with cognitive complexity of at least `tournament.minComplexity` (default 5) or a body of at least `tournament.minLines` (default 10) non-empty lines, that are not yet in `<git-path codemaster>/tournament-done.json`. Line format: `<file>:<line> <functionName> complexity=<c> lines=<l>`.

- A function is changed when its line range meets a hunk of `git diff -U0 <merge-base>`, or the file is new.
- The name is the function name; a class method is `<Class>.<method>`; an anonymous function assigned to a variable takes the variable name. Other anonymous functions are never candidates.
- Not candidates: functions in `.tsx` and `.jsx`, methods that use `this`, functions in `helpers/infrastructure` and `helpers/external` (they need a database or a network).
- A function that cannot be isolated (closure over module state, path aliases) is skipped with `tournament --skip <file>#<functionName> --reason "<text>"`.

## The `<dir>` format

Create it in the scratchpad as `<scratchpad>/tournament/<functionName>/`.

| File | Content |
|---|---|
| `first.ts` | the function as first written, exported under its name (`.js` is also accepted) |
| `readable.ts` | a version written for the smallest cognitive complexity, same exported name and signature |
| `optimized.ts` | a version written for the fewest bytecode and the best speed, same exported name and signature |
| `cases.ts` | `export const cases: { input: unknown[]; expected: unknown }[]`, and optionally `export const benchmark = false` |
| `target.json` | `{"file": "<path in the project>", "functionName": "<name>"}` |

Rules for the files:

- Prefer self-contained variants: copy the helpers and constants they need into the file, because `<dir>` is outside the project.
- `cases.ts` covers the normal path, the edge cases and every branch of the function. Set `benchmark = false` for functions whose timing is not meaningful (they touch time, randomness or the file system).
- The function may be `async`; the runner awaits every call.

Example `cases.ts`:

```ts
export const cases = [
  { input: ["a-b", "-"], expected: ["a", "b"] },
  { input: ["", "-"], expected: [""] },
];
```

Example `target.json`:

```json
{ "file": "src/helpers/logic/split.ts", "functionName": "splitBy" }
```

## Steps

1. Correctness. For every case of every variant the runner does `await fn(...input)` and compares the result with `expected` through `node:util.isDeepStrictEqual`. A variant with one mismatch or exception is out, with the reason printed.
2. Metrics (lower is better) for every variant still in:
   - `readability`: cognitive complexity by the SonarSource rules (computed through `@ast-grep/napi`);
   - `length`: non-empty lines of the function body;
   - `bytecode`: `Bytecode length` from `node --print-bytecode --print-bytecode-filter=<functionName>` after 10 000 calls over `cases`, plus 50 for every deoptimisation line of the function in `--trace-deopt`;
   - `speed`: the median ns/op over 5 runs of 10 000 calls over `cases`, each run in its own process; not measured when `benchmark = false`;
   - `closeness`: how far the source is from what V8 runs, made of two sub-metrics:
     - `bytecodePerToken`: `Bytecode length` (without the deoptimisation penalty) divided by the number of source tokens of the function (leaf nodes of the ast-grep tree, comments excluded);
     - `desugared`: the number of constructs V8 expands into hidden operations: spread and rest (`...`), destructuring, optional chaining `?.`, `??`, generators, `async`/`await`, nested functions that capture variables of the outer function (closures), `try`/`catch`/`finally`, template strings with substitutions.
3. Scoring. For each metric `score = (min + 1) / (value + 1)`, where `min` is the smallest value among the variants. `bytecodePerToken` is compared as is, without `+1`: `score = min / value`. The `closeness` score is the mean of the scores of its two sub-metrics. The total is the sum of `score x weight` with `tournament.weights` (default 0.2 for each of `readability`, `length`, `bytecode`, `speed`, `closeness`). A metric that is not measured drops out and its weight is shared equally among the rest. A tie goes to the earlier one in the order `readable`, `first`, `optimized`.
4. Output. A table of variants with raw values and the total, the line `winner: <variant>`, and the file `<dir>/result.json`. When all three variants are out, the output is `winner: none` and the exit code is 1.

After moving the winner into the project and getting the project's tests green, run `node "${CLAUDE_PLUGIN_ROOT}/bin/codemaster.ts" tournament --done <dir>`. It records the target (key `<file>#<functionName>` plus the SHA-256 of the body) in `tournament-done.json`, so the function is not offered again until its body changes.
