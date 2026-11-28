# lookup-chain: if branches comparing one name with literals and returning literals.

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

ELSE_CHAIN='export function sizeOf(kind) {\n  if (kind === "s") {\n    return 1;\n  } else if (kind === "m") {\n    return 2;\n  } else if (kind === "l") {\n    return 3;\n  } else if (kind === "xl") {\n    return 4;\n  }\n  return 0;\n}\n'

lookup_findings() {
  printf '%s\n' "$OUTPUT" | grep -c ' lookup-chain '
}

test_an_else_if_chain_asks_for_a_lookup_table() {
  local directory
  directory=$(new_project '{"layout": "modular"}')
  put "$directory/src/size/size.js" "$ELSE_CHAIN"
  run_in "$directory" check src
  assert_match '^warning lookup-chain src/size/size\.js:2 4 if branches compare kind with literals; use a lookup table$' "$OUTPUT"
  assert_equal 1 "$(lookup_findings)"
}

test_two_variables_do_not_make_a_chain() {
  local directory
  directory=$(new_project '{"layout": "modular"}')
  put "$directory/src/size/size.js" 'export function sizeOf(kind, mode) {\n  if (kind === "s") {\n    return 1;\n  }\n  if (mode === "m") {\n    return 2;\n  }\n  if (kind === "l") {\n    return 3;\n  }\n  if (mode === "xl") {\n    return 4;\n  }\n  return 0;\n}\n'
  run_in "$directory" check src
  assert_equal 0 "$(lookup_findings)"
  assert_match '^codemaster: [0-9]+ errors, [0-9]+ warnings in 1 files$' "$OUTPUT"
}

test_bodies_that_call_a_function_do_not_make_a_chain() {
  local directory
  directory=$(new_project '{"layout": "modular"}')
  put "$directory/src/size/size.js" 'export function sizeOf(kind) {\n  if (kind === "s") {\n    return compute(1);\n  }\n  if (kind === "m") {\n    return compute(2);\n  }\n  if (kind === "l") {\n    return compute(3);\n  }\n  if (kind === "xl") {\n    return compute(4);\n  }\n  return 0;\n}\nfunction compute(value) { return value; }\n'
  run_in "$directory" check src
  assert_equal 0 "$(lookup_findings)"
  assert_match '^codemaster: [0-9]+ errors, [0-9]+ warnings in 1 files$' "$OUTPUT"
}

test_a_consts_file_is_not_checked() {
  local directory
  directory=$(new_project '{"layout": "modular"}')
  put "$directory/src/size/consts.js" "$ELSE_CHAIN"
  run_in "$directory" check src
  assert_equal 0 "$(lookup_findings)"
  assert_match '^codemaster: [0-9]+ errors, [0-9]+ warnings in 1 files$' "$OUTPUT"
}

test_the_rule_can_be_switched_off() {
  local directory
  directory=$(new_project '{"layout": "modular", "rules": {"lookup-chain": "off"}}')
  put "$directory/src/size/size.js" "$ELSE_CHAIN"
  run_in "$directory" check src
  assert_equal 0 "$(lookup_findings)"
  assert_match '^codemaster: [0-9]+ errors, [0-9]+ warnings in 1 files$' "$OUTPUT"
}

test_a_python_elif_chain_asks_for_a_lookup_table() {
  local directory
  directory=$(new_project '{"layout": "modular"}')
  put "$directory/src/size/size.py" 'def size_of(kind):\n    if kind == "s":\n        return 1\n    elif kind == "m":\n        return 2\n    elif kind == "l":\n        return 3\n    elif kind == "xl":\n        return 4\n    return 0\n'
  run_in "$directory" check src
  assert_match '^warning lookup-chain src/size/size\.py:2 4 if branches compare kind with literals; use a lookup table$' "$OUTPUT"
  assert_equal 1 "$(lookup_findings)"
}
