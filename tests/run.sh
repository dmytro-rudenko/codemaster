#!/usr/bin/env bash
# Runs the test suite: every tests/*.test.sh, every function in it whose name starts with test_.
# bash tests/run.sh [file filter] [test filter]
# Needs bash, git, awk and ast-grep (installed on first use by "codemaster install").

. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

file_filter="${1:-}"
test_filter="${2:-}"
passed=0
failed=0
skipped=0
failures=""
TEST_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/codemaster-tests.XXXXXX")
trap 'rm -rf "$TEST_ROOT"' EXIT

"$CODEMASTER" install 2> "$TEST_ROOT/install.log"
if ! grep -q 'codemaster: using ast-grep' "$TEST_ROOT/install.log"; then
  cat "$TEST_ROOT/install.log" >&2
  printf 'ast-grep is not available; the tests cannot run\n' >&2
  exit 1
fi

for file in "$PLUGIN_ROOT"/tests/*.test.sh; do
  case "$(basename "$file")" in
    *"$file_filter"*) ;;
    *) continue ;;
  esac
  printf '%s\n' "$(basename "$file")"
  names=$(grep -E '^test_[A-Za-z0-9_]+\(\)' "$file" | sed 's/().*//')
  for name in $names; do
    case "$name" in
      *"$test_filter"*) ;;
      *) continue ;;
    esac
    TEST_TMP="$TEST_ROOT/$name"
    mkdir -p "$TEST_TMP"
    (
      export TEST_TMP
      cd "$TEST_TMP" || exit 1
      . "$file"
      "$name"
    ) 2> "$TEST_TMP/failure.log"
    status=$?
    if [ "$status" -eq 0 ]; then
      passed=$((passed + 1))
      printf '  ok    %s\n' "$name"
    elif [ "$status" -eq 77 ]; then
      skipped=$((skipped + 1))
      printf '  skip  %s %s\n' "$name" "$(head -n 1 "$TEST_TMP/failure.log")"
    else
      failed=$((failed + 1))
      failures="$failures $name"
      printf '  FAIL  %s\n' "$name"
      sed 's/^/      /' "$TEST_TMP/failure.log"
    fi
  done
done

printf '\n%d passed, %d failed, %d skipped\n' "$passed" "$failed" "$skipped"
[ "$failed" -eq 0 ]
