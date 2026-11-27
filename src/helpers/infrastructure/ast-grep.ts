import { createRequire } from "node:module";
import { extname, join } from "node:path";
import { resolveDataDirectory } from "../../modules/install.ts";

export async function loadAstGrep(): Promise<typeof import("@ast-grep/napi")> {
  const require = createRequire(join(resolveDataDirectory(), "node_modules", "noop.js"));
  return require("@ast-grep/napi");
}

export function resolveAstGrepBinary(): string {
  return join(resolveDataDirectory(), "node_modules", ".bin", "ast-grep");
}

export async function parseSource(
  path: string,
  text: string,
): Promise<Awaited<ReturnType<typeof import("@ast-grep/napi").parse>>> {
  const astGrep = await loadAstGrep();
  const extension = extname(path).toLowerCase();
  if (extension === ".tsx" || extension === ".jsx") {
    return astGrep.parse(astGrep.Lang.Tsx, text);
  }
  if (extension === ".js" || extension === ".mjs" || extension === ".cjs") {
    return astGrep.parse(astGrep.Lang.JavaScript, text);
  }
  return astGrep.parse(astGrep.Lang.TypeScript, text);
}
