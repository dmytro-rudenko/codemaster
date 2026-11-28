# Shared shell helpers. Sourced by bin/codemaster. Bash 3.2 compatible: no associative arrays, no mapfile.

CM_AWK_DIR="$CM_ROOT/lib/awk"
CM_TMP=""

cm_awk() {
  LC_ALL=C awk "$@"
}

# Runs an awk program from lib/awk together with util.awk.
cm_awk_program() {
  local program="$1"
  shift
  LC_ALL=C awk -f "$CM_AWK_DIR/util.awk" -f "$CM_AWK_DIR/$program" "$@"
}

cm_stderr() {
  printf '%s\n' "$*" >&2
}

cm_temp_init() {
  if [ -n "$CM_TMP" ] && [ -d "$CM_TMP" ]; then
    return 0
  fi
  CM_TMP=$(mktemp -d "${TMPDIR:-/tmp}/codemaster.XXXXXX") || return 1
  trap 'cm_temp_cleanup' EXIT
}

cm_temp_cleanup() {
  if [ -n "$CM_TMP" ] && [ -d "$CM_TMP" ]; then
    rm -rf "$CM_TMP"
  fi
}

# Flattens a JSON file (json.awk); exit status 1 when it is missing or invalid.
cm_json_flat() {
  [ -f "$1" ] || return 1
  cm_awk -f "$CM_AWK_DIR/json.awk" "$1"
}

# Prints flat lines read from stdin as pretty JSON (or compact with "compact").
cm_json_emit() {
  if [ "${1:-}" = "compact" ]; then
    cm_awk -v compact=1 -f "$CM_AWK_DIR/json-emit.awk"
  else
    cm_awk -f "$CM_AWK_DIR/json-emit.awk"
  fi
}

# Reads a scalar from flat JSON on stdin by path ("a/b/0"); strings are unescaped.
cm_flat_get() {
  cm_awk_program flat-get.awk -v query="$1" -v mode=value
}

# Lists the values of an array (or the keys of an object) at a path, one per line.
cm_flat_list() {
  cm_awk_program flat-get.awk -v query="$1" -v mode=list
}

cm_flat_keys() {
  cm_awk_program flat-get.awk -v query="$1" -v mode=keys
}

cm_flat_type() {
  cm_awk_program flat-get.awk -v query="$1" -v mode=type
}

cm_json_quote() {
  printf '%s' "$1" | cm_awk 'BEGIN { RS = "\001" } { text = $0 } END { gsub(/\\/, "\\\\", text); gsub(/"/, "\\\"", text); gsub(/\n/, "\\n", text); gsub(/\r/, "\\r", text); gsub(/\t/, "\\t", text); gsub(/[\001-\037]/, " ", text); printf "\"%s\"", text }'
}

cm_hash_file() {
  git hash-object --no-filters -- "$1" 2>/dev/null || printf 'missing\n'
}

cm_hash_text() {
  printf '%s' "$1" | git hash-object --stdin 2>/dev/null
}

cm_has_command() {
  command -v "$1" >/dev/null 2>&1
}

# cm_run_timeout <seconds> <command...>: runs a command, kills it after the limit; status 124 on timeout.
cm_run_timeout() {
  local limit="$1" pid watcher status
  shift
  "$@" &
  pid=$!
  (
    sleeper=""
    trap '[ -n "$sleeper" ] && kill "$sleeper" 2>/dev/null; exit 0' TERM
    sleep "$limit" &
    sleeper=$!
    wait "$sleeper"
    if kill -0 "$pid" 2>/dev/null; then
      : > "$CM_TMP/timeout.$pid"
      kill -TERM "$pid" 2>/dev/null
      sleep 1
      kill -KILL "$pid" 2>/dev/null
    fi
  ) >/dev/null 2>&1 &
  watcher=$!
  wait "$pid"
  status=$?
  kill -TERM "$watcher" 2>/dev/null
  wait "$watcher" 2>/dev/null
  if [ -f "$CM_TMP/timeout.$pid" ]; then
    rm -f "$CM_TMP/timeout.$pid"
    return 124
  fi
  return "$status"
}

cm_first_line() {
  cm_awk 'NF { sub(/^[ \t]+/, ""); sub(/[ \t\r]+$/, ""); print; exit }'
}

cm_platform() {
  case "$(uname -s 2>/dev/null)" in
    Darwin) printf 'darwin\n' ;;
    MINGW* | MSYS* | CYGWIN* | Windows_NT) printf 'win32\n' ;;
    *) printf 'linux\n' ;;
  esac
}

cm_path_join() {
  if [ -z "$1" ] || [ "$1" = "." ]; then
    printf '%s\n' "$2"
  else
    printf '%s/%s\n' "$1" "$2"
  fi
}
