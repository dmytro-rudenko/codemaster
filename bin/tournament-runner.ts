import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

async function main(): Promise<void> {
  const [mode, variantPath, casesPath, functionName, iterationsText] = process.argv.slice(2);
  const variantModule = await import(pathToFileURL(resolve(variantPath)).href);
  const { cases } = (await import(pathToFileURL(resolve(casesPath)).href)) as {
    cases: Array<{ input: unknown[]; expected: unknown }>;
  };
  const target = variantModule[functionName] as (...input: unknown[]) => unknown;
  const report = (payload: unknown): void => {
    process.stdout.write(`CODEMASTER_RESULT ${JSON.stringify(payload)}\n`);
  };
  if (typeof target !== "function") {
    report({ passed: false, failure: `no exported function ${functionName}` });
    return;
  }
  if (mode === "verify") {
    for (const [position, { input, expected }] of cases.entries()) {
      let actual: unknown;
      try {
        actual = await target(...input);
      } catch (error) {
        report({ passed: false, failure: `case ${position}: threw ${error instanceof Error ? error.message : String(error)}` });
        return;
      }
      if (!isDeepStrictEqual(actual, expected)) {
        report({ passed: false, failure: `case ${position}: expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}` });
        return;
      }
    }
    report({ passed: true });
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
  const elapsed = process.hrtime.bigint() - started;
  report({ nanosecondsPerCall: Number(elapsed) / iterations });
}

main();
