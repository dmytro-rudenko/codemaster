# array-repeated-elements: arrays whose elements share one shape ask for a for loop.

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
SUMMARY_ONE_FILE='^codemaster: [0-9]+ errors, [0-9]+ warnings in 1 files$'

array_findings() {
  printf '%s\n' "$1" | grep -c ' array-repeated-elements '
}

test_pairs_of_the_same_shape_ask_for_a_loop() {
  local directory
  directory=$(new_project "$MODULAR")
  put "$directory/src/grid/grid.js" 'export function corners() {\n  return [[0, 0], [0, 1], [1, 0], [1, 1]];\n}\n'
  run_in "$directory" check src
  assert_match '^warning array-repeated-elements src/grid/grid\.js:2 array has 4 elements of the same shape; build it with a for loop$' "$OUTPUT"
  assert_equal 1 "$(array_findings "$OUTPUT")"
}

test_numbers_with_a_constant_step_ask_for_a_loop() {
  local directory
  directory=$(new_project "$MODULAR")
  put "$directory/src/grid/grid.js" 'export function offsets() {\n  return [0, 10, 20, 30, 40];\n}\n'
  run_in "$directory" check src
  assert_match '^warning array-repeated-elements src/grid/grid\.js:2 array has 5 elements of the same shape; build it with a for loop$' "$OUTPUT"
  assert_equal 1 "$(array_findings "$OUTPUT")"
}

test_numbers_without_a_constant_step_stay_quiet() {
  local directory
  directory=$(new_project "$MODULAR")
  put "$directory/src/grid/grid.js" 'export function powers() {\n  return [1, 2, 4, 8, 16];\n}\n'
  run_in "$directory" check src
  assert_not_contains "$OUTPUT" "array-repeated-elements"
  assert_match "$SUMMARY_ONE_FILE" "$OUTPUT"
}

test_a_run_of_same_shape_elements_counts_only_the_run() {
  local directory
  directory=$(new_project "$MODULAR")
  put "$directory/src/grid/grid.js" 'export function cells() {\n  return [[0, 0], [0, 1], [1, 0], [1, 1], [2, 2, 2]];\n}\n'
  run_in "$directory" check src
  assert_match '^warning array-repeated-elements src/grid/grid\.js:2 array has 4 elements of the same shape; build it with a for loop$' "$OUTPUT"
  assert_equal 1 "$(array_findings "$OUTPUT")"
}

test_max_raises_the_limit() {
  local directory
  directory=$(new_project '{"layout": "modular", "rules": {"array-repeated-elements": {"max": 4}}}')
  put "$directory/src/grid/grid.js" 'export function corners() {\n  return [[0, 0], [0, 1], [1, 0], [1, 1]];\n}\n'
  run_in "$directory" check src
  assert_not_contains "$OUTPUT" "array-repeated-elements"
  assert_match "$SUMMARY_ONE_FILE" "$OUTPUT"
}

test_hex_numbers_do_not_make_a_progression() {
  local directory
  directory=$(new_project "$MODULAR")
  put "$directory/src/grid/grid.js" 'export function masks() {\n  return [0x10, 0x20, 0x30, 0x40, 0x50];\n}\n'
  run_in "$directory" check src
  assert_not_contains "$OUTPUT" "array-repeated-elements"
  assert_match "$SUMMARY_ONE_FILE" "$OUTPUT"
}

test_decimal_integers_with_a_step_of_one_ask_for_a_loop() {
  local directory
  directory=$(new_project "$MODULAR")
  put "$directory/src/grid/grid.js" 'export function steps() {\n  return [1, 2, 3, 4, 5];\n}\n'
  run_in "$directory" check src
  assert_match '^warning array-repeated-elements src/grid/grid\.js:2 array has 5 elements of the same shape; build it with a for loop$' "$OUTPUT"
  assert_equal 1 "$(array_findings "$OUTPUT")"
}
