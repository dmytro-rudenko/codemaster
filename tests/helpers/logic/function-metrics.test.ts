import { before, test } from "node:test";
import assert from "node:assert/strict";
import { ensureInstalled } from "../../../src/modules/install.ts";
import { parseSource } from "../../../src/helpers/infrastructure/ast-grep.ts";
import {
  countBodyLines,
  countDesugared,
  countTokens,
  findThenInThen,
  listFunctions,
  measureBlockNesting,
  measureCallbackNesting,
  measureCallNesting,
  measureCognitiveComplexity,
} from "../../../src/helpers/logic/function-metrics.ts";

const SUM_LIST_SOURCE =
  "function sumList(values){let total=0;for(const value of values){if(value>0){total+=value}}return total}";

async function rootOf(text: string) {
  return (await parseSource("a.ts", text)).root();
}

async function functionsOf(text: string) {
  return listFunctions(await rootOf(text));
}

async function functionNamed(text: string, name: string) {
  const found = (await functionsOf(text)).find((entry) => entry.name === name);
  assert.ok(found, `function ${name} not listed`);
  return found;
}

before(() => {
  const outcome = ensureInstalled();
  assert.equal(outcome.ok, true, `install failed: ${outcome.message}`);
});

test("sumList has cognitive complexity 3 and block nesting 2", async () => {
  const sumList = await functionNamed(SUM_LIST_SOURCE, "sumList");
  assert.equal(measureCognitiveComplexity(sumList.node), 3);
  assert.equal(measureBlockNesting(sumList.node), 2);
});

test("measureCallNesting reports depth 4 for a(b(c(d())))", async () => {
  const depths = measureCallNesting(await rootOf("a(b(c(d())))"));
  assert.equal(depths.length, 1);
  assert.equal(depths[0].depth, 4);
});

test("findThenInThen reports one line for a then inside a then callback", async () => {
  const lines = findThenInThen(await rootOf("p.then(x => q.then(y => y))"));
  assert.equal(lines.length, 1);
});

test("a method is named Class.method and detects this", async () => {
  const bump = await functionNamed("class Counter { bump(){ return this.value } }", "Counter.bump");
  assert.equal(bump.usesThis, true);
});

test("this inside a nested non-arrow function does not count as usesThis", async () => {
  const bump = await functionNamed(
    "class Counter { bump(){ return function(){ return this.value } } }",
    "Counter.bump",
  );
  assert.equal(bump.usesThis, false);
});

test("an arrow assigned to a const takes the declarator name and counts parameters", async () => {
  const add = await functionNamed("const add = (first, second) => first + second", "add");
  assert.equal(add.parameterCount, 2);
});

test("parameterCount leaves out a this parameter", async () => {
  const bound = await functionNamed("function bound(this: Window, first: number){ return first }", "bound");
  assert.equal(bound.parameterCount, 1);
});

test("countDesugared counts destructuring, rest, optional chain, ?? and template substitution", async () => {
  const sugared = await functionNamed("function f({a}, ...rest){ return a?.b ?? `${rest}` }", "f");
  assert.ok(countDesugared(sugared.node) >= 5, `desugared ${countDesugared(sugared.node)}`);
});

test("an else if chain does not add block depth", async () => {
  const pick = await functionNamed(
    "function pick(level){ if(level>2){return 1} else if(level>1){return 2} else if(level>0){return 3} return 0 }",
    "pick",
  );
  assert.equal(measureBlockNesting(pick.node), 1);
});

test("blocks of a nested function do not count toward the outer function's nesting", async () => {
  const source =
    "function outer(flag){ if(flag){ const inner = () => { if(flag){ if(flag){ if(flag){ return 1 } } } } } return 0 }";
  const outer = await functionNamed(source, "outer");
  const inner = await functionNamed(source, "inner");
  assert.equal(measureBlockNesting(outer.node), 1);
  assert.equal(measureBlockNesting(inner.node), 3);
});

test("a run of like boolean operators adds 1 to cognitive complexity", async () => {
  const check = await functionNamed("function check(a, b, c){ return a && b && c }", "check");
  assert.equal(measureCognitiveComplexity(check.node), 1);
});

test("a mixed && and || sequence adds 2 to cognitive complexity", async () => {
  const check = await functionNamed("function check(a, b, c){ return a && b || c }", "check");
  assert.equal(measureCognitiveComplexity(check.node), 2);
});

test("a recursion call adds 1 to cognitive complexity", async () => {
  const countdown = await functionNamed("function countdown(n){ return countdown(n - 1) }", "countdown");
  assert.equal(measureCognitiveComplexity(countdown.node), 1);
});

test("an if inside a callback gets a nesting increment", async () => {
  const run = await functionNamed(
    "function run(items){ items.forEach(item => { if(item){ log(item) } }) }",
    "run",
  );
  assert.equal(measureCognitiveComplexity(run.node), 2);
});

test("listFunctions reports 1-based start and end lines", async () => {
  const later = await functionNamed("\n\nfunction later(){\n  return 1\n}\n", "later");
  assert.equal(later.line, 3);
  assert.equal(later.endLine, 5);
});

test("an anonymous callback is listed with name null", async () => {
  const functions = await functionsOf("run(() => 1)");
  assert.equal(functions.length, 1);
  assert.equal(functions[0].name, null);
});

test("countBodyLines leaves out the braces and blank lines", async () => {
  const body = await functionNamed("function body(){\n  const first = 1;\n\n  return first;\n}\n", "body");
  assert.equal(countBodyLines(body.node), 2);
});

test("countTokens counts leaf nodes and leaves out comments", async () => {
  const plain = await functionNamed("function token(){ return 1 }", "token");
  const commented = await functionNamed("function token(){ /* note */ return 1 // trailing\n}", "token");
  const longer = await functionNamed("function token(){ return 1 + 2 }", "token");
  assert.equal(countTokens(commented.node), countTokens(plain.node));
  assert.equal(countTokens(longer.node) - countTokens(plain.node), 2);
});

test("measureCallbackNesting is 3 for three nested argument callbacks", async () => {
  const wrap = await functionNamed("function wrap(){ a(() => b(() => c(() => 1))) }", "wrap");
  assert.equal(measureCallbackNesting(wrap.node), 3);
});
