# check over Python, Go, Rust, Java, Kotlin, C#, PHP, Ruby, C, C++ and JavaScript.

test_every_language_reports_its_planted_violations() {
  local directory language file
  directory=$(copy_fixture polyglot)
  run_in "$directory" check src
  assert_equal 1 "$STATUS"
  for file in py/billing.py go/billing.go rs/billing.rs java/Billing.java kt/Billing.kt cs/Billing.cs php/Billing.php c/billing.c cpp/billing.cpp js/billing.js; do
    for rule in layout-forbidden-declaration max-params max-nesting max-call-nesting name-abbreviation; do
      assert_match "^(error|warning) $rule src/modules/$file:" "$OUTPUT"
    done
  done
}

test_polyglot_findings_are_exact() {
  local directory
  directory=$(copy_fixture polyglot)
  run_in "$directory" check src
  assert_equal "$(cat "$PLUGIN_ROOT/tests/fixtures/polyglot.expected")" "$(triples "$OUTPUT")"
}

test_test_mirror_follows_each_language_convention() {
  local directory
  directory=$(copy_fixture polyglot)
  run_in "$directory" check src
  assert_match '^error test-mirror src/modules/rb/billing\.rb:1 missing test tests/modules/rb/billing_spec\.rb$' "$OUTPUT"
  assert_no_match 'test-mirror src/modules/(py|go|rs|java|kt|cs|php|c|cpp|js)/' "$OUTPUT"
  rm "$directory/src/modules/go/billing_test.go" "$directory/tests/modules/py/test_billing.py" "$directory/tests/helpers/test_billing.py"
  run_in "$directory" check src
  assert_match 'test-mirror src/modules/go/billing\.go:1 missing test src/modules/go/billing_test\.go$' "$OUTPUT"
  assert_match 'test-mirror src/modules/py/billing\.py:1 missing test tests/modules/py/test_billing\.py$' "$OUTPUT"
}

test_constants_follow_the_language_case() {
  local directory
  directory=$(copy_fixture polyglot)
  run_in "$directory" check src/consts
  assert_contains "$OUTPUT" "error name-entity-prefix src/consts/billing.py:1 MAX_TOTAL should start with BILLING_"
  assert_contains "$OUTPUT" "error name-entity-prefix src/consts/pricing.go:4 maxTotal should start with Pricing"
  assert_not_contains "$OUTPUT" "PricingMaxTotal"
  assert_not_contains "$OUTPUT" "BILLING_MIN_TOTAL"
}

test_python_helpers_hold_only_functions() {
  local directory
  directory=$(copy_fixture polyglot)
  run_in "$directory" check src/helpers
  assert_contains "$OUTPUT" "error helpers-only-functions src/helpers/billing.py:1 class Formatter is not a function"
}

test_idiomatic_names_pass() {
  local directory
  directory=$(mktemp -d "$TEST_TMP/project.XXXXXX")
  mkdir -p "$directory/src"
  printf 'package main\n\nfunc run(ctx context.Context) error {\n\terr := work(ctx)\n\treturn err\n}\n' > "$directory/src/run.go"
  printf 'class Worker:\n    def __init__(self, *args, **kwargs):\n        self.items = args\n' > "$directory/src/worker.py"
  run_in "$directory" check src
  assert_equal "" "$(triples "$OUTPUT")"
}

test_a_language_can_be_switched_off() {
  local directory
  directory=$(copy_fixture polyglot)
  printf '{"languages": ["python"]}' > "$directory/.codemaster.json"
  run_in "$directory" check src
  assert_match 'src/modules/py/billing\.py' "$OUTPUT"
  assert_no_match 'src/modules/(go|rs|java|kt|cs|php|rb|c|cpp|js)/' "$OUTPUT"
}

test_python_mixed_helpers() {
  local directory
  directory=$(mktemp -d "$TEST_TMP/project.XXXXXX")
  mkdir -p "$directory/src/helpers" "$directory/src/modules"
  printf 'import psycopg2\nimport requests\n\n\ndef load_user(user_id):\n    return requests.get("https://example.com")\n' > "$directory/src/helpers/user.py"
  run_in "$directory" check src/helpers
  assert_contains "$OUTPUT" "warning helpers-mixed-kind src/helpers/user.py:1 helper mixes an infrastructure package with network calls"
}

test_files_that_do_not_parse_are_warnings() {
  local directory
  directory=$(mktemp -d "$TEST_TMP/project.XXXXXX")
  mkdir -p "$directory/src"
  printf 'def broken(:\n    pass\n' > "$directory/src/broken.py"
  run_in "$directory" check src
  assert_match '^warning parse src/broken\.py:1 could not parse$' "$OUTPUT"
  assert_equal 0 "$STATUS"
}
