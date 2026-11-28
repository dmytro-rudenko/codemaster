# Acceptance: one tests folder, tests only for functions, suffix-free names, loops and lookup tables, limits of 4.

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

profile_field() {
  awk -f "$PLUGIN_ROOT/lib/awk/json.awk" "$1/.codemaster.json" | awk -F '\t' -v path="$2" '$1 == path { print $3 }'
}

MODULAR='{"layout": "modular"}'
USER_SERVICE='export function createUser() { return 1; }\n'

test_modular_fixture_has_tests_in_one_folder_and_plain_names() {
  local directory
  directory=$(copy_fixture modular)
  assert_file "$directory/tests/user/user.service.test.ts"
  assert_no_file "$directory/src/user/user.service.test.ts"
  assert_file "$directory/src/user/consts.ts"
  assert_file "$directory/src/user/interfaces.ts"
  run_in "$directory" check --json src scripts tests
  assert_not_contains "$OUTPUT" '"ruleId":"test-placement"'
  assert_not_contains "$OUTPUT" '"ruleId":"file-name-suffix"'
}

test_a_test_next_to_the_code_is_misplaced() {
  local directory
  directory=$(new_project "$MODULAR")
  put "$directory/src/user/service.ts" "$USER_SERVICE"
  put "$directory/src/user/service.test.ts" 'createUser();\n'
  run_in "$directory" check src
  assert_match '^error test-placement src/user/service\.test\.ts:1 test file src/user/service\.test\.ts belongs in tests/user/service\.test\.ts$' "$OUTPUT"
}

test_a_second_test_folder_is_misplaced() {
  local directory
  directory=$(new_project "$MODULAR")
  put "$directory/src/user/service.ts" "$USER_SERVICE"
  put "$directory/tests/user/service.test.ts" 'createUser();\n'
  put "$directory/src/user/__tests__/service.test.ts" 'createUser();\n'
  run_in "$directory" check src tests
  assert_match '^error test-placement src/user/__tests__/service\.test\.ts:1 second test folder src/user/__tests__; keep all tests in tests/$' "$OUTPUT"
  assert_no_match 'test-placement tests/' "$OUTPUT"
}

test_go_tests_stay_next_to_the_code() {
  local directory
  directory=$(copy_fixture polyglot)
  run_in "$directory" check src
  assert_no_match 'test-placement src/modules/go/' "$OUTPUT"
}

test_consts_interfaces_and_styles_have_no_suffix() {
  local directory
  directory=$(new_project "$MODULAR")
  put "$directory/src/user/service.ts" "$USER_SERVICE"
  put "$directory/src/user/user.consts.ts" 'export const USER_LIMIT = 1;\n'
  put "$directory/src/user/user.interfaces.ts" 'export interface UserAccount { name: string }\n'
  put "$directory/src/button/button.styles.css" '.button { color: red; }\n'
  put "$directory/src/card/card.module.css" '.card { color: red; }\n'
  put "$directory/src/panel/panel.css" '.panel { color: red; }\n'
  run_in "$directory" check src
  assert_match '^warning file-name-suffix src/user/user\.consts\.ts:1 rename to src/user/consts\.ts$' "$OUTPUT"
  assert_match '^warning file-name-suffix src/user/user\.interfaces\.ts:1 rename to src/user/interfaces\.ts$' "$OUTPUT"
  assert_match '^warning file-name-suffix src/button/button\.styles\.css:1 rename to src/button/button\.css$' "$OUTPUT"
  assert_match '^warning file-name-suffix src/card/card\.module\.css:1 rename to src/card/card\.css$' "$OUTPUT"
  assert_no_match 'file-name-suffix src/panel/' "$OUTPUT"
}

test_layered_consts_drop_the_suffix_and_keep_the_entity() {
  local directory
  directory=$(new_project '{"layout": "layered"}')
  put "$directory/src/modules/user.ts" "$USER_SERVICE"
  put "$directory/src/consts/user.consts.ts" 'export const USER_LIMIT = 1;\n'
  run_in "$directory" check src
  assert_match '^warning file-name-suffix src/consts/user\.consts\.ts:1 rename to src/consts/user\.ts$' "$OUTPUT"
}

test_file_name_suffix_can_be_switched_off() {
  local directory
  directory=$(new_project '{"layout": "modular", "rules": {"file-name-suffix": "off"}}')
  put "$directory/src/user/service.ts" "$USER_SERVICE"
  put "$directory/src/user/user.consts.ts" 'export const USER_LIMIT = 1;\n'
  run_in "$directory" check src
  assert_not_contains "$OUTPUT" "file-name-suffix"
}

test_repeated_array_elements_ask_for_a_loop() {
  local directory
  directory=$(new_project "$MODULAR")
  put "$directory/src/menu/menu.tsx" 'export function renderMenu() {\n  return [\n    <li className="item">One</li>,\n    <li className="item">Two</li>,\n    <li className="item">Three</li>,\n    <li className="item">Four</li>,\n  ];\n}\n'
  put "$directory/src/order/order.ts" 'export function listRows() {\n  return [{ id: 1, label: "a" }, { id: 2, label: "b" }, { id: 3, label: "c" }, { id: 4, label: "d" }];\n}\n'
  put "$directory/src/page/page.ts" 'export function pageNumbers() {\n  return [1, 2, 3, 4, 5];\n}\n'
  put "$directory/src/report/report.py" 'def build_rows():\n    return [{"id": 1}, {"id": 2}, {"id": 3}, {"id": 4}]\n'
  run_in "$directory" check src
  assert_match '^warning array-repeated-elements src/menu/menu\.tsx:2 array has 4 elements of the same shape; build it with a for loop$' "$OUTPUT"
  assert_match '^warning array-repeated-elements src/order/order\.ts:2 array has 4 elements of the same shape; build it with a for loop$' "$OUTPUT"
  assert_match '^warning array-repeated-elements src/page/page\.ts:2 array has 5 elements of the same shape; build it with a for loop$' "$OUTPUT"
  assert_match '^warning array-repeated-elements src/report/report\.py:2 array has 4 elements of the same shape; build it with a for loop$' "$OUTPUT"
  assert_equal 4 "$(printf '%s\n' "$OUTPUT" | grep -c ' array-repeated-elements ')"
}

test_plain_data_arrays_stay_quiet() {
  local directory
  directory=$(new_project "$MODULAR")
  put "$directory/src/word/word.ts" 'export function listWords() {\n  return ["a", "b", "c", "d"];\n}\nexport function listThree() {\n  return [{ id: 1 }, { id: 2 }, { id: 3 }];\n}\n'
  put "$directory/src/menu/consts.ts" 'export const MENU_ROWS = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];\n'
  put "$directory/tests/menu/menu.test.ts" 'const rows = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];\n'
  run_in "$directory" check src tests
  assert_not_contains "$OUTPUT" "array-repeated-elements"
  printf '{"layout": "modular", "rules": {"array-repeated-elements": "off"}}' > "$directory/.codemaster.json"
  put "$directory/src/page/page.ts" 'export function pageNumbers() {\n  return [1, 2, 3, 4, 5];\n}\n'
  run_in "$directory" check src
  assert_not_contains "$OUTPUT" "array-repeated-elements"
}

test_if_chains_over_literals_ask_for_a_lookup_table() {
  local directory
  directory=$(new_project "$MODULAR")
  put "$directory/src/kind/kind.ts" 'export function extensionOf(language: string) {\n  if (language === "python") {\n    return "py";\n  }\n  if (language === "go") {\n    return "go";\n  }\n  if (language === "rust" || language === "rustc") {\n    return "rs";\n  }\n  if (language === "ruby") {\n    return "rb";\n  }\n  return "";\n}\n'
  put "$directory/src/kind/short.py" 'def short_name(language):\n    if language == "python":\n        return "py"\n    if language == "go":\n        return "go"\n    if language == "rust":\n        return "rs"\n    if language == "ruby":\n        return "rb"\n    return ""\n'
  put "$directory/src/kind/three.ts" 'export function threeOf(language: string) {\n  if (language === "a") {\n    return "x";\n  }\n  if (language === "b") {\n    return "y";\n  }\n  if (language === "c") {\n    return "z";\n  }\n  return "";\n}\n'
  run_in "$directory" check src
  assert_match '^warning lookup-chain src/kind/kind\.ts:2 4 if branches compare language with literals; use a lookup table$' "$OUTPUT"
  assert_match '^warning lookup-chain src/kind/short\.py:2 4 if branches compare language with literals; use a lookup table$' "$OUTPUT"
  assert_no_match 'lookup-chain src/kind/three\.ts' "$OUTPUT"
}

# Counts lines matching a pattern inside the named awk functions of a file.
chain_lines() {
  awk -v names=" $3 " -v pattern="$2" '
    /^function / { name = $2; sub(/\(.*/, "", name); inside = index(names, " " name " ") > 0 }
    inside && index($0, pattern) > 0 { count++ }
    END { print count + 0 }' "$1"
}

test_codemaster_awk_uses_lookup_tables() {
  assert_equal 0 "$(chain_lines "$PLUGIN_ROOT/lib/awk/lang.awk" 'if (extension == "' 'language_of')"
  assert_equal 0 "$(chain_lines "$PLUGIN_ROOT/lib/awk/lang.awk" 'if (language == "' 'language_extensions')"
  assert_equal 0 "$(chain_lines "$PLUGIN_ROOT/lib/awk/mirror.awk" 'if (language == "' 'default_test_name test_names')"
}

test_conventions_never_record_colocated_tests() {
  local directory name
  directory=$(new_project "")
  put "$directory/src/user/service.ts" "$USER_SERVICE"
  for name in one two three four five; do
    put "$directory/src/user/$name.test.ts" 'createUser();\n'
  done
  run_in "$directory" conventions --refresh
  assert_equal "tests" "$(profile_field "$directory" testsLocation)"
  assert_equal "default" "$(profile_field "$directory" sources/testsLocation)"
}

test_colocated_in_the_config_warns_and_means_tests() {
  local directory
  directory=$(new_project '{"layout": "modular", "testsLocation": "colocated"}')
  put "$directory/src/user/service.ts" "$USER_SERVICE"
  run_in "$directory" check src
  assert_contains "$OUTPUT" 'warning config testsLocation: "colocated" is not supported, using "tests"'
  assert_match '^error test-mirror src/user/service\.ts:1 missing test tests/user/service\.test\.ts$' "$OUTPUT"
}

test_tests_are_required_only_for_files_with_functions() {
  local directory
  directory=$(new_project "$MODULAR")
  put "$directory/src/user/model.ts" 'export interface UserShape { name: string }\nexport class UserRecord { name = "x"; }\n'
  put "$directory/src/user/service.ts" "$USER_SERVICE"
  put "$directory/src/user/consts.ts" 'export const USER_LIMIT = 1;\n'
  put "$directory/src/user/interfaces.ts" 'export interface UserAccount { name: string }\n'
  run_in "$directory" check src
  assert_no_match 'test-mirror src/user/model\.ts' "$OUTPUT"
  assert_match '^error test-mirror src/user/service\.ts:1 ' "$OUTPUT"
  assert_no_match 'test-mirror src/user/(consts|interfaces)\.ts' "$OUTPUT"
}

test_nesting_and_name_limits_default_to_four() {
  local directory
  directory=$(new_project "$MODULAR")
  put "$directory/src/flow/flow.ts" 'export function walkFour(items: number[]) {\n  for (const item of items) {\n    if (item > 0) {\n      while (item > 1) {\n        if (item > 2) {\n          return item;\n        }\n      }\n    }\n  }\n  return 0;\n}\n'
  put "$directory/src/deep/deep.ts" 'export function walkFive(items: number[]) {\n  for (const item of items) {\n    if (item > 0) {\n      while (item > 1) {\n        if (item > 2) {\n          if (item > 3) { return item; }\n        }\n      }\n    }\n  }\n  return 0;\n}\n'
  put "$directory/src/name/name.ts" 'export function readUserOrderTotal() { return 1; }\nexport function readActiveUserOrderTotal() { return 1; }\n'
  run_in "$directory" check src
  assert_no_match 'max-nesting src/flow/' "$OUTPUT"
  assert_match '^error max-nesting src/deep/deep\.ts:6 function walkFive nests blocks deeper than 4$' "$OUTPUT"
  assert_no_match 'readUserOrderTotal has' "$OUTPUT"
  assert_match '^warning name-word-count src/name/name\.ts:2 readActiveUserOrderTotal has 5 words \(max 4\)$' "$OUTPUT"
  printf '{"layout": "modular", "rules": {"max-nesting": {"max": 3}}}' > "$directory/.codemaster.json"
  run_in "$directory" check src
  assert_match '^error max-nesting src/flow/flow\.ts:5 ' "$OUTPUT"
}

test_the_plugin_has_no_errors_over_all_files() {
  run_in "$PLUGIN_ROOT" check --all
  assert_match '^codemaster: 0 errors' "$(printf '%s\n' "$OUTPUT" | tail -n 1)"
}
