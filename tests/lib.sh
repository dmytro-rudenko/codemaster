# Test helpers, sourced by tests/run.sh. Bash 3.2 compatible.

PLUGIN_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
CODEMASTER="$PLUGIN_ROOT/bin/codemaster"

fail() {
  printf '    %s\n' "$*" >&2
  exit 1
}

assert_equal() {
  [ "$1" = "$2" ] || fail "expected [$1] got [$2]${3:+ ($3)}"
}

assert_contains() {
  case "$1" in
    *"$2"*) ;;
    *) fail "expected to find [$2] in: $1" ;;
  esac
}

assert_not_contains() {
  case "$1" in
    *"$2"*) fail "did not expect [$2] in: $1" ;;
  esac
}

assert_match() {
  printf '%s\n' "$2" | grep -E -q -- "$1" || fail "expected a line matching [$1] in: $2"
}

assert_no_match() {
  if printf '%s\n' "$2" | grep -E -q -- "$1"; then
    fail "did not expect a line matching [$1] in: $2"
  fi
}

assert_file() {
  [ -f "$1" ] || fail "expected file $1"
}

assert_no_file() {
  [ ! -e "$1" ] || fail "did not expect file $1"
}

# Runs the CLI in a folder: run_in <dir> <arguments...>; sets STATUS and OUTPUT (stdout), ERRORS (stderr).
run_in() {
  local directory="$1"
  shift
  OUTPUT=$(cd "$directory" && "$CODEMASTER" "$@" 2> "$TEST_TMP/stderr")
  STATUS=$?
  ERRORS=$(cat "$TEST_TMP/stderr")
}

copy_fixture() {
  local directory
  directory=$(mktemp -d "$TEST_TMP/fixture.XXXXXX")
  cp -R "$PLUGIN_ROOT/tests/fixtures/$1/." "$directory/"
  if [ -d "$directory/fake_modules" ]; then
    mv "$directory/fake_modules" "$directory/node_modules"
    if [ -d "$directory/node_modules/.bin" ]; then
      chmod +x "$directory/node_modules/.bin/"*
    fi
  fi
  printf '%s\n' "$directory"
}

git_in() {
  git -C "$1" -c user.email=test@example.com -c user.name=test -c commit.gpgsign=false "${@:2}" > /dev/null 2>&1
}

# init_repository <dir> [no-commit]: a repository on branch "work" forked from "main".
init_repository() {
  git_in "$1" init -q -b main 2>/dev/null || {
    git_in "$1" init -q
    git_in "$1" checkout -q -b main
  }
  if [ "${2:-}" != "no-commit" ]; then
    git_in "$1" add -A
  fi
  git_in "$1" commit -q --allow-empty -m base
  git_in "$1" checkout -q -b work
}

# "rule file:line" for each finding line of check's plain output, sorted.
triples() {
  printf '%s\n' "$1" | awk '$1 == "error" || $1 == "warning" { if ($2 != "parse") print $2, $3 }' | LC_ALL=C sort
}

stop_hook() {
  local directory="$1" active="${2:-false}"
  OUTPUT=$(printf '{"cwd": "%s", "stop_hook_active": %s}' "$directory" "$active" | "$CODEMASTER" hook-stop 2> "$TEST_TMP/stderr")
  STATUS=$?
  ERRORS=$(cat "$TEST_TMP/stderr")
}

# The "reason" of a hook decision, unescaped enough for matching.
hook_reason() {
  printf '%s' "$1" | sed -e 's/^{"decision":"block","reason":"//' -e 's/"}$//' -e 's/\\n/\
/g' -e 's/\\"/"/g'
}

skip() {
  printf '%s\n' "$*" >&2
  exit 77
}
