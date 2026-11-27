import { before, test } from "node:test";
import assert from "node:assert/strict";
import { ensureInstalled } from "../../../src/modules/install.ts";
import { parseSource } from "../../../src/helpers/infrastructure/ast-grep.ts";

const TYPED_SOURCE = "const value: number = 1";
const JSX_SOURCE = "const view = <div>{value}</div>";

const LANGUAGE_CASES: [string, boolean, boolean][] = [
  ["a.ts", false, true],
  ["a.mts", false, true],
  ["a.cts", false, true],
  ["a.tsx", false, false],
  ["a.TSX", false, false],
  ["a.jsx", false, false],
  ["a.js", true, false],
  ["a.JS", true, false],
  ["a.mjs", true, false],
  ["a.cjs", true, false],
];

async function hasSyntaxError(path: string, text: string): Promise<boolean> {
  const root = await parseSource(path, text);
  return root.root().find({ rule: { kind: "ERROR" } }) !== null;
}

before(() => {
  const outcome = ensureInstalled();
  assert.equal(outcome.ok, true, `install failed: ${outcome.message}`);
});

test("parseSource parses a .ts source to a program root", async () => {
  const root = await parseSource("a.ts", "const value = 1");
  assert.equal(root.root().kind(), "program");
});

test("parseSource parses a .tsx source with JSX to a program root", async () => {
  const root = await parseSource("view.tsx", JSX_SOURCE);
  assert.equal(root.root().kind(), "program");
});

test("parseSource picks the language from the file extension", async () => {
  for (const [path, typedFails, jsxFails] of LANGUAGE_CASES) {
    assert.equal(await hasSyntaxError(path, TYPED_SOURCE), typedFails, `${path} typed source`);
    assert.equal(await hasSyntaxError(path, JSX_SOURCE), jsxFails, `${path} JSX source`);
  }
});
