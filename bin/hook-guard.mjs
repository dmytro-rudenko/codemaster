import { pathToFileURL } from "node:url";

const [major, minor] = process.versions.node.split(".").map(Number);
if (major > 23 || (major === 23 && minor >= 6) || (major === 22 && minor >= 18)) {
  const [target, ...rest] = process.argv.slice(2);
  process.argv = [process.argv[0], target, ...rest];
  try {
    await import(pathToFileURL(target).href);
  } catch (error) {
    process.stderr.write(`codemaster: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}
