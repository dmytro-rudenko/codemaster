# tournament: candidates, runners in each language, scoring.

result_field() {
  awk -f "$PLUGIN_ROOT/lib/awk/json.awk" "$1/result.json" | awk -F '\t' -v path="$2" '$1 == path { print $3 }'
}

need_node_for_typescript() {
  command -v node > /dev/null 2>&1 || skip "node is not installed"
  node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 18) ? 0 : 1)' || skip "node 22.18 or newer is needed for TypeScript variants"
}

test_a_wrong_variant_drops_out_and_a_correct_one_wins() {
  local directory
  need_node_for_typescript
  directory=$(copy_fixture tournament/good)
  run_in "$PLUGIN_ROOT" tournament "$directory"
  assert_equal 0 "$STATUS"
  assert_match '^winner: (readable|first)$' "$OUTPUT"
  assert_equal "false" "$(result_field "$directory" variants/2/passed)"
  assert_equal "optimized" "$(result_field "$directory" variants/2/variant)"
  assert_match '^[0-9.]+$' "$(result_field "$directory" variants/0/metrics/bytecodePerToken)"
  assert_match '^[0-9]+$' "$(result_field "$directory" variants/0/metrics/bytecode)"
  assert_match '^[0-9]+$' "$(result_field "$directory" variants/0/metrics/desugared)"
  assert_match '^[0-9.]+$' "$(result_field "$directory" variants/0/metrics/speed)"
}

test_benchmark_false_skips_the_speed_metric() {
  local directory
  need_node_for_typescript
  directory=$(copy_fixture tournament/no-bench)
  run_in "$PLUGIN_ROOT" tournament "$directory"
  assert_equal 0 "$STATUS"
  assert_no_match '^winner: none' "$OUTPUT"
  assert_equal "null" "$(result_field "$directory" variants/0/metrics/speed)"
  assert_equal "null" "$(result_field "$directory" variants/1/metrics/speed)"
}

test_all_variants_wrong_means_no_winner() {
  local directory
  need_node_for_typescript
  directory=$(copy_fixture tournament/all-bad)
  run_in "$PLUGIN_ROOT" tournament "$directory"
  assert_equal 1 "$STATUS"
  assert_match '^winner: none$' "$OUTPUT"
}

run_language_tournament() {
  local fixture="$1" command="$2" directory
  command -v "$command" > /dev/null 2>&1 || skip "$command is not installed"
  directory=$(copy_fixture "tournament/$fixture")
  run_in "$PLUGIN_ROOT" tournament "$directory"
  assert_equal 0 "$STATUS"
  assert_match '^winner: (readable|first)$' "$OUTPUT"
  assert_equal "false" "$(result_field "$directory" variants/2/passed)"
  assert_match 'expected 6' "$(result_field "$directory" variants/2/failure)"
  RESULT_DIRECTORY="$directory"
}

test_python_variants_compete() {
  run_language_tournament python python3
  assert_match '^[0-9]+$' "$(result_field "$RESULT_DIRECTORY" variants/0/metrics/bytecode)"
}

test_ruby_variants_compete() {
  run_language_tournament ruby ruby
  assert_match '^[0-9]+$' "$(result_field "$RESULT_DIRECTORY" variants/0/metrics/bytecode)"
}

test_php_variants_compete() {
  run_language_tournament php php
  assert_equal "null" "$(result_field "$RESULT_DIRECTORY" variants/0/metrics/bytecode)"
}

test_go_variants_compete() {
  run_language_tournament go go
}

test_candidates_are_non_trivial_changed_functions_without_tsx_and_this_methods() {
  local directory
  directory=$(copy_fixture candidates)
  init_repository "$directory" no-commit
  run_in "$directory" tournament --candidates
  assert_equal 0 "$STATUS"
  if command -v node > /dev/null 2>&1 && node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 18) ? 0 : 1)'; then
    assert_match '^src/math\.ts:1 scoreValues complexity=[0-9]+ lines=[0-9]+$' "$OUTPUT"
  fi
  if command -v python3 > /dev/null 2>&1; then
    assert_match '^src/rank\.py:1 rank_values complexity=[0-9]+ lines=[0-9]+$' "$OUTPUT"
  fi
  assert_no_match 'renderWidget|Counter\.bump|Ranker' "$OUTPUT"
}

test_skip_records_a_function_with_its_reason() {
  local directory state
  directory=$(copy_fixture candidates)
  init_repository "$directory" no-commit
  run_in "$directory" tournament --skip "src/math.ts#scoreValues" --reason closure
  assert_equal 0 "$STATUS"
  state=$(cat "$directory/.git/codemaster/tournament-done.json")
  assert_contains "$state" '"key": "src/math.ts#scoreValues"'
  assert_contains "$state" '"skipped": true'
  assert_contains "$state" '"reason": "closure"'
  run_in "$directory" tournament --candidates
  assert_not_contains "$OUTPUT" "scoreValues"
}

test_done_hides_a_function_until_its_body_changes() {
  local directory target
  command -v python3 > /dev/null 2>&1 || skip "python3 is not installed"
  directory=$(copy_fixture candidates)
  init_repository "$directory" no-commit
  target=$(mktemp -d "$TEST_TMP/target.XXXXXX")
  printf '{"file": "src/rank.py", "functionName": "rank_values"}' > "$target/target.json"
  run_in "$directory" tournament --done "$target"
  assert_equal 0 "$STATUS"
  run_in "$directory" tournament --candidates
  assert_not_contains "$OUTPUT" "rank_values"
  printf '    # changed\n' >> "$directory/src/rank.py"
  sed -i.bak 's/score += 2/score += 3/' "$directory/src/rank.py"
  run_in "$directory" tournament --candidates
  assert_contains "$OUTPUT" "rank_values"
}

test_usage_errors() {
  run_in "$PLUGIN_ROOT" tournament
  assert_equal 2 "$STATUS"
  assert_contains "$ERRORS" "usage: codemaster tournament"
}
