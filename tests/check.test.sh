# check: the deterministic rules over TypeScript fixtures.

test_modular_fixture_reports_exactly_the_planted_violations() {
  local directory expected
  directory=$(copy_fixture modular)
  run_in "$directory" check src scripts
  assert_equal 1 "$STATUS"
  expected="global-function scripts/run.ts:1
helpers-only-functions src/user/user.helpers.ts:1
layout-forbidden-declaration src/user/user.service.ts:1
layout-forbidden-declaration src/user/user.service.ts:4
max-call-nesting src/old/legacy.ts:2
max-nesting src/order/order.service.ts:7
max-params src/old/legacy.ts:1
max-params src/user/user.service.ts:3
name-abbreviation src/user/user.service.ts:4
name-entity-prefix src/user/user.consts.ts:1
name-entity-prefix src/user/user.interfaces.ts:1
prefer-destructuring src/user/user.helpers.ts:3
single-file-module-size src/big.ts:1
test-mirror src/order/order.service.ts:1"
  assert_equal "$expected" "$(triples "$OUTPUT")"
  assert_match '^error test-mirror src/order/order\.service\.ts:1 ' "$OUTPUT"
}

test_plain_output_ends_with_the_summary_line() {
  local directory
  directory=$(copy_fixture modular)
  run_in "$directory" check src
  assert_equal 1 "$STATUS"
  assert_match '^codemaster: [0-9]+ errors, [0-9]+ warnings in [0-9]+ files$' "$(printf '%s\n' "$OUTPUT" | tail -n 1)"
  assert_match '^error max-params src/user/user\.service\.ts:3 ' "$OUTPUT"
}

test_json_output() {
  local directory
  directory=$(copy_fixture off)
  run_in "$directory" check --json src
  assert_equal 1 "$STATUS"
  assert_equal '{"findings":[{"severity":"error","ruleId":"max-params","file":"src/pages/home.ts","line":1,"message":"function renderHome has 6 parameters (max 5)"}],"summary":{"errors":1,"warnings":0,"files":2}}' "$OUTPUT"
}

test_layered_fixture() {
  local directory found
  directory=$(copy_fixture layered)
  run_in "$directory" check src
  found=$(triples "$OUTPUT")
  assert_contains "$found" "layout-forbidden-declaration src/modules/order/order.ts:1"
  assert_contains "$found" "helpers-mixed-kind src/helpers/fetch-user.ts:1"
  assert_contains "$found" "simple-package package.json:3"
  assert_match '^warning test-mirror src/utils/format\.ts:1 ' "$OUTPUT"
  assert_not_contains "$OUTPUT" "src/modules/user.ts"
}

test_a_project_without_a_layout_gets_only_function_rules() {
  local directory
  directory=$(copy_fixture off)
  run_in "$directory" check src
  assert_equal "max-params src/pages/home.ts:1" "$(triples "$OUTPUT")"
}

test_check_without_paths_covers_changed_files_and_all_covers_every_file() {
  local directory
  directory=$(copy_fixture modular)
  init_repository "$directory"
  printf "export const userName = 'x';\n" >> "$directory/src/user/user.service.ts"
  run_in "$directory" check
  assert_match 'src/user/user\.service\.ts' "$OUTPUT"
  assert_no_match '^(error|warning) [^ ]+ src/(old|order)/' "$OUTPUT"
  run_in "$directory" check --all
  assert_match 'src/old/legacy\.ts' "$OUTPUT"
}

test_data_constants_are_forbidden_in_a_module_objects_are_allowed() {
  local directory lines
  directory=$(copy_fixture modular)
  printf 'export const router = Router();\nexport const cache = new Map();\nexport const USER_ROLES = ["a"] as const;\n' >> "$directory/src/user/user.service.ts"
  run_in "$directory" check src/user/user.service.ts
  lines=$(printf '%s\n' "$OUTPUT" | awk '$2 == "layout-forbidden-declaration" { split($3, parts, ":"); print parts[2] }' | sort -n | tr '\n' ' ')
  assert_equal "1 4 7 " "$lines"
}

test_check_outside_git_without_paths_explains_itself() {
  local directory
  directory=$(copy_fixture off)
  run_in "$directory" check
  assert_equal 0 "$STATUS"
  assert_contains "$OUTPUT" "codemaster: not a git repository; pass paths"
}

test_a_path_without_source_files_is_an_error() {
  local directory
  directory=$(copy_fixture off)
  run_in "$directory" check nowhere
  assert_equal 2 "$STATUS"
  assert_contains "$OUTPUT" "codemaster: no source files match nowhere"
}

test_rule_settings_switch_a_rule_off_or_raise_its_limit() {
  local directory
  directory=$(copy_fixture off)
  printf 'export const userAccountProfileDisplayName = "x";\n' > "$directory/src/pages/profile.ts"
  run_in "$directory" check src
  assert_contains "$(triples "$OUTPUT")" "name-word-count src/pages/profile.ts:1"
  printf '{"rules": {"max-params": "off", "name-word-count": {"max": 5}}}' > "$directory/.codemaster.json"
  run_in "$directory" check src
  assert_equal "" "$(triples "$OUTPUT")"
  assert_equal 0 "$STATUS"
}

test_rule_reason_and_severity_reach_the_json_output() {
  local directory
  directory=$(copy_fixture off)
  printf '{"rules": {"max-params": {"severity": "warning", "reason": "handlers take six"}}}' > "$directory/.codemaster.json"
  run_in "$directory" check --json src
  assert_equal 0 "$STATUS"
  assert_contains "$OUTPUT" '"severity":"warning","ruleId":"max-params"'
  assert_contains "$OUTPUT" '"reason":"handlers take six"'
}

test_config_problems_are_reported_and_defaults_kept() {
  local directory
  directory=$(copy_fixture off)
  printf '{"layout": "flat", "singleFileMaxLines": "many", "rules": {"max-params": 3}}' > "$directory/.codemaster.json"
  run_in "$directory" check src
  assert_contains "$OUTPUT" "warning config layout: expected one of auto|modular|layered|off"
  assert_contains "$OUTPUT" "warning config singleFileMaxLines: expected number"
  assert_contains "$OUTPUT" 'warning config rules.max-params: expected "off", a severity or {severity, max, reason}'
  assert_contains "$OUTPUT" "max-params src/pages/home.ts:1"
}

test_invalid_config_json_is_a_warning() {
  local directory
  directory=$(copy_fixture off)
  printf '{"hook": ' > "$directory/.codemaster.json"
  run_in "$directory" check src
  assert_contains "$OUTPUT" "warning config .codemaster.json: invalid JSON"
}

test_exclude_skips_files() {
  local directory
  directory=$(copy_fixture off)
  printf '{"exclude": ["src/pages/**"]}' > "$directory/.codemaster.json"
  run_in "$directory" check src
  assert_not_contains "$OUTPUT" "home.ts"
}

test_the_plugin_passes_its_own_checks() {
  run_in "$PLUGIN_ROOT" check lib
  assert_match '^codemaster: 0 errors' "$(printf '%s\n' "$OUTPUT" | tail -n 1)"
}
