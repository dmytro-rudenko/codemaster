# libraries: the library digest.

SKILL_DIRECTORY=".claude/skills/codemaster-libraries"

test_libraries_lists_what_to_add_remove_and_refresh() {
  local directory
  directory=$(copy_fixture libraries)
  run_in "$directory" libraries
  assert_equal 0 "$STATUS"
  assert_match '^add alpha 1\.2\.0 readme=node_modules/alpha/README\.md homepage=https://alpha\.dev$' "$OUTPUT"
  assert_match '^remove zeta$' "$OUTPUT"
  assert_match '^stale beta 1\.0\.0 -> 2\.1\.0$' "$OUTPUT"
  assert_no_match 'gamma|@types' "$OUTPUT"
}

test_dev_dependencies_are_opt_in() {
  local directory
  directory=$(copy_fixture libraries)
  printf '{"libraryDigestDev": true}' > "$directory/.codemaster.json"
  run_in "$directory" libraries
  assert_match '^add gamma 1\.0\.0 ' "$OUTPUT"
}

test_prune_removes_stale_summaries_and_rebuilds_the_index() {
  local directory index
  directory=$(copy_fixture libraries)
  run_in "$directory" libraries --prune
  assert_no_file "$directory/$SKILL_DIRECTORY/zeta.md"
  index=$(cat "$directory/$SKILL_DIRECTORY/SKILL.md")
  assert_contains "$index" "name: codemaster-libraries"
  assert_contains "$index" "beta"
  assert_not_contains "$index" "zeta"
}

test_a_run_lists_at_most_five_libraries() {
  local directory
  directory=$(copy_fixture libraries-many)
  run_in "$directory" libraries
  assert_equal 5 "$(printf '%s\n' "$OUTPUT" | grep -c '^add ')"
  assert_equal "… and 2 more" "$(printf '%s\n' "$OUTPUT" | tail -n 1)"
}

test_the_digest_can_be_switched_off() {
  local directory
  directory=$(copy_fixture libraries)
  printf '{"libraryDigest": false}' > "$directory/.codemaster.json"
  run_in "$directory" libraries
  assert_equal "libraries: disabled" "$OUTPUT"
}

test_a_missing_manifest_is_reported_and_nothing_pruned() {
  local directory
  directory=$(mktemp -d "$TEST_TMP/empty.XXXXXX")
  run_in "$directory" libraries --prune
  assert_equal 1 "$STATUS"
  assert_contains "$ERRORS" "warning libraries package.json: missing; nothing pruned"
}
