# Portability: bash 3.2 (macOS), POSIX awk (mawk, gawk, BusyBox, the BSD awk of macOS), JSON in awk.

test_shell_code_avoids_bash_4_features() {
  local found
  found=$(cd "$PLUGIN_ROOT" && grep -n -E 'declare -A|local -A|mapfile|readarray|\$\{[A-Za-z_]+(,,|\^\^)\}|&>>|\|&|coproc|local -n|\[\[ -v ' bin/codemaster.sh lib/*.sh tests/*.sh | grep -v -E 'grep -n -E|^[^:]+:[0-9]+: *#')
  assert_equal "" "$found"
}

test_shell_code_has_valid_syntax() {
  local file
  for file in "$PLUGIN_ROOT"/bin/codemaster.sh "$PLUGIN_ROOT"/lib/*.sh "$PLUGIN_ROOT"/tests/*.sh; do
    bash -n "$file" || fail "syntax error in $file"
  done
}

test_awk_programs_parse_under_the_posix_grammar() {
  local program
  for program in "$PLUGIN_ROOT"/lib/awk/*.awk; do
    [ "$(basename "$program")" = "util.awk" ] && continue
    LC_ALL=C awk -f "$PLUGIN_ROOT/lib/awk/util.awk" -f "$program" < /dev/null > /dev/null 2> "$TEST_TMP/awk.err" || true
    if grep -q -i 'syntax' "$TEST_TMP/awk.err"; then
      fail "$(basename "$program"): $(cat "$TEST_TMP/awk.err")"
    fi
  done
}

# CODEMASTER_TEST_AWKS="/path/to/mawk /path/to/original-awk ..." compares their results with the default awk.
test_every_listed_awk_gives_the_same_findings() {
  local directory expected candidate bin
  [ -n "${CODEMASTER_TEST_AWKS:-}" ] || skip "set CODEMASTER_TEST_AWKS to compare awk implementations"
  directory=$(copy_fixture polyglot)
  run_in "$directory" check src
  expected="$OUTPUT"
  for candidate in $CODEMASTER_TEST_AWKS; do
    bin=$(mktemp -d "$TEST_TMP/awk.XXXXXX")
    ln -s "$candidate" "$bin/awk"
    OUTPUT=$(cd "$directory" && PATH="$bin:$PATH" "$CODEMASTER" check src 2>&1)
    assert_equal "$expected" "$OUTPUT" "$candidate"
  done
}

test_json_round_trip() {
  local text='{"a": [1, "x\"y", {"b/c": null}], "e": {}, "f": [], "g": true, "h": -1.5e3}'
  assert_equal '{"a":[1,"x\"y",{"b/c":null}],"e":{},"f":[],"g":true,"h":-1.5e3}' "$(printf '%s' "$text" | LC_ALL=C awk -f "$PLUGIN_ROOT/lib/awk/json.awk" | LC_ALL=C awk -v compact=1 -f "$PLUGIN_ROOT/lib/awk/json-emit.awk")"
}

test_invalid_json_is_refused() {
  printf '{"a": [1,}' | LC_ALL=C awk -f "$PLUGIN_ROOT/lib/awk/json.awk" > "$TEST_TMP/out" && fail "invalid JSON was accepted"
  assert_match '^!' "$(cat "$TEST_TMP/out")"
}

test_unicode_escapes_become_utf8() {
  local value
  value=$(printf '{"name": "caf\\u00e9 \\u20ac"}' | LC_ALL=C awk -f "$PLUGIN_ROOT/lib/awk/json.awk" | LC_ALL=C awk -f "$PLUGIN_ROOT/lib/awk/util.awk" -f "$PLUGIN_ROOT/lib/awk/flat-get.awk" -v query=name -v mode=value)
  assert_equal "café €" "$value"
}

test_globs() {
  local result
  result=$(printf 'src/a.ts\nsrc/deep/b.ts\ntests/fixtures/x/y.ts\nlib/c.py\n' | LC_ALL=C awk -f "$PLUGIN_ROOT/lib/awk/util.awk" -f "$PLUGIN_ROOT/tests/glob.awk")
  assert_equal "src/a.ts src/*.ts
src/a.ts src/**/*.ts
src/deep/b.ts src/**/*.ts
tests/fixtures/x/y.ts tests/fixtures/**
src/a.ts **/*.{ts,py}
src/deep/b.ts **/*.{ts,py}
tests/fixtures/x/y.ts **/*.{ts,py}
lib/c.py **/*.{ts,py}" "$result"
}
