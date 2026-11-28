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

test_go_tests_next_to_the_code_are_not_misplaced() {
  local directory
  directory=$(new_project "$MODULAR")
  put "$directory/src/user/service.go" 'package user\n\nfunc CreateUser() int {\n\treturn 1\n}\n'
  put "$directory/src/user/service_test.go" 'package user\n\nimport "testing"\n\nfunc TestCreateUser(suite *testing.T) {\n\tCreateUser()\n}\n'
  run_in "$directory" check src
  assert_no_match 'test-placement' "$OUTPUT"
  assert_match '^codemaster: [0-9]+ errors, [0-9]+ warnings in 2 files$' "$OUTPUT"
  assert_equal 0 "$STATUS"
}

test_a_test_folder_outside_the_source_roots_is_not_misplaced() {
  local directory
  directory=$(new_project "$MODULAR")
  put "$directory/src/user/service.ts" "$USER_SERVICE"
  put "$directory/tests/user/service.test.ts" 'createUser();\n'
  put "$directory/e2e/tests/x.spec.ts" 'createUser();\n'
  run_in "$directory" check src e2e
  assert_no_match 'test-placement' "$OUTPUT"
  assert_match '^codemaster: [0-9]+ errors, [0-9]+ warnings in 2 files$' "$OUTPUT"
  assert_equal 0 "$STATUS"
}

test_a_trailing_slash_in_tests_location_keeps_tests_in_place() {
  local directory
  directory=$(new_project '{"layout": "modular", "testsLocation": "tests/"}')
  put "$directory/src/user/service.ts" "$USER_SERVICE"
  put "$directory/tests/user/service.test.ts" 'createUser();\n'
  run_in "$directory" check src tests
  assert_no_match 'test-placement' "$OUTPUT"
  assert_match '^codemaster: [0-9]+ errors, [0-9]+ warnings in 2 files$' "$OUTPUT"
  assert_equal 0 "$STATUS"
}

test_a_trailing_slash_in_tests_location_gives_single_slash_messages() {
  local directory
  directory=$(new_project '{"layout": "modular", "testsLocation": "tests/"}')
  put "$directory/src/user/service.ts" "$USER_SERVICE"
  put "$directory/src/user/service.test.ts" 'createUser();\n'
  put "$directory/src/order/order.ts" 'export function createOrder() { return 1; }\n'
  put "$directory/src/order/__tests__/order.test.ts" 'createOrder();\n'
  run_in "$directory" check src
  assert_match '^error test-placement src/user/service\.test\.ts:1 test file src/user/service\.test\.ts belongs in tests/user/service\.test\.ts$' "$OUTPUT"
  assert_match '^error test-placement src/order/__tests__/order\.test\.ts:1 second test folder src/order/__tests__; keep all tests in tests/$' "$OUTPUT"
}

test_a_test_in_a_folder_with_a_space_is_misplaced() {
  local directory
  directory=$(new_project "$MODULAR")
  put "$directory/src/my mod/svc.ts" "$USER_SERVICE"
  put "$directory/src/my mod/svc.test.ts" 'createUser();\n'
  run_in "$directory" check src
  assert_match '^error test-placement src/my mod/svc\.test\.ts:1 test file src/my mod/svc\.test\.ts belongs in tests/my mod/svc\.test\.ts$' "$OUTPUT"
}
