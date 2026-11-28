# The Stop and SessionStart hooks.

SIX_PARAMETERS='export function sixParameters(first: number, second: number, third: number, fourth: number, fifth: number, sixth: number) { return first; }'

prepared_repository() {
  local directory
  directory=$(copy_fixture modular)
  init_repository "$directory"
  if [ "${1:-default}" = "default" ]; then
    printf '{"libraryDigest": false}' > "$directory/.codemaster.json"
  elif [ "$1" != "none" ]; then
    printf '%s' "$1" > "$directory/.codemaster.json"
  fi
  printf '%s\n' "$directory"
}

test_a_changed_file_with_a_violation_blocks_the_stop_once() {
  local directory reason
  directory=$(prepared_repository)
  printf '%s\n' "$SIX_PARAMETERS" >> "$directory/src/user/user.service.ts"
  stop_hook "$directory"
  assert_equal 0 "$STATUS"
  assert_match '^\{"decision":"block","reason":"Run the codemaster skill \(codemaster:codemaster\) for this branch\.' "$OUTPUT"
  reason=$(hook_reason "$OUTPUT")
  assert_match 'max-params src/user/user\.service\.ts:5' "$reason"
  stop_hook "$directory"
  assert_equal 0 "$STATUS"
  assert_equal "" "$OUTPUT"
}

test_the_decision_is_valid_json() {
  local directory
  command -v python3 > /dev/null 2>&1 || skip "python3 is not installed"
  directory=$(prepared_repository)
  printf '%s\n' "$SIX_PARAMETERS" >> "$directory/src/user/user.service.ts"
  stop_hook "$directory"
  printf '%s' "$OUTPUT" | python3 -c 'import json, sys; data = json.load(sys.stdin); assert data["decision"] == "block"' || fail "not valid JSON: $OUTPUT"
}

test_stop_hook_active_records_the_state_without_blocking() {
  local directory
  directory=$(prepared_repository)
  printf '%s\n' "$SIX_PARAMETERS" >> "$directory/src/user/user.service.ts"
  stop_hook "$directory" true
  assert_equal 0 "$STATUS"
  assert_equal "" "$OUTPUT"
  stop_hook "$directory"
  assert_equal "" "$OUTPUT"
}

test_a_package_json_change_alone_runs_the_hook() {
  local directory
  directory=$(prepared_repository)
  printf '{\n  "name": "modular-fixture",\n  "dependencies": {\n    "axios": "1.0.0"\n  }\n}\n' > "$directory/package.json"
  stop_hook "$directory"
  assert_equal 0 "$STATUS"
  assert_contains "$OUTPUT" '"decision":"block"'
  assert_contains "$(hook_reason "$OUTPUT")" "simple-package package.json:4"
}

test_hook_false_in_the_shared_or_the_local_config_silences_it() {
  local shared local_directory
  shared=$(prepared_repository '{"hook": false}')
  printf '%s\n' "$SIX_PARAMETERS" >> "$shared/src/user/user.service.ts"
  stop_hook "$shared"
  assert_equal 0 "$STATUS"
  assert_equal "" "$OUTPUT"
  local_directory=$(prepared_repository)
  printf '%s\n' "$SIX_PARAMETERS" >> "$local_directory/src/user/user.service.ts"
  printf '{"hook": false}' > "$local_directory/.codemaster.local.json"
  stop_hook "$local_directory"
  assert_equal "" "$OUTPUT"
  printf '{"hook": true}' > "$local_directory/.codemaster.local.json"
  stop_hook "$local_directory"
  assert_contains "$OUTPUT" '"decision":"block"'
}

test_outside_git_the_hook_is_silent() {
  local directory
  directory=$(mktemp -d "$TEST_TMP/plain.XXXXXX")
  printf '%s\n' "$SIX_PARAMETERS" > "$directory/a.ts"
  stop_hook "$directory"
  assert_equal 0 "$STATUS"
  assert_equal "" "$OUTPUT"
}

test_the_first_run_writes_the_project_profile_and_shows_it() {
  local directory reason
  directory=$(prepared_repository none)
  printf '%s\n' "$SIX_PARAMETERS" >> "$directory/src/user/user.service.ts"
  stop_hook "$directory"
  assert_equal 0 "$STATUS"
  reason=$(hook_reason "$OUTPUT")
  assert_contains "$reason" "codemaster profile:"
  assert_match '  layout = "modular"  \(auto\)' "$reason"
  assert_file "$directory/.codemaster.json"
  assert_contains "$(cat "$directory/.codemaster.json")" '"sources": {'
}

test_a_failed_install_never_breaks_the_session() {
  local directory data
  directory=$(prepared_repository)
  data=$(mktemp -d "$TEST_TMP/data.XXXXXX")
  printf '%s\n' "$SIX_PARAMETERS" >> "$directory/src/user/user.service.ts"
  OUTPUT=$(printf '{"cwd": "%s"}' "$directory" | env -u CODEMASTER_AST_GREP CODEMASTER_DATA_DIR="$data" CODEMASTER_REGISTRY="http://127.0.0.1:9" PATH="/usr/bin:/bin" "$CODEMASTER" hook-stop 2> "$TEST_TMP/stderr")
  STATUS=$?
  assert_equal 0 "$STATUS"
  assert_equal "" "$OUTPUT"
  assert_match '^codemaster: install failed' "$(cat "$TEST_TMP/stderr")"
  OUTPUT=$(printf '{"cwd": "%s"}' "$directory" | env -u CODEMASTER_AST_GREP CODEMASTER_DATA_DIR="$data" CODEMASTER_REGISTRY="http://127.0.0.1:9" PATH="/usr/bin:/bin" "$CODEMASTER" hook-stop 2> "$TEST_TMP/stderr")
  assert_match '^codemaster: install failed recently' "$(cat "$TEST_TMP/stderr")"
}

test_a_later_stop_reports_only_the_file_changed_since_the_last_check() {
  local directory reason
  directory=$(prepared_repository)
  printf '%s\n' "$SIX_PARAMETERS" >> "$directory/src/user/user.service.ts"
  stop_hook "$directory"
  assert_contains "$(hook_reason "$OUTPUT")" "src/user/user.service.ts"
  printf '%s\n' "$SIX_PARAMETERS" >> "$directory/src/order/order.service.ts"
  stop_hook "$directory"
  reason=$(hook_reason "$OUTPUT")
  assert_contains "$reason" "max-params src/order/order.service.ts"
  assert_not_contains "$reason" "user.service.ts"
}

test_the_hook_reads_other_languages() {
  local directory
  directory=$(prepared_repository)
  printf 'def create(first, second, third, fourth, fifth, sixth):\n    return first\n' > "$directory/src/user/user.service.py"
  stop_hook "$directory"
  assert_contains "$(hook_reason "$OUTPUT")" "max-params src/user/user.service.py:1"
}

test_session_start_names_the_layout() {
  local directory
  directory=$(prepared_repository)
  OUTPUT=$(printf '{"cwd": "%s"}' "$directory" | "$CODEMASTER" hook-session-start)
  STATUS=$?
  assert_equal 0 "$STATUS"
  assert_contains "$OUTPUT" "codemaster: layout=modular, sourceRoot=src"
}

test_a_stylesheet_change_alone_runs_the_hook() {
  local directory
  directory=$(prepared_repository)
  mkdir -p "$directory/src/button"
  printf '.button { color: red; }\n' > "$directory/src/button/button.styles.css"
  stop_hook "$directory"
  assert_equal 0 "$STATUS"
  assert_contains "$OUTPUT" '"decision":"block"'
  assert_contains "$(hook_reason "$OUTPUT")" "file-name-suffix src/button/button.styles.css:1"
}

test_a_reported_stylesheet_is_not_repeated_when_only_a_source_changes() {
  local directory reason
  directory=$(prepared_repository)
  mkdir -p "$directory/src/button"
  printf '.button { color: red; }\n' > "$directory/src/button/button.styles.css"
  printf '%s\n' "$SIX_PARAMETERS" >> "$directory/src/user/user.service.ts"
  stop_hook "$directory"
  assert_contains "$(hook_reason "$OUTPUT")" "file-name-suffix src/button/button.styles.css:1"
  printf '%s\n' "$SIX_PARAMETERS" >> "$directory/src/order/order.service.ts"
  stop_hook "$directory"
  reason=$(hook_reason "$OUTPUT")
  assert_contains "$reason" "max-params src/order/order.service.ts"
  assert_not_contains "$reason" "button.styles.css"
}
