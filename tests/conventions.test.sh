# conventions: the project profile.

profile_value() {
  awk -f "$PLUGIN_ROOT/lib/awk/json.awk" "$1/.codemaster.json" | awk -F '\t' -v path="$2" '$1 == path { print $3 }'
}

test_conventions_learn_the_folder_names_tests_and_constant_case() {
  local directory
  directory=$(copy_fixture conventions)
  run_in "$directory" conventions --refresh
  assert_equal 0 "$STATUS"
  assert_contains "$OUTPUT" "codemaster profile:"
  assert_contains "$OUTPUT" 'layout = "layered"'
  assert_equal "services" "$(profile_value "$directory" roles/module/0)"
  assert_equal "types" "$(profile_value "$directory" roles/interfaces/0)"
  assert_equal "" "$(profile_value "$directory" roles/interfaces/1)"
  assert_equal "constants" "$(profile_value "$directory" roles/consts/0)"
  assert_equal "__tests__" "$(profile_value "$directory" testsLocation)"
  assert_equal "spec" "$(profile_value "$directory" testSuffix)"
  assert_equal "camel" "$(profile_value "$directory" constantCase)"
  assert_match '^dominant' "$(profile_value "$directory" sources/constantCase)"
  run_in "$directory" check src
  assert_match '^error layout-forbidden-declaration src/services/user/user\.service\.ts:1 .*types' "$OUTPUT"
}

test_too_few_cases_keep_the_default() {
  local directory
  directory=$(copy_fixture conventions-weak)
  run_in "$directory" conventions --refresh
  assert_equal "upper-snake" "$(profile_value "$directory" constantCase)"
  assert_equal "default" "$(profile_value "$directory" sources/constantCase)"
}

test_a_field_the_user_wrote_survives_a_refresh() {
  local directory
  directory=$(copy_fixture conventions)
  printf '{"sourceRoot": "src", "constantCase": "upper-snake"}' > "$directory/.codemaster.json"
  run_in "$directory" conventions --refresh
  assert_equal 0 "$STATUS"
  assert_equal "upper-snake" "$(profile_value "$directory" constantCase)"
  assert_equal "types" "$(profile_value "$directory" roles/interfaces/0)"
  run_in "$directory" conventions
  assert_contains "$OUTPUT" 'constantCase = "upper-snake"  (user)'
}

test_the_projects_eslint_limits_replace_codemaster_defaults() {
  local directory
  directory=$(copy_fixture eslint)
  run_in "$directory" conventions --refresh
  assert_equal "3" "$(profile_value "$directory" rules/max-params/max)"
  assert_equal "off" "$(profile_value "$directory" rules/prefer-destructuring)"
  run_in "$directory" check src
  assert_contains "$(triples "$OUTPUT")" "max-params src/modules/user.ts:1"
  assert_not_contains "$OUTPUT" "prefer-destructuring"
}

test_eslint_is_not_run_without_refresh() {
  local directory
  directory=$(copy_fixture eslint)
  run_in "$directory" conventions
  assert_contains "$ERRORS" "warning conventions eslint: skipped; run conventions --refresh to read it"
  assert_equal "" "$(profile_value "$directory" rules/max-params/max)"
}

test_a_monorepo_gets_one_root_per_package() {
  local directory
  directory=$(mktemp -d "$TEST_TMP/mono.XXXXXX")
  mkdir -p "$directory/api/src" "$directory/worker"
  printf '{}' > "$directory/api/package.json"
  printf 'module worker\n' > "$directory/worker/go.mod"
  printf 'package main\n' > "$directory/worker/main.go"
  run_in "$directory" conventions
  assert_equal "api/src" "$(profile_value "$directory" sourceRoot/0)"
  assert_equal "worker" "$(profile_value "$directory" sourceRoot/1)"
  assert_equal "packages: api, worker" "$(profile_value "$directory" sources/sourceRoot)"
}
