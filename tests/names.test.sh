# file-name-suffix: style files and consts/interfaces files named without a role suffix.

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

MODULAR='{"layout": "modular"}'
USER_SERVICE='export function createUser() { return 1; }\n'

test_scss_module_file_is_renamed_without_the_suffix() {
  local directory
  directory=$(new_project "$MODULAR")
  put "$directory/src/user/service.ts" "$USER_SERVICE"
  put "$directory/src/card/card.module.scss" '.card { color: red; }\n'
  run_in "$directory" check src
  assert_match '^warning file-name-suffix src/card/card\.module\.scss:1 rename to src/card/card\.scss$' "$OUTPUT"
}

test_less_module_file_is_renamed_without_the_suffix() {
  local directory
  directory=$(new_project "$MODULAR")
  put "$directory/src/user/service.ts" "$USER_SERVICE"
  put "$directory/src/card/card.module.less" '.card { color: red; }\n'
  run_in "$directory" check src
  assert_match '^warning file-name-suffix src/card/card\.module\.less:1 rename to src/card/card\.less$' "$OUTPUT"
}

test_style_file_in_an_ignored_folder_has_no_finding() {
  local directory
  directory=$(new_project "$MODULAR")
  put "$directory/src/user/service.ts" "$USER_SERVICE"
  put "$directory/src/dist/x.styles.css" '.x { color: red; }\n'
  run_in "$directory" check src
  assert_not_contains "$OUTPUT" "file-name-suffix"
  assert_match '^codemaster: [0-9]+ errors, [0-9]+ warnings in 1 files$' "$OUTPUT"
}

test_plain_consts_file_has_no_finding() {
  local directory
  directory=$(new_project "$MODULAR")
  put "$directory/src/user/service.ts" "$USER_SERVICE"
  put "$directory/src/global/consts.ts" 'export const USER_LIMIT = 1;\n'
  run_in "$directory" check src
  assert_not_contains "$OUTPUT" "file-name-suffix"
  assert_match '^codemaster: [0-9]+ errors, [0-9]+ warnings in 2 files$' "$OUTPUT"
}

test_a_style_file_in_a_folder_with_a_space_is_renamed_without_the_suffix() {
  local directory
  directory=$(new_project "$MODULAR")
  put "$directory/src/user/service.ts" "$USER_SERVICE"
  put "$directory/src/my button/button.styles.css" '.button { color: red; }\n'
  run_in "$directory" check src
  assert_match '^warning file-name-suffix src/my button/button\.styles\.css:1 rename to src/my button/button\.css$' "$OUTPUT"
}
