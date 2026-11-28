# test-placement: test files belong in the one tests folder, mirroring the source root.

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

test_a_test_in_the_tests_folder_is_not_misplaced() {
  local directory
  directory=$(new_project "$MODULAR")
  put "$directory/src/user/service.ts" "$USER_SERVICE"
  put "$directory/tests/user/service.test.ts" 'createUser();\n'
  run_in "$directory" check src tests
  assert_no_match 'test-placement' "$OUTPUT"
  assert_match '^codemaster: [0-9]+ errors, [0-9]+ warnings in 2 files$' "$OUTPUT"
  assert_equal 0 "$STATUS"
}

test_a_test_outside_the_source_root_is_not_misplaced() {
  local directory
  directory=$(new_project "$MODULAR")
  put "$directory/src/user/service.ts" "$USER_SERVICE"
  put "$directory/tests/user/service.test.ts" 'createUser();\n'
  put "$directory/scripts/run.test.ts" 'createUser();\n'
  run_in "$directory" check src scripts
  assert_no_match 'test-placement' "$OUTPUT"
  assert_match '^codemaster: [0-9]+ errors, [0-9]+ warnings in 2 files$' "$OUTPUT"
  assert_equal 0 "$STATUS"
}

test_a_maven_test_under_src_test_is_not_misplaced() {
  local directory
  directory=$(new_project '{"layout": "layered"}')
  put "$directory/src/main/java/Billing.java" 'public class Billing {\n  public int total() { return 1; }\n}\n'
  put "$directory/src/test/java/BillingTest.java" 'public class BillingTest {\n  public void testTotal() { new Billing().total(); }\n}\n'
  run_in "$directory" check src
  assert_no_match 'test-placement' "$OUTPUT"
  assert_match '^codemaster: [0-9]+ errors, [0-9]+ warnings in 2 files$' "$OUTPUT"
  assert_equal 0 "$STATUS"
}

test_the_root_tests_folder_is_a_second_folder_when_location_is_dunder_tests() {
  local directory
  directory=$(new_project '{"layout": "modular", "testsLocation": "__tests__"}')
  put "$directory/src/user/service.ts" "$USER_SERVICE"
  put "$directory/tests/x.test.ts" 'createUser();\n'
  run_in "$directory" check src tests
  assert_match '^error test-placement tests/x\.test\.ts:1 second test folder tests; keep all tests in __tests__/$' "$OUTPUT"
}
