// Tournament runner for JavaScript and TypeScript (TypeScript needs Node 22.18 or newer).
// node node.mjs verify|measure|benchmark <variant> <cases> <functionName> <iterations>
// Prints one line "CODEMASTER_RESULT <key> <value>": "passed 1", "failed <reason>" or "ns <nanoseconds per call>".
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const [mode, variantPath, casesPath, functionName, iterationsText] = process.argv.slice(2);

function report(key, value) {
  process.stdout.write(`CODEMASTER_RESULT ${key} ${String(value).replace(/\s+/g, " ")}\n`);
}

async function loadCases() {
  if (casesPath.endsWith(".json")) {
    const parsed = JSON.parse(readFileSync(casesPath, "utf8"));
    return Array.isArray(parsed) ? parsed : parsed.cases;
  }
  const module = await import(pathToFileURL(resolve(casesPath)).href);
  return module.cases;
}

async function main() {
  if (mode === "benchmark") {
    const module = await import(pathToFileURL(resolve(casesPath)).href);
    report("benchmark", module.benchmark !== false);
    return;
  }
  const variant = await import(pathToFileURL(resolve(variantPath)).href);
  const cases = await loadCases();
  const target = variant[functionName];
  if (typeof target !== "function") {
    report("failed", `no exported function ${functionName}`);
    return;
  }
  if (mode === "verify") {
    for (const [position, { input, expected }] of cases.entries()) {
      let actual;
      try {
        actual = await target(...input);
      } catch (error) {
        report("failed", `case ${position}: threw ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      if (!isDeepStrictEqual(actual, expected)) {
        report("failed", `case ${position}: expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`);
        return;
      }
    }
    report("passed", 1);
    return;
  }
  const iterations = Number(iterationsText);
  const started = process.hrtime.bigint();
  for (let call = 0; call < iterations; call++) {
    const output = target(...cases[call % cases.length].input);
    if (output instanceof Promise) {
      await output;
    }
  }
  report("ns", Number(process.hrtime.bigint() - started) / iterations);
}

main().catch((error) => report("failed", error instanceof Error ? error.message : String(error)));
