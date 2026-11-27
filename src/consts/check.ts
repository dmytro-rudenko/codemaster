export const CHECK_SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

export const CHECK_IGNORED_DIRECTORIES = ["node_modules", "dist", "build", "coverage"];

export const CHECK_SCAN_BATCH_SIZE = 500;

export const CHECK_RULE_SEVERITY: Record<string, "error" | "warning"> = {
  "layout-forbidden-declaration": "error",
  "single-file-module-size": "warning",
  "helpers-only-functions": "error",
  "test-mirror": "error",
  "helpers-mixed-kind": "warning",
  "name-abbreviation": "error",
  "name-word-count": "warning",
  "name-entity-prefix": "error",
  "max-params": "error",
  "max-nesting": "error",
  "max-call-nesting": "warning",
  "global-function": "error",
  "prefer-destructuring": "warning",
  "simple-package": "warning",
  parse: "warning",
  "ast-grep": "warning",
};

export const CHECK_LIMITS = {
  maxParameters: 5,
  maxNesting: 3,
  maxCallbackNesting: 2,
  maxCallNesting: 3,
  maxWords: 3,
};
