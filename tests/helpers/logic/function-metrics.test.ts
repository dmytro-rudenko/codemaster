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

async function rootOf(text: string, path = "a.ts") {
  return (await parseSource(path, text)).root();
}

async function functionsOf(text: string, path = "a.ts") {
  return listFunctions(await rootOf(text, path));
}

async function functionNamed(text: string, name: string, path = "a.ts") {
  const found = (await functionsOf(text, path)).find((entry) => entry.name === name);
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

const CLOSURE_CASES: [string, string, string, number][] = [
  ["a JS-grammar parameter", "a.js", "function outer(first){ return () => first }", 1],
  ["a single unparenthesised arrow parameter", "a.ts", "const outer = value => () => value", 1],
  ["a for...of variable", "a.ts", "function outer(items){ for (const item of items) { run(() => item) } }", 1],
  ["a for...in variable", "a.ts", "function outer(table){ for (const key in table) { run(() => key) } }", 1],
  ["an array_pattern element", "a.ts", "function outer(pair){ const [left] = pair; return () => left }", 2],
  ["a catch binding", "a.ts", "function outer(){ try { run() } catch (problem) { return () => problem } }", 2],
];

for (const [label, path, source, expected] of CLOSURE_CASES) {
  test(`countDesugared counts a closure over ${label}`, async () => {
    const outer = await functionNamed(source, "outer", path);
    assert.equal(countDesugared(outer.node), expected);
  });
}

test("listFunctions lists a generator function expression under its declarator name", async () => {
  const make = await functionNamed("const make = function* (first) { yield first }", "make");
  assert.equal(make.parameterCount, 1);
});

test("measureCallNesting treats a call in new_expression arguments as outermost", async () => {
  const depths = measureCallNesting(await rootOf("new Wrapper(a(b(c(d()))))"));
  assert.deepEqual(
    depths.map((entry) => entry.depth),
    [4],
  );
});

const COGNITIVE_CASES: [string, string, number][] = [
  ["a labeled break adds 1", "function scan(rows){ outer: while (rows) { break outer } }", 2],
  ["a labeled continue adds 1", "function scan(rows){ outer: while (rows) { continue outer } }", 2],
  ["an unlabeled break adds nothing", "function scan(rows){ while (rows) { break } }", 1],
  ["a plain else adds 1", "function scan(flag){ if (flag) { return 1 } else { return 2 } }", 2],
  ["a ternary adds 1", "function scan(flag){ return flag ? 1 : 2 }", 1],
  ["a nested ternary adds nesting", "function scan(flag){ if (flag) { return flag ? 1 : 2 } return 0 }", 3],
  ["a nested switch adds nesting", "function scan(flag){ if (flag) { switch (flag) { case 1: return 1 } } return 0 }", 3],
  [
    "a nested catch adds nesting",
    "function scan(flag){ if (flag) { try { run() } catch (problem) { return 1 } } return 0 }",
    3,
  ],
];

for (const [label, source, expected] of COGNITIVE_CASES) {
  test(`cognitive complexity: ${label}`, async () => {
    const scan = await functionNamed(source, "scan");
    assert.equal(measureCognitiveComplexity(scan.node), expected);
  });
}

test("countDesugared counts the async keyword once per function", async () => {
  const bare = await functionNamed("async function load(){ return 1 }", "load");
  const awaiting = await functionNamed("async function load(){ await first(); await second() }", "load");
  assert.equal(countDesugared(bare.node), 1);
  assert.equal(countDesugared(awaiting.node), 3);
});

const BINDING_CASES: [string, string, number][] = [
  [
    "a closure over a renamed object-pattern binding counts",
    "function outer(pair){ const { a: renamed } = pair; return () => renamed }",
    2,
  ],
  [
    "a closure over an object-pattern default counts",
    "function outer(options){ const { count = 1 } = options; return () => count }",
    2,
  ],
  [
    "a closure over an array-pattern default counts",
    "function outer(list){ const [first = 0] = list; return () => first }",
    2,
  ],
  [
    "assignment destructuring of a let binding keeps one closure",
    "function outer(list){ let held; [held] = list; return () => held }",
    2,
  ],
  [
    "assignment destructuring does not declare an outer binding",
    "function outer(list){ [held] = list; return () => held }",
    1,
  ],
  [
    "a non-declaring loop variable does not make a closure",
    "function outer(list){ for (item of list) { run(() => item) } }",
    0,
  ],
];

for (const [label, source, expected] of BINDING_CASES) {
  test(`countDesugared: ${label}`, async () => {
    const outer = await functionNamed(source, "outer");
    assert.equal(countDesugared(outer.node), expected);
  });
}
