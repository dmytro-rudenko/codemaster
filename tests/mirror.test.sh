# test-mirror: a test is required only for files with at least one named function.

new_project() {
  local directory
  directory=$(mktemp -d "$TEST_TMP/project.XXXXXX")
  [ -n "$1" ] && printf '%s' "$1" > "$directory/.codemaster.json"
  printf '%s\n' "$directory"
}

put() {
  mkdir -p "$(dirname "$1")"
  printf '%b' "$2" > "$1"
}

test_a_module_of_types_only_needs_no_test() {
  local directory
  directory=$(new_project '{"layout": "layered"}')
  put "$directory/src/modules/types-only.ts" 'export type Row = { id: string };\n'
  put "$directory/src/consts/global.ts" 'export const LIMIT = 1;\n'
  run_in "$directory" check src
  assert_no_match 'test-mirror src/modules/types-only\.ts' "$OUTPUT"
  assert_match '^codemaster: [0-9]+ errors, [0-9]+ warnings in 2 files$' "$OUTPUT"
}

test_a_module_with_a_function_needs_its_test() {
  local directory
  directory=$(new_project '{"layout": "layered"}')
  put "$directory/src/modules/user.ts" 'export function createUser() { return 1; }\n'
  put "$directory/src/consts/global.ts" 'export const LIMIT = 1;\n'
  run_in "$directory" check src
  assert_match '^error test-mirror src/modules/user\.ts:1 missing test tests/modules/user\.test\.ts$' "$OUTPUT"
}

test_a_class_method_counts_as_a_function() {
  local directory
  directory=$(new_project '{"layout": "layered"}')
  put "$directory/src/modules/account.ts" 'export class Account {\n  total() { return 1; }\n}\n'
  put "$directory/src/consts/global.ts" 'export const LIMIT = 1;\n'
  run_in "$directory" check src
  assert_match '^error test-mirror src/modules/account\.ts:1 ' "$OUTPUT"
}
