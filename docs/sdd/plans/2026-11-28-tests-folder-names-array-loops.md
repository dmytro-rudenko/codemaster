# Tests in one folder, tests only for functions, suffix-free names, loops and lookup tables, limits of 4 — implementation plan

**Goal:** codemaster keeps every test in one `tests/` folder (`test-placement`), asks for tests only for files with functions, flags `*.consts.*` / `*.interfaces.*` / `*.styles.css` names (`file-name-suffix`), flags long arrays of same-shaped elements (`array-repeated-elements`) and if-return chains (`lookup-chain`), has default limits of 4 for nesting and name words, and its own awk code uses lookup tables instead of if-chains.
**Spec:** docs/sdd/specs/2026-11-28-tests-folder-names-array-loops.md (sections 3.6 `lookup-chain` and 3.7 awk refactor are added by Task 7, from this plan)
**Verification:** `bash tests/run.sh`, last line `<N> passed, 0 failed, 0 skipped`.
**dryer:** no duplicate candidates (bash/awk unsupported; unchecked: 2 JS files).

## Global constraints
- Stack: bash 3.2-compatible scripts, POSIX awk run with `LC_ALL=C` (`cm_awk`), ast-grep tree dumps. Tests: `tests/*.test.sh`, functions `test_*`, helpers in `tests/lib.sh` (`run_in`, `copy_fixture`, `triples`, `assert_*`, `$TEST_TMP`).
- Findings from shell-side checks are raw lines `path<TAB>line<TAB>severity<TAB>rule<TAB>message` appended to `$CM_TMP/findings.raw`; `lib/awk/report.awk` applies `rules.<id>` (off / severity). Findings from `analyze.awk` go through `finding(severity, rule, line, message)`.
- Rule ids and severities: `test-placement` error; `file-name-suffix` warning; `array-repeated-elements` warning, `max` 3; `lookup-chain` warning, `max` 3; `max-nesting` default `max` 4; `name-word-count` default `max` 4.
- `testsLocation` default `"tests"`; `"colocated"` → `warning config testsLocation: "colocated" is not supported, using "tests"`; `""` (old profiles) behaves as `tests`.
- Exact messages:
  - `test file <path> belongs in <location>/<path relative to source root>`
  - `second test folder <folder>; keep all tests in <location>/`
  - `rename to <path>`
  - `array has <N> elements of the same shape; build it with a for loop`
  - `<N> if branches compare <name> with literals; use a lookup table`
- Codex mode `explore`: every task `**Executor:** claude`.
- Environment limits: nproc 4, memory 16087 MB, timeout not found.

Constraint check: 6 constraints, no end-state constraint beyond the green suite; covered by Task 0: all acceptance tests.

## Review Focus
- A non-test-named helper in `tests/helpers/setup.ts` → role `test` by folder, no `test-placement`.
- A Ruby project with root `spec/` and default `testsLocation` → flagged as a second test folder (conventions picks `spec` when dominant).
- An old profile with `"testsLocation": ""` → behaves as `tests`, no warning.
- `.css` under `node_modules/` or `dist/` → never selected.
- An else-if chain (`if … else if …`) of 4 literal returns → counted by `lookup-chain` like sibling ifs.

## Waves
| Wave | Tasks | Why together |
|---|---|---|
| 0 | 0 | alone — acceptance tests, red until the last wave |
| 1 | 1 | alone — config defaults and the fixture move every later task relies on |
| 2 | 2, 3, 7, 8 | disjoint: analyze.awk+polyglot / placement.awk+roles.awk+check.sh / docs+spec / lang.awk+mirror.awk |
| 3 | 4 | alone — writes analyze.awk (2), check.sh (3), mirror.awk (8) |
| 4 | 5, 6 | disjoint: names.awk+files+check.sh+hook.sh / analyze.awk |
| 5 | 9 | alone — analyze.awk after 6 |

Serialized because of shared files: `lib/awk/analyze.awk` (2 → 4 → 6 → 9), `lib/check.sh` (3 → 4 → 5), `lib/awk/mirror.awk` (1 → 8 → 4), `lib/awk/lang.awk` (8 → 5), `tests/check.test.sh` (2 → 5).

---

### Task 0: acceptance tests

**Writes:** `tests/acceptance.test.sh`
**Executor:** claude
**Covers:** every bullet of spec §6 Verification, plus the lookup-chain rule and the awk refactor.

- [x] **Step 1: write the acceptance tests** — `tests/acceptance.test.sh`:

```bash
# Acceptance: one tests folder, tests only for functions, suffix-free names, loops and lookup tables, limits of 4.

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

profile_field() {
  awk -f "$PLUGIN_ROOT/lib/awk/json.awk" "$1/.codemaster.json" | awk -F '\t' -v path="$2" '$1 == path { print $3 }'
}

MODULAR='{"layout": "modular"}'
USER_SERVICE='export function createUser() { return 1; }\n'

test_modular_fixture_has_tests_in_one_folder_and_plain_names() {
  local directory
  directory=$(copy_fixture modular)
  assert_file "$directory/tests/user/user.service.test.ts"
  assert_no_file "$directory/src/user/user.service.test.ts"
  assert_file "$directory/src/user/consts.ts"
  assert_file "$directory/src/user/interfaces.ts"
  run_in "$directory" check --json src scripts tests
  assert_not_contains "$OUTPUT" '"ruleId":"test-placement"'
  assert_not_contains "$OUTPUT" '"ruleId":"file-name-suffix"'
}

test_a_test_next_to_the_code_is_misplaced() {
  local directory
  directory=$(new_project "$MODULAR")
  put "$directory/src/user/service.ts" "$USER_SERVICE"
  put "$directory/src/user/service.test.ts" 'createUser();\n'
  run_in "$directory" check src
  assert_match '^error test-placement src/user/service\.test\.ts:1 test file src/user/service\.test\.ts belongs in tests/user/service\.test\.ts$' "$OUTPUT"
}

test_a_second_test_folder_is_misplaced() {
  local directory
  directory=$(new_project "$MODULAR")
  put "$directory/src/user/service.ts" "$USER_SERVICE"
  put "$directory/tests/user/service.test.ts" 'createUser();\n'
  put "$directory/src/user/__tests__/service.test.ts" 'createUser();\n'
  run_in "$directory" check src tests
  assert_match '^error test-placement src/user/__tests__/service\.test\.ts:1 second test folder src/user/__tests__; keep all tests in tests/$' "$OUTPUT"
  assert_no_match 'test-placement tests/' "$OUTPUT"
}

test_go_tests_stay_next_to_the_code() {
  local directory
  directory=$(copy_fixture polyglot)
  run_in "$directory" check src
  assert_no_match 'test-placement src/modules/go/' "$OUTPUT"
}

test_consts_interfaces_and_styles_have_no_suffix() {
  local directory
  directory=$(new_project "$MODULAR")
  put "$directory/src/user/service.ts" "$USER_SERVICE"
  put "$directory/src/user/user.consts.ts" 'export const USER_LIMIT = 1;\n'
  put "$directory/src/user/user.interfaces.ts" 'export interface UserAccount { name: string }\n'
  put "$directory/src/button/button.styles.css" '.button { color: red; }\n'
  put "$directory/src/card/card.module.css" '.card { color: red; }\n'
  put "$directory/src/panel/panel.css" '.panel { color: red; }\n'
  run_in "$directory" check src
  assert_match '^warning file-name-suffix src/user/user\.consts\.ts:1 rename to src/user/consts\.ts$' "$OUTPUT"
  assert_match '^warning file-name-suffix src/user/user\.interfaces\.ts:1 rename to src/user/interfaces\.ts$' "$OUTPUT"
  assert_match '^warning file-name-suffix src/button/button\.styles\.css:1 rename to src/button/button\.css$' "$OUTPUT"
  assert_match '^warning file-name-suffix src/card/card\.module\.css:1 rename to src/card/card\.css$' "$OUTPUT"
  assert_no_match 'file-name-suffix src/panel/' "$OUTPUT"
}

test_layered_consts_drop_the_suffix_and_keep_the_entity() {
  local directory
  directory=$(new_project '{"layout": "layered"}')
  put "$directory/src/modules/user.ts" "$USER_SERVICE"
  put "$directory/src/consts/user.consts.ts" 'export const USER_LIMIT = 1;\n'
  run_in "$directory" check src
  assert_match '^warning file-name-suffix src/consts/user\.consts\.ts:1 rename to src/consts/user\.ts$' "$OUTPUT"
}

test_file_name_suffix_can_be_switched_off() {
  local directory
  directory=$(new_project '{"layout": "modular", "rules": {"file-name-suffix": "off"}}')
  put "$directory/src/user/service.ts" "$USER_SERVICE"
  put "$directory/src/user/user.consts.ts" 'export const USER_LIMIT = 1;\n'
  run_in "$directory" check src
  assert_not_contains "$OUTPUT" "file-name-suffix"
}

test_repeated_array_elements_ask_for_a_loop() {
  local directory
  directory=$(new_project "$MODULAR")
  put "$directory/src/menu/menu.tsx" 'export function renderMenu() {\n  return [\n    <li className="item">One</li>,\n    <li className="item">Two</li>,\n    <li className="item">Three</li>,\n    <li className="item">Four</li>,\n  ];\n}\n'
  put "$directory/src/order/order.ts" 'export function listRows() {\n  return [{ id: 1, label: "a" }, { id: 2, label: "b" }, { id: 3, label: "c" }, { id: 4, label: "d" }];\n}\n'
  put "$directory/src/page/page.ts" 'export function pageNumbers() {\n  return [1, 2, 3, 4, 5];\n}\n'
  put "$directory/src/report/report.py" 'def build_rows():\n    return [{"id": 1}, {"id": 2}, {"id": 3}, {"id": 4}]\n'
  run_in "$directory" check src
  assert_match '^warning array-repeated-elements src/menu/menu\.tsx:2 array has 4 elements of the same shape; build it with a for loop$' "$OUTPUT"
  assert_match '^warning array-repeated-elements src/order/order\.ts:2 array has 4 elements of the same shape; build it with a for loop$' "$OUTPUT"
  assert_match '^warning array-repeated-elements src/page/page\.ts:2 array has 5 elements of the same shape; build it with a for loop$' "$OUTPUT"
  assert_match '^warning array-repeated-elements src/report/report\.py:2 array has 4 elements of the same shape; build it with a for loop$' "$OUTPUT"
}

test_plain_data_arrays_stay_quiet() {
  local directory
  directory=$(new_project "$MODULAR")
  put "$directory/src/word/word.ts" 'export function listWords() {\n  return ["a", "b", "c", "d"];\n}\nexport function listThree() {\n  return [{ id: 1 }, { id: 2 }, { id: 3 }];\n}\n'
  put "$directory/src/menu/consts.ts" 'export const MENU_ROWS = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];\n'
  put "$directory/tests/menu/menu.test.ts" 'const rows = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];\n'
  run_in "$directory" check src tests
  assert_not_contains "$OUTPUT" "array-repeated-elements"
  printf '{"layout": "modular", "rules": {"array-repeated-elements": "off"}}' > "$directory/.codemaster.json"
  put "$directory/src/page/page.ts" 'export function pageNumbers() {\n  return [1, 2, 3, 4, 5];\n}\n'
  run_in "$directory" check src
  assert_not_contains "$OUTPUT" "array-repeated-elements"
}

test_if_chains_over_literals_ask_for_a_lookup_table() {
  local directory
  directory=$(new_project "$MODULAR")
  put "$directory/src/kind/kind.ts" 'export function extensionOf(language: string) {\n  if (language === "python") {\n    return "py";\n  }\n  if (language === "go") {\n    return "go";\n  }\n  if (language === "rust" || language === "rustc") {\n    return "rs";\n  }\n  if (language === "ruby") {\n    return "rb";\n  }\n  return "";\n}\n'
  put "$directory/src/kind/short.py" 'def short_name(language):\n    if language == "python":\n        return "py"\n    if language == "go":\n        return "go"\n    if language == "rust":\n        return "rs"\n    if language == "ruby":\n        return "rb"\n    return ""\n'
  put "$directory/src/kind/three.ts" 'export function threeOf(language: string) {\n  if (language === "a") {\n    return "x";\n  }\n  if (language === "b") {\n    return "y";\n  }\n  if (language === "c") {\n    return "z";\n  }\n  return "";\n}\n'
  run_in "$directory" check src
  assert_match '^warning lookup-chain src/kind/kind\.ts:2 4 if branches compare language with literals; use a lookup table$' "$OUTPUT"
  assert_match '^warning lookup-chain src/kind/short\.py:2 4 if branches compare language with literals; use a lookup table$' "$OUTPUT"
  assert_no_match 'lookup-chain src/kind/three\.ts' "$OUTPUT"
}

test_codemaster_awk_uses_lookup_tables() {
  assert_equal 0 "$(grep -c 'if (language == "' "$PLUGIN_ROOT/lib/awk/lang.awk")"
  assert_equal 0 "$(grep -c 'if (language == "' "$PLUGIN_ROOT/lib/awk/mirror.awk")"
  assert_equal 0 "$(grep -c 'if (extension == "' "$PLUGIN_ROOT/lib/awk/lang.awk")"
}

test_conventions_never_record_colocated_tests() {
  local directory name
  directory=$(new_project "")
  put "$directory/src/user/service.ts" "$USER_SERVICE"
  for name in one two three four five; do
    put "$directory/src/user/$name.test.ts" 'createUser();\n'
  done
  run_in "$directory" conventions --refresh
  assert_equal "tests" "$(profile_field "$directory" testsLocation)"
  assert_equal "default" "$(profile_field "$directory" sources/testsLocation)"
}

test_colocated_in_the_config_warns_and_means_tests() {
  local directory
  directory=$(new_project '{"layout": "modular", "testsLocation": "colocated"}')
  put "$directory/src/user/service.ts" "$USER_SERVICE"
  run_in "$directory" check src
  assert_contains "$OUTPUT" 'warning config testsLocation: "colocated" is not supported, using "tests"'
  assert_match '^error test-mirror src/user/service\.ts:1 missing test tests/user/service\.test\.ts$' "$OUTPUT"
}

test_tests_are_required_only_for_files_with_functions() {
  local directory
  directory=$(new_project "$MODULAR")
  put "$directory/src/user/model.ts" 'export class UserRecord { name = "x"; }\n'
  put "$directory/src/user/service.ts" "$USER_SERVICE"
  put "$directory/src/user/consts.ts" 'export const USER_LIMIT = 1;\n'
  put "$directory/src/user/interfaces.ts" 'export interface UserAccount { name: string }\n'
  run_in "$directory" check src
  assert_no_match 'test-mirror src/user/model\.ts' "$OUTPUT"
  assert_match '^error test-mirror src/user/service\.ts:1 ' "$OUTPUT"
  assert_no_match 'test-mirror src/user/(consts|interfaces)\.ts' "$OUTPUT"
}

test_nesting_and_name_limits_default_to_four() {
  local directory
  directory=$(new_project "$MODULAR")
  put "$directory/src/flow/flow.ts" 'export function walkFour(items: number[]) {\n  for (const item of items) {\n    if (item > 0) {\n      while (item > 1) {\n        if (item > 2) {\n          return item;\n        }\n      }\n    }\n  }\n  return 0;\n}\n'
  put "$directory/src/deep/deep.ts" 'export function walkFive(items: number[]) {\n  for (const item of items) {\n    if (item > 0) {\n      while (item > 1) {\n        if (item > 2) {\n          if (item > 3) { return item; }\n        }\n      }\n    }\n  }\n  return 0;\n}\n'
  put "$directory/src/name/name.ts" 'export function readUserOrderTotal() { return 1; }\nexport function readActiveUserOrderTotal() { return 1; }\n'
  run_in "$directory" check src
  assert_no_match 'max-nesting src/flow/' "$OUTPUT"
  assert_match '^error max-nesting src/deep/deep\.ts:6 function walkFive nests blocks deeper than 4$' "$OUTPUT"
  assert_no_match 'readUserOrderTotal has' "$OUTPUT"
  assert_match '^warning name-word-count src/name/name\.ts:2 readActiveUserOrderTotal has 5 words \(max 4\)$' "$OUTPUT"
  printf '{"layout": "modular", "rules": {"max-nesting": {"max": 3}}}' > "$directory/.codemaster.json"
  run_in "$directory" check src
  assert_match '^error max-nesting src/flow/flow\.ts:5 ' "$OUTPUT"
}

test_the_plugin_has_no_errors_over_all_files() {
  run_in "$PLUGIN_ROOT" check --all
  assert_match '^codemaster: 0 errors' "$(printf '%s\n' "$OUTPUT" | tail -n 1)"
}
```

- [x] **Step 2: run them, watch them fail** — `bash tests/run.sh acceptance`. Expect `FAIL` for every test except `test_go_tests_stay_next_to_the_code` and `test_the_plugin_has_no_errors_over_all_files`, and a last line `2 passed, 15 failed, 0 skipped` (± the two). Commit the file.

---

### Task 1: tests folder default, colocated removed, modular fixture tests moved

**Writes:** `lib/defaults.json`, `lib/awk/config.awk`, `lib/awk/conventions.awk`, `lib/awk/cfg.awk`, `lib/files.sh`, `lib/awk/mirror.awk`, `tests/fixtures/modular/src/big.test.ts` → `tests/fixtures/modular/tests/big.test.ts`, `src/report.test.ts` → `tests/report.test.ts`, `src/old/legacy.test.ts` → `tests/old/legacy.test.ts`, `src/user/user.helpers.test.ts` → `tests/user/user.helpers.test.ts`, `src/user/user.service.test.ts` → `tests/user/user.service.test.ts` (all under `tests/fixtures/modular/`, moved with `git mv`)
**Reads:** `lib/awk/roles.awk`, `tests/conventions.test.sh`, `tests/hook.test.sh`
**Depends on:** Task 0
**Executor:** claude
**Complexity:** routine
**Satisfies:** `test_conventions_never_record_colocated_tests`, `test_colocated_in_the_config_warns_and_means_tests`
**Interfaces:**
- Produces: `cm_tests_location` always prints a folder (`${CM_CFG_TESTS_LOCATION:-tests}`); `cfg_severity_default` returns `warning` for `file-name-suffix`, `array-repeated-elements`, `lookup-chain`.

- [ ] **Step 1: run the two acceptance tests, watch them fail** — `bash tests/run.sh acceptance colocated`.
- [ ] **Step 2: implement:**
  - `lib/defaults.json`: `"testsLocation": "tests"`.
  - `lib/awk/config.awk`, `merge_field`, right after the `coverageCommand` block:
    ```awk
    if (field == "testsLocation" && over_type[path] == "s" && json_unescape(over_value[path]) == "colocated") {
      warn(label, "\"colocated\" is not supported, using \"tests\"")
      return
    }
    ```
  - `lib/files.sh` `cm_tests_location`: body becomes `printf '%s\n' "${CM_CFG_TESTS_LOCATION:-tests}"` (the layout branch and `colocated` go).
  - `lib/awk/conventions.awk`: count only test folders. Replace `location_total++` / `location_count[in_folder ? segments[1] : "colocated"]++` with `if (in_folder) { location_total++; location_count[segments[1]]++ }`. Change the fallback to `dominant("testsLocation", location_count, location_total, "tests")`. Update the header comment.
  - `lib/awk/cfg.awk` `cfg_severity_default`: add `rule == "file-name-suffix" || rule == "array-repeated-elements" || rule == "lookup-chain"` to the warning list.
  - `lib/awk/mirror.awk` `mirror_directory`: `if (language == "go" || location == "colocated")` → `if (language == "go")`.
  - Move the five modular fixture tests with `git mv` to the paths in **Writes**.
- [ ] **Step 3: run them, watch them pass** — `bash tests/run.sh acceptance colocated` → 2 ok. Then `bash tests/run.sh check`, `bash tests/run.sh conventions`, `bash tests/run.sh hook`, `bash tests/run.sh roles`: all ok. If a test expected colocated behaviour, fix the expectation to `tests/…`.

---

### Task 2: default limits of 4

**Writes:** `lib/awk/analyze.awk`, `tests/check.test.sh`, `tests/fixtures/modular/src/order/order.service.ts`, `tests/fixtures/polyglot.expected`, `tests/fixtures/polyglot/src/modules/{c/billing.c,cpp/billing.cpp,cs/Billing.cs,go/billing.go,java/Billing.java,js/billing.js,kt/Billing.kt,php/Billing.php,py/billing.py,rs/billing.rs}`
**Depends on:** Task 1
**Executor:** claude
**Complexity:** routine
**Satisfies:** `test_nesting_and_name_limits_default_to_four`

- [ ] **Step 1: watch it fail** — `bash tests/run.sh acceptance limits_default`.
- [ ] **Step 2: implement:**
  - `lib/awk/analyze.awk`: `rule_limit("name-word-count", 3)` → `4`, `rule_limit("max-nesting", 3)` → `4`. The callback limit (2) and `max-call-nesting` (3) stay.
  - Keep each nesting fixture failing at five levels. In every file of the polyglot list, take the `max-nesting` line L from `polyglot.expected`: line L opens the 4th-level block and line L+1 holds its single statement. Rewrite line L+1, at the same indentation, as a fifth block around that statement:
    - `if (item > 2) { <stmt> }` for JS, C, C++, C#, Java, Kotlin, PHP (PHP keeps `$item`);
    - `if item > 2 { <stmt> }` for Go and Rust;
    - `if item > 2: <stmt>` for Python.

    Use the loop variable the file actually has. In `polyglot.expected`, change each of the 10 `max-nesting <file>:L` lines to `:L+1`.
  - `tests/fixtures/modular/src/order/order.service.ts` line 7 → `          if (order > 2) { total += order; }`. In `tests/check.test.sh`, the modular expected line becomes `max-nesting src/order/order.service.ts:7`.
  - `tests/check.test.sh` `test_rule_settings_switch_a_rule_off_or_raise_its_limit`: the name becomes `userAccountProfileDisplayName` and the override `{"max": 5}`.
- [ ] **Step 3: watch it pass** — `bash tests/run.sh acceptance limits_default`, `bash tests/run.sh languages`, `bash tests/run.sh check`: all ok.

---

### Task 3: `test-placement` and test folders at any depth

**Writes:** `lib/awk/roles.awk`, `lib/awk/placement.awk` (new), `lib/check.sh`, `tests/placement.test.sh` (new), `tests/roles.test.sh`
**Reads:** `lib/awk/mirror.awk`, `lib/files.sh` (`cm_files_awk` invocation pattern)
**Depends on:** Task 1
**Executor:** claude
**Complexity:** complex
**Satisfies:** `test_a_test_next_to_the_code_is_misplaced`, `test_a_second_test_folder_is_misplaced`, `test_go_tests_stay_next_to_the_code`
**Interfaces:**
- Produces: `is_test_folder(name)` in roles.awk (`tests`, `test`, `__tests__`, `spec`); `is_test_path` treats any non-final segment for which `is_test_folder` is true as a test path; `cm_check_placement` (stdin: role lines; stdout: raw findings).

- [ ] **Step 1: failing unit tests** — `tests/placement.test.sh`, reusing the `new_project`/`put` helpers copied from Task 0. Cover these cases:
  - a test in `tests/` → no finding;
  - `scripts/run.test.ts` outside the source root → no finding;
  - `src/test/java/BillingTest.java` → no finding;
  - `testsLocation: "__tests__"` with root `tests/x.test.ts` → `second test folder tests; keep all tests in __tests__/`.

  `tests/roles.test.sh` gets one assertion: `assert_equal "test - 0" "$(role_of "$root" modular src/user/__tests__/fixture.ts)"`.
- [ ] **Step 2: watch them fail** — `bash tests/run.sh placement`; `bash tests/run.sh roles`.
- [ ] **Step 3: implement:**
  - `lib/awk/roles.awk`: add `function is_test_folder(name) { return name == "tests" || name == "test" || name == "__tests__" || name == "spec" }`. In `is_test_path`, replace the `segments[1] == …` test with a loop over positions `1 .. count-1` that returns 1 when `is_test_folder(segments[position])`.
  - `lib/awk/placement.awk`:
    ```awk
    # Test files outside the one tests folder. First input file: the flat config; then role lines
    # "path<TAB>role<TAB>entity<TAB>global<TAB>language". -v location=<tests folder>.
    # Prints raw findings "path<TAB>1<TAB>error<TAB>test-placement<TAB>message". POSIX awk, with util, cfg, lang, roles.
    FNR == NR { cfg_store(); next }
    !started { started = 1; roles_init() }
    $2 != "test" || $5 == "go" { next }
    {
      path = $1
      if (path == location || substr(path, 1, length(location) + 1) == location "/" || path ~ /(^|\/)src\/test\//) {
        next
      }
      folder = test_folder_of(path)
      if (folder != "") {
        printf "%s\t1\terror\ttest-placement\tsecond test folder %s; keep all tests in %s/\n", path, folder, location
        next
      }
      count = relative_segments(path, relative)
      if (count > 0) {
        printf "%s\t1\terror\ttest-placement\ttest file %s belongs in %s\n", path, path, mirror_path(relative, count)
      }
    }
    function test_folder_of(path,    segments, count, position, out) {
      count = split(path, segments, "/")
      out = ""
      for (position = 1; position < count; position++) {
        out = out (position > 1 ? "/" : "") segments[position]
        if (is_test_folder(segments[position])) {
          return out
        }
      }
      return ""
    }
    function mirror_path(relative, count,    out, position) {
      out = location
      for (position = 1; position <= count; position++) {
        out = out "/" relative[position]
      }
      return out
    }
    ```
  - `lib/check.sh`: add
    ```bash
    # Reads role lines on stdin; prints test-placement findings.
    cm_check_placement() {
      LC_ALL=C awk -f "$CM_AWK_DIR/util.awk" -f "$CM_AWK_DIR/cfg.awk" -f "$CM_AWK_DIR/lang.awk" -f "$CM_AWK_DIR/roles.awk" \
        -f "$CM_AWK_DIR/placement.awk" -v location="$(cm_tests_location)" "$CM_CONFIG" -
    }
    ```
    In `cm_run_checks`, right after `cm_roles < "$files" > "$CM_TMP/roles"`: `cm_check_placement < "$CM_TMP/roles" >> "$CM_TMP/findings.raw"`. This runs for every layout and comes after the `: > findings.raw` line, so move that truncation above it.
- [ ] **Step 4: watch them pass** — `bash tests/run.sh placement`, `bash tests/run.sh roles`, `bash tests/run.sh acceptance misplaced`, `bash tests/run.sh acceptance go_tests`, `bash tests/run.sh check`, `bash tests/run.sh languages`: all ok.

---

### Task 4: `test-mirror` only for files with functions

**Writes:** `lib/awk/analyze.awk`, `lib/check.sh`, `lib/awk/mirror.awk`, `tests/mirror.test.sh` (new)
**Depends on:** Tasks 2, 3, 8
**Executor:** claude
**Complexity:** routine
**Satisfies:** `test_tests_are_required_only_for_files_with_functions`
**Interfaces:**
- Produces: in check mode, `analyze.awk` prints one extra line `@functions<TAB>-<TAB><count of named functions>`. `$CM_TMP/parsed.roles` gains a 6th column with that count, and `mirror.awk` skips rows whose 6th column is `0`.

- [ ] **Step 1: failing test** — `tests/mirror.test.sh`. A layered project with `src/modules/types-only.ts` (`export type Row = { id: string };`) gets no test-mirror. `src/modules/user.ts` with a function and no test gets `error test-mirror src/modules/user.ts:1`.
- [ ] **Step 2: watch it fail** — `bash tests/run.sh mirror`.
- [ ] **Step 3: implement:**
  - `analyze.awk`: add a `count_named_functions()` that loops `current = 1..node_total`, skips `!is_function(current)`, calls `resolve_function_name(current)` and counts `FUNCTION_NAME != ""` (the same test `list_functions` uses). At the end of `run_checks`, print `printf "@functions\t-\t%d\t\t\n", count_named_functions()`.
  - `lib/check.sh` `cm_run_checks`: keep `functions=0` per file. In the inner loop, `if [ "$severity" = "@functions" ]; then functions="$line"; continue; fi` comes before the findings append. The parsed.roles line becomes `printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$path" "$role" "$entity" "$global" "$language" "$functions"`. `cm_scan_rules` reads `$5`, which is unaffected.
  - `lib/awk/mirror.awk`: after the strict/lenient check, `if ($6 == "0") { next }`. Update the header comment to mention the column.
- [ ] **Step 4: watch it pass** — `bash tests/run.sh mirror`, `bash tests/run.sh acceptance functions`, `bash tests/run.sh check`, `bash tests/run.sh languages`, `bash tests/run.sh hook`: all ok.

---

### Task 5: `file-name-suffix` and the modular rename

**Writes:** `lib/awk/names.awk` (new), `lib/awk/files.awk`, `lib/awk/lang.awk`, `lib/files.sh`, `lib/check.sh`, `lib/hook.sh`, `tests/fixtures/modular/src/user/user.consts.ts` → `consts.ts`, `tests/fixtures/modular/src/user/user.interfaces.ts` → `interfaces.ts` (`git mv`), `tests/check.test.sh`, `tests/names.test.sh` (new)
**Depends on:** Tasks 4, 8
**Executor:** claude
**Complexity:** complex
**Satisfies:** `test_modular_fixture_has_tests_in_one_folder_and_plain_names`, `test_consts_interfaces_and_styles_have_no_suffix`, `test_layered_consts_drop_the_suffix_and_keep_the_entity`, `test_file_name_suffix_can_be_switched_off`
**Interfaces:**
- Produces: `is_style_file(path)` in lang.awk (extension `css scss sass less`, looked up in a table); `cm_select_styles` (stdin paths → existing style files outside ignored folders and `exclude`); `CM_SELECT`, the selector `cm_all_sources`/`cm_walk_sources`/`cm_expand_paths` call (default `cm_select_sources`); `cm_run_checks <files> [styles file]`.

- [ ] **Step 1: failing test** — `tests/names.test.sh`. `.scss` and `.less` with `.module` → finding; `dist/x.styles.css` → no finding; `src/global/consts.ts` → no finding.
- [ ] **Step 2: watch it fail** — `bash tests/run.sh names`.
- [ ] **Step 3: implement:**
  - `lang.awk`: `is_style_file(path)` reads a table built once from `split("css scss sass less", …)`. It sits next to the other tables Task 8 builds.
  - `files.awk` filter mode: move the exclude loop into `function excluded(path)`. Under `want == "styles"`, print a path when `is_style_file(path) && !in_ignored_directory(path) && !excluded(path)`, then `next`.
  - `files.sh`: add `cm_select_styles` (the same body as `cm_select_sources` with `-v want=styles`). In `cm_all_sources` and `cm_walk_sources`, replace `cm_select_sources` with `"${CM_SELECT:-cm_select_sources}"`.
  - `names.awk`:
    ```awk
    # file-name-suffix. First input file: the flat config; then role lines (style files carry role "style").
    # Prints raw findings "path<TAB>1<TAB>warning<TAB>file-name-suffix<TAB>rename to <path>". POSIX awk, with util, cfg, lang, roles.
    FNR == NR { cfg_store(); next }
    !started { started = 1; roles_init() }
    {
      path = $1; role = $2
      name = path_basename(path); directory = path_dirname(path)
      extension = extension_of(name)
      stem = substr(name, 1, length(name) - length(extension) - 1)
      if (index(stem, ".") == 0) { next }
      head = stem; sub(/\.[^.]*$/, "", head)
      word = stem; sub(/^.*\./, "", word)
      if (role == "style" && word ~ /^(styles|style|module|component|css)$/) {
        suggest(directory, head "." extension)
      } else if ((role == "consts" || role == "interfaces") && name_role(word) == role) {
        suggest(directory, (alias_role(path_basename(directory)) == role ? head : word) "." extension)
      }
    }
    function suggest(directory, file) {
      printf "%s\t1\twarning\tfile-name-suffix\trename to %s\n", $1, (directory == "" || directory == "." ? file : directory "/" file)
    }
    ```
    Check what `path_dirname` returns for a path with no slash, and match it.
  - `check.sh`:
    - In `cm_expand_paths`, the tracked filter uses `"${CM_SELECT:-cm_select_sources}"`.
    - In `cm_check_command`, before each source selection, write `$CM_TMP/selected.styles`:
      - paths: `( CM_SELECT=cm_select_styles; cm_expand_paths "${list[@]}" ) > "$CM_TMP/selected.styles"`;
      - `--all`: `( CM_SELECT=cm_select_styles; cm_all_sources ) > …`;
      - changed: `cm_changed_paths | cm_select_styles > …`.

      Then call `cm_run_checks "$CM_TMP/selected" "$CM_TMP/selected.styles"`.
    - In `cm_run_checks`, add an optional `styles="${2:-}"`. After placement, run:
      ```bash
      { cm_awk -F '\t' '$2 == "consts" || $2 == "interfaces"' "$CM_TMP/roles"
        [ -n "$styles" ] && [ -f "$styles" ] && cm_awk '{ printf "%s\tstyle\t-\t0\tstyle\n", $0 }' "$styles"
      } | cm_check_names >> "$CM_TMP/findings.raw"
      ```
      `cm_check_names` is built the same way as `cm_check_placement`, with `names.awk`.
  - `hook.sh`: after `hook.changed`, add `cm_select_styles < "$CM_TMP/hook.paths" > "$CM_TMP/hook.styles"`, and change the call to `cm_run_checks "$CM_TMP/hook.files" "$CM_TMP/hook.styles"`.
  - Rename the two modular fixture files with `git mv`. In `tests/check.test.sh`, the expected lines become `name-entity-prefix src/user/consts.ts:1` and `name-entity-prefix src/user/interfaces.ts:1`. Keep the list sorted the way `triples` sorts it.
- [ ] **Step 4: watch it pass** — `bash tests/run.sh names`, `bash tests/run.sh acceptance suffix`, `bash tests/run.sh acceptance modular_fixture`, `bash tests/run.sh check`, `bash tests/run.sh hook`, `bash tests/run.sh roles`: all ok.

---

### Task 6: `array-repeated-elements`

**Writes:** `lib/awk/analyze.awk`, `tests/arrays.test.sh` (new)
**Depends on:** Task 4
**Executor:** claude
**Complexity:** complex
**Satisfies:** `test_repeated_array_elements_ask_for_a_loop`, `test_plain_data_arrays_stay_quiet`

- [ ] **Step 1: failing test** — `tests/arrays.test.sh`:
  - JS `[[0, 0], [0, 1], [1, 0], [1, 1]]` → finding with N=4;
  - `[0, 10, 20, 30, 40]` → N=5;
  - `[1, 2, 4, 8, 16]` → no finding;
  - 4 elements of the same shape followed by 1 different → N=4;
  - `rules.array-repeated-elements.max: 4` with 4 elements → no finding.
- [ ] **Step 2: watch it fail** — `bash tests/run.sh arrays`.
- [ ] **Step 3: implement** in `analyze.awk`, called from `run_checks` after `check_function_rules()`:
  - `check_repeated_arrays()`:
    - Return when `!SCRIPT && LANGUAGE != "python"` or `role` is `consts`, `interfaces` or `test`.
    - `limit = rule_limit("array-repeated-elements", 3)`.
    - For each node whose kind is `array` (SCRIPT) or `list` (python): `count = repeated_run(node, limit)`. When `count > 0`, call `finding("warning", "array-repeated-elements", line_of(node), "array has " count " elements of the same shape; build it with a for loop")`.
  - `repeated_run(node, limit)`:
    - Elements = named kids that are not `comment`.
    - Longest run of consecutive **compound** elements (`!node_is("literal", e)` and at least one named kid) with equal `element_shape(e)`. Return it when it is `> limit`.
    - Else, if every element is a numeric literal (`number` in SCRIPT, `integer`/`float` in python), `n > limit + 1`, and the differences `node_text(e[i+1]) - node_text(e[i])` are all equal and non-zero, return `n`.
    - Else return 0.
  - `element_shape(node)`:
    - `node_is("literal", node)` or `node_kind[node] == "jsx_text"` → `"L"`;
    - `node_is("identifier", node)` → `node_kind[node] ":" node_text(node)`;
    - otherwise `node_kind[node] "(" <shapes of named kids joined by ","> ")"`.
- [ ] **Step 4: watch it pass** — `bash tests/run.sh arrays`, `bash tests/run.sh acceptance array`, `bash tests/run.sh acceptance plain_data`, `bash tests/run.sh check`, and `bash tests/run.sh acceptance plugin_has_no_errors` (warnings in `lib/runners` are fine).

---

### Task 7: docs and spec

**Writes:** `README.md`, `skills/codemaster/SKILL.md`, `skills/codemaster/references/rules.md`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `docs/sdd/specs/2026-11-28-tests-folder-names-array-loops.md`
**Depends on:** Task 1
**Executor:** claude
**Complexity:** routine
**Satisfies:** — (docs; checked by review and `bash tests/run.sh manifest`)

- [ ] **Step 1:** Spec. Add these sections:
  - **§3.6 `lookup-chain`**: warning, `max` 3, TS/TSX/JS/Python. Four or more consecutive `if` branches (sibling ifs or an else-if chain) whose condition compares one name with literals (`==`/`===`, joined by `||`/`or`) and whose body is only `return <literal>`. Message `<N> if branches compare <name> with literals; use a lookup table`. Not checked in roles `consts`, `interfaces`, `test`.
  - **§3.7**: codemaster's own `lib/awk/lang.awk` (`language_of`, `language_extensions`) and `lib/awk/mirror.awk` (`default_test_name`, `test_names`) use lookup tables filled once in a loop. Awk isn't checked by codemaster, so `test_codemaster_awk_uses_lookup_tables` guards it.

  Add the two Public interface rows, with the quoted phrase "Оце можна було написать через массив", plus the Verification lines.
- [ ] **Step 2:** `README.md` rules table:
  - `test-mirror`: "every module, helper and util **with a function** has a test in `tests/`";
  - `name-word-count`: at most 4 words;
  - `max-nesting`: at most 4 levels;
  - new rows `test-placement`, `file-name-suffix`, `array-repeated-elements`, `lookup-chain`;
  - the config example and the `testsLocation` default is `tests`.
- [ ] **Step 3:** `references/rules.md`:
  - line 11: modular example `user/user.service.ts`, `user/consts.ts`, `user/interfaces.ts`;
  - the `test-mirror` row and its section: `tests/modules/user.test.ts`, only files with a function, never consts/interfaces;
  - `max-nesting` "deeper than 4 levels";
  - rows and detail sections for the 4 new rules;
  - the `testsLocation` row: "a folder name, default `tests`";
  - conventions line 153: "the dominant test folder among `tests/`, `test/`, `__tests__/`, `spec/`; tests next to the code are never a choice";
  - test-files paragraph: a test folder at any depth.
- [ ] **Step 4:** `SKILL.md` "Rules while coding", add:
  - "All tests live in the one tests folder (`testsLocation`, default `tests/`) mirroring the source tree; never next to the code, never a second test folder."
  - "Write tests only for functions; constants, interfaces and types get none."
  - "Name constants, interfaces and stylesheet files by role only: `user/consts.ts`, `user/interfaces.ts`, `button/button.css`, never `user.consts.ts`, `button.styles.css`, `button.module.css`."
  - "Build repeated elements with a loop (`for`/`for…of`, or `map` over a data array in JSX), not a long literal array, including list items, rows and icons in components."
  - "Replace a chain of `if (x == literal) return literal` with a lookup table (object, map, array)."

  Coverage step 5: "100 % of the lines of functions". Bump `version` from 0.2.0 to 0.3.0 in `SKILL.md`, `plugin.json` and `marketplace.json`.
- [ ] **Step 5:** `bash tests/run.sh manifest` → ok.

---

### Task 8: lookup tables in codemaster's awk

**Writes:** `lib/awk/lang.awk`, `lib/awk/mirror.awk`
**Depends on:** Task 1
**Executor:** claude
**Complexity:** routine
**Satisfies:** `test_codemaster_awk_uses_lookup_tables`
**Interfaces:**
- Produces: `language_of`, `language_extensions`, `default_test_name`, `test_names` keep their signatures and return values exactly.

- [ ] **Step 1: watch it fail** — `bash tests/run.sh acceptance lookup_tables`.
- [ ] **Step 2: implement:**
  - `lang.awk`: a guarded `lang_tables()` (`if (lang_ready) return; lang_ready = 1`) builds:
    - `extension_language[...]` from `split("ts:typescript mts:typescript cts:typescript tsx:tsx js:javascript mjs:javascript cjs:javascript jsx:javascript py:python go:go rs:rust java:java kt:kotlin kts:kotlin cs:csharp php:php rb:ruby c:c h:c cc:cpp cpp:cpp cxx:cpp hpp:cpp hh:cpp hxx:cpp", pairs, " ")`, keeping every extension the current `language_of` maps (read the file and copy them all);
    - `language_extension_list[...]` from `"typescript:ts tsx mts cts js jsx mjs cjs"`-style entries, one per language (`tsx` and `javascript` get the TypeScript list; `cpp` is the default).

    Then `language_of` = the existing skip patterns + `lang_tables(); extension = extension_of(path); return (extension in extension_language) ? extension_language[extension] : ""`. `language_extensions` = a table lookup with the `cpp` list as the default. Entries containing spaces go into the tables through a loop over `split` with `|` as the entry separator.
  - `mirror.awk`: `default_test_name` and `test_names` use template tables keyed by language, with the placeholders `{stem}` and `{ext}` expanded by `gsub`:
    - `default_template["python"] = "test_{stem}.py"`, `go` → `{stem}_test.go`, `rust` → `{stem}.rs`, `java`/`kotlin`/`php` → `{stem}Test.{ext}`, `csharp` → `{stem}Tests.cs`, `ruby` → `{stem}_spec.rb`, default `{stem}_test.{ext}`;
    - `names_template` with the `|`-joined lists the current code returns. `go` and `rust` are empty. The script-language default builds `{stem}_test.<e>|test_{stem}.<e>|{stem}_tests.<e>` over `language_extensions(language)` in a loop, as now.

    Fill the tables once in the `!started` block.
- [ ] **Step 3: watch it pass** — `bash tests/run.sh acceptance lookup_tables`, `bash tests/run.sh languages`, `bash tests/run.sh check`, `bash tests/run.sh roles`, `bash tests/run.sh portability`: all ok, the polyglot findings unchanged.

---

### Task 9: `lookup-chain`

**Writes:** `lib/awk/analyze.awk`, `tests/lookup.test.sh` (new)
**Depends on:** Task 6
**Executor:** claude
**Complexity:** complex
**Satisfies:** `test_if_chains_over_literals_ask_for_a_lookup_table`

- [ ] **Step 1: failing test** — `tests/lookup.test.sh`:
  - a JS else-if chain of 4 → finding at the first `if`;
  - 4 ifs on two different variables → no finding;
  - 4 ifs whose body calls a function → no finding;
  - a file in `consts` role → no finding;
  - `rules.lookup-chain: "off"` → no finding.
- [ ] **Step 2: watch it fail** — `bash tests/run.sh lookup`.
- [ ] **Step 3: implement** in `analyze.awk`, called from `run_checks`:
  - `check_lookup_chains()`:
    - Return unless SCRIPT or python, or when `role` is `consts`, `interfaces` or `test`.
    - `limit = rule_limit("lookup-chain", 3)`.
    - For each node with named kids, walk the kids in order and keep a run: a kid `k` with `lookup_name(k) != ""` extends the run when the name equals the run's name, and otherwise starts a new run. Any other named, non-comment kid ends the run.
    - An `if_statement` whose `alternative` is an else-if (`is_else_if` in functions.awk) counts its whole chain: follow `alternative` → `else_clause` → `if_statement` and add each link whose `lookup_name` matches.
    - When a run ends with length `> limit`, call `finding("warning", "lookup-chain", line_of(<first if>), length " if branches compare " name " with literals; use a lookup table")`.
    - Mark the chained ifs as visited so an inner `if` doesn't start its own run.
  - `lookup_name(node)`: `""` unless `node_kind[node] == "if_statement"`. Otherwise:
    - the condition is `child_by_field(node, "condition")`, unwrapped from `parenthesized_expression`;
    - the consequence (`child_by_field(node, "consequence")`) must hold exactly one named non-comment statement, `return_statement`, whose single named child satisfies `node_is("literal", …)`;
    - return `compared_name(condition)`.
  - `compared_name(cond)`:
    - unwrap parentheses;
    - for a `binary_expression` (SCRIPT) whose operator kid text is `||`, or a python `boolean_operator` `or`: both sides must give the same non-empty name, and that name is returned;
    - for a SCRIPT `binary_expression` with `===`/`==`, or a python `comparison_operator` with `==`: one side `node_is("identifier")` and the other `node_is("literal")` → the identifier text;
    - otherwise `""`.
- [ ] **Step 4: watch it pass** — `bash tests/run.sh lookup`, `bash tests/run.sh acceptance if_chains`, then the full `bash tests/run.sh` → last line `<N> passed, 0 failed, 0 skipped`.
