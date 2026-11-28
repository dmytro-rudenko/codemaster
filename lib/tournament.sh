# tournament: three variants of one function compete; the runner of the function's language checks and measures them.

CM_TOURNAMENT_ITERATIONS=10000
CM_TOURNAMENT_RUNS=5
CM_TOURNAMENT_DEOPT_PENALTY=50
CM_TOURNAMENT_TIMEOUT=20
CM_TOURNAMENT_ORDER="readable first optimized"

cm_node_version_at_least() {
  local major="$1" minor="$2" version
  cm_has_command node || return 1
  version=$(node -p 'process.versions.node' 2>/dev/null) || return 1
  printf '%s\n' "$version" | cm_awk -F . -v major="$major" -v minor="$minor" '{ exit ($1 > major || ($1 == major && $2 >= minor)) ? 0 : 1 }'
}

cm_python() {
  local candidate
  for candidate in python3 python; do
    if cm_has_command "$candidate" && "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)' 2>/dev/null; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

# The runner of a source file (node, python, ruby, php, go), or status 1 when none is installed.
cm_runner_for() {
  case "$1" in
    *.tsx | *.jsx) return 1 ;;
    *.ts | *.mts | *.cts) cm_node_version_at_least 22 18 && printf 'node\n' ;;
    *.js | *.mjs | *.cjs) cm_node_version_at_least 18 0 && printf 'node\n' ;;
    *.py) cm_python > /dev/null && printf 'python\n' ;;
    *.rb) cm_has_command ruby && printf 'ruby\n' ;;
    *.php) cm_has_command php && printf 'php\n' ;;
    *.go) cm_has_command go && printf 'go\n' ;;
    *) return 1 ;;
  esac
}

cm_runner_extensions() {
  case "$1" in
    node) printf 'ts js mts mjs cts cjs\n' ;;
    python) printf 'py\n' ;;
    ruby) printf 'rb\n' ;;
    php) printf 'php\n' ;;
    go) printf 'go\n' ;;
  esac
}

cm_done_path() {
  printf '%s/tournament-done.json\n' "$(cm_state_directory)"
}

# "key<TAB>bodyHash<TAB>skipped" for every recorded tournament target.
cm_done_entries() {
  local path
  path=$(cm_done_path) || return 0
  cm_json_flat "$path" > "$CM_TMP/done.flat" 2>/dev/null || return 0
  cm_awk -F '\t' '
    $1 ~ /^[0-9]+\/key$/ { split($1, parts, "/"); key[parts[1]] = $3; order[++count] = parts[1] }
    $1 ~ /^[0-9]+\/bodyHash$/ { split($1, parts, "/"); hash[parts[1]] = $2 == "s" ? $3 : "" }
    $1 ~ /^[0-9]+\/skipped$/ { split($1, parts, "/"); skipped[parts[1]] = $3 }
    END { for (position = 1; position <= count; position++) { item = order[position]; print key[item] "\t" hash[item] "\t" skipped[item] } }' "$CM_TMP/done.flat"
}

# cm_append_done <key> <body hash or ""> <skipped true|false> <reason or "">
cm_append_done() {
  local key="$1" hash="$2" skipped="$3" reason="$4" path
  path=$(cm_done_path) || return 1
  cm_json_flat "$path" > "$CM_TMP/done.flat" 2>/dev/null && [ "$(cm_flat_type "" < "$CM_TMP/done.flat")" = "[" ] || printf '\t[\t\n' > "$CM_TMP/done.flat"
  cm_awk -F '\t' -v key="$(cm_json_quote "$key")" -v hash="$hash" -v skipped="$skipped" -v reason="$(cm_json_quote "$reason")" '
    $1 ~ /^[0-9]+$/ { position = $1 }
    $1 ~ /^[0-9]+\/key$/ { split($1, parts, "/"); keys[parts[1]] = "\"" $3 "\"" }
    $1 ~ /^[0-9]+\// { split($1, parts, "/"); field = substr($1, length(parts[1]) + 2); value = $0; sub(/^[^\t]*\t[^\t]*\t/, "", value); type[parts[1], field] = $2; raw[parts[1], field] = value; if (!((parts[1], "seen") in type)) { type[parts[1], "seen"] = 1; items[++count] = parts[1] } }
    function render(type_mark, value) { return type_mark == "s" ? "\"" value "\"" : value }
    END {
      printf "["
      first = 1
      for (position = 1; position <= count; position++) {
        item = items[position]
        if (keys[item] == key) continue
        printf "%s\n  {\"key\": %s, \"bodyHash\": %s, \"skipped\": %s, \"reason\": %s}", (first ? "" : ","), render(type[item, "key"], raw[item, "key"]), render(type[item, "bodyHash"], raw[item, "bodyHash"]), render(type[item, "skipped"], raw[item, "skipped"]), render(type[item, "reason"], raw[item, "reason"])
        first = 0
      }
      printf "%s\n  {\"key\": %s, \"bodyHash\": %s, \"skipped\": %s, \"reason\": %s}\n]\n", (first ? "" : ","), key, (hash == "" ? "null" : "\"" hash "\""), skipped, (reason == "\"\"" ? "null" : reason)
    }' "$CM_TMP/done.flat" > "$CM_TMP/done.json" && cat "$CM_TMP/done.json" > "$path"
}

# Lists changed functions worth a tournament: "<file>:<line> <name> complexity=<c> lines=<l>".
cm_find_candidates() {
  local files="$1" path role entity global language runner base ranges name line end complexity lines method this body hash minimum_complexity minimum_lines
  minimum_complexity=$(cm_cfg tournament/minComplexity)
  minimum_lines=$(cm_cfg tournament/minLines)
  base=$(cm_diff_base)
  cm_done_entries > "$CM_TMP/done.entries"
  cm_detect_layout > /dev/null
  cm_roles < "$files" > "$CM_TMP/candidate.roles"
  while IFS="$(printf '\t')" read -r path role entity global language; do
    [ -n "$path" ] || continue
    [ "$role" = "test" ] && continue
    if [ "$role" = "helper" ]; then
      case "$path" in
        */infrastructure/* | */external/*) continue ;;
      esac
    fi
    runner=$(cm_runner_for "$path") || continue
    [ "$entity" = "-" ] && entity=""
    cm_changed_ranges "$base" "$path" > "$CM_TMP/candidate.ranges"
    cm_analyze_file "$path" "$role" "$entity" "$global" "$language" functions -v body_prefix="$CM_TMP/body" > "$CM_TMP/candidate.functions"
    while IFS="$(printf '\t')" read -r name line end complexity lines method this body; do
      [ -n "$body" ] || continue
      if [ "$runner" = "node" ]; then
        [ "$this" = "1" ] && continue
      else
        [ "$method" = "1" ] && continue
      fi
      [ "$complexity" -ge "${minimum_complexity:-5}" ] || [ "$lines" -ge "${minimum_lines:-10}" ] || continue
      cm_awk -v start="$line" -v finish="$end" '$1 == "new" { found = 1 } $1 != "new" && $1 <= finish && $2 >= start { found = 1 } END { exit found ? 0 : 1 }' "$CM_TMP/candidate.ranges" || continue
      hash=$(cm_hash_file "$body")
      if cm_awk -F '\t' -v key="$path#$name" -v hash="$hash" '$1 == key && ($3 == "true" || $2 == hash) { found = 1 } END { exit found ? 0 : 1 }' "$CM_TMP/done.entries"; then
        continue
      fi
      printf '%s:%s %s complexity=%s lines=%s\n' "$path" "$line" "$name" "$complexity" "$lines"
    done < "$CM_TMP/candidate.functions"
  done < "$CM_TMP/candidate.roles"
}

# cm_runner_call <runner> <mode> <variant> <cases> <name> [node flags...]: prints the runner output.
cm_runner_call() {
  local runner="$1" mode="$2" variant="$3" cases="$4" name="$5"
  shift 5
  case "$runner" in
    node) cm_run_timeout "$CM_TOURNAMENT_TIMEOUT" node "$@" "$CM_ROOT/lib/runners/node.mjs" "$mode" "$variant" "$cases" "$name" "$CM_TOURNAMENT_ITERATIONS" ;;
    python) cm_run_timeout "$CM_TOURNAMENT_TIMEOUT" "$(cm_python)" "$CM_ROOT/lib/runners/python.py" "$mode" "$variant" "$cases" "$name" "$CM_TOURNAMENT_ITERATIONS" ;;
    ruby) cm_run_timeout "$CM_TOURNAMENT_TIMEOUT" ruby "$CM_ROOT/lib/runners/ruby.rb" "$mode" "$variant" "$cases" "$name" "$CM_TOURNAMENT_ITERATIONS" ;;
    php) cm_run_timeout "$CM_TOURNAMENT_TIMEOUT" php "$CM_ROOT/lib/runners/php.php" "$mode" "$variant" "$cases" "$name" "$CM_TOURNAMENT_ITERATIONS" ;;
    go) cm_run_timeout "$CM_TOURNAMENT_TIMEOUT" "$CM_GO_BINARY" "$mode" "$cases" "$CM_TOURNAMENT_ITERATIONS" ;;
  esac
}

cm_result_value() {
  cm_awk -v key="$1" '$1 == "CODEMASTER_RESULT" && $2 == key { $1 = ""; $2 = ""; sub(/^ +/, ""); print; exit }'
}

# Compiles a Go variant with the harness; sets CM_GO_BINARY or prints the failure.
cm_go_build() {
  local variant="$1" name="$2" directory
  directory="$CM_TMP/go-$(basename "$variant" .go)"
  rm -rf "$directory"
  mkdir -p "$directory"
  sed '1,/^package /s/^package .*/package main/' "$variant" > "$directory/variant.go"
  sed "s/CODEMASTER_FUNCTION/$name/" "$CM_ROOT/lib/runners/go-harness.go.txt" > "$directory/codemaster_harness.go"
  printf 'module codemastertournament\n\ngo 1.18\n' > "$directory/go.mod"
  if ! (cd "$directory" && cm_run_timeout 180 go build -o harness . > build.log 2>&1); then
    printf 'build: %s\n' "$(grep -v '^#' "$directory/build.log" | cm_first_line)"
    return 1
  fi
  CM_GO_BINARY="$directory/harness"
}

# The tree metrics of a function in a file outside the project: "readability length tokens desugared".
cm_variant_metrics() {
  local variant="$1" name="$2" language
  language=$(printf '%s\n' "$variant" | cm_awk -f "$CM_AWK_DIR/lang.awk" -f "$CM_AWK_DIR/language-of.awk")
  cm_ast_dump "$language" "$variant" "$CM_TMP/variant" > /dev/null || return 1
  cm_analyze_awk -v config_file="$CM_CONFIG" -v ast_file="$CM_TMP/variant.ast" -v cst_file="$CM_TMP/variant.cst" \
    -v source="$variant" -v path="$variant" -v language="$language" -v role=module -v entity="" -v global=0 \
    -v layout=off -v mode=metrics -v target="$name" "$CM_CONFIG" "$CM_TMP/variant.ast" "$CM_TMP/variant.cst"
}

# cm_evaluate_variant <dir> <variant> <runner> <name> <cases> <benchmark>: one result line
# "variant<TAB>passed<TAB>failure<TAB>readability<TAB>length<TAB>bytecode<TAB>speed<TAB>bytecodePerToken<TAB>desugared".
cm_evaluate_variant() {
  local directory="$1" variant="$2" runner="$3" name="$4" cases="$5" benchmark="$6" path="" extension output failure
  local metrics readability length tokens desugared bytecode="-" bytecode_length="" speed="-" run timings deopts
  for extension in $(cm_runner_extensions "$runner"); do
    if [ -f "$directory/$variant.$extension" ]; then
      path="$directory/$variant.$extension"
      break
    fi
  done
  if [ -z "$path" ]; then
    printf '%s\tfalse\tmissing file\n' "$variant"
    return 0
  fi
  if [ "$runner" = "go" ]; then
    if ! cm_go_build "$path" "$name" > "$CM_TMP/go.failure"; then
      printf '%s\tfalse\t%s\n' "$variant" "$(cat "$CM_TMP/go.failure")"
      return 0
    fi
  fi
  output=$(cm_runner_call "$runner" verify "$path" "$cases" "$name" 2>&1)
  if [ $? -eq 124 ]; then
    printf '%s\tfalse\ttimeout\n' "$variant"
    return 0
  fi
  if [ -z "$(printf '%s\n' "$output" | cm_result_value passed)" ]; then
    failure=$(printf '%s\n' "$output" | cm_result_value failed)
    [ -n "$failure" ] || failure=$(printf '%s\n' "$output" | cm_first_line)
    printf '%s\tfalse\t%s\n' "$variant" "${failure:-no result}"
    return 0
  fi
  metrics=$(cm_variant_metrics "$path" "$name")
  if [ -z "$metrics" ]; then
    printf '%s\tfalse\tfunction %s not found\n' "$variant" "$name"
    return 0
  fi
  set -- $metrics
  readability=$1
  length=$2
  tokens=$3
  desugared=$4
  case "$runner" in
    node)
      output=$(cm_runner_call node measure "$path" "$cases" "$name" --print-bytecode "--print-bytecode-filter=$name" --trace-deopt 2>&1)
      bytecode_length=$(printf '%s\n' "$output" | cm_awk 'match($0, /Bytecode length: [0-9]+/) { print substr($0, RSTART + 17, RLENGTH - 17); exit }')
      if [ -z "$bytecode_length" ]; then
        printf '%s\tfalse\tbytecode: not found\n' "$variant"
        return 0
      fi
      deopts=$(printf '%s\n' "$output" | grep -c "\[bailout (kind: [^)]*): begin\. deoptimizing [^ ]* <JSFunction $name ")
      bytecode=$((bytecode_length + CM_TOURNAMENT_DEOPT_PENALTY * deopts))
      ;;
    python | ruby)
      bytecode_length=$(cm_runner_call "$runner" bytecode "$path" "$cases" "$name" 2>&1 | cm_result_value bytecode)
      [ -n "$bytecode_length" ] && bytecode="$bytecode_length"
      ;;
  esac
  if [ "$benchmark" = "1" ]; then
    timings=""
    run=0
    while [ "$run" -lt "$CM_TOURNAMENT_RUNS" ]; do
      output=$(cm_runner_call "$runner" measure "$path" "$cases" "$name" 2>&1)
      value=$(printf '%s\n' "$output" | cm_result_value ns)
      if [ -z "$value" ]; then
        printf '%s\tfalse\tmeasure: %s\n' "$variant" "$(printf '%s\n' "$output" | cm_result_value failed)"
        return 0
      fi
      timings="$timings$value
"
      run=$((run + 1))
    done
    speed=$(printf '%s' "$timings" | cm_awk '
      { values[NR] = $1 + 0 }
      END {
        for (position = 2; position <= NR; position++) {
          item = values[position]; slot = position - 1
          while (slot > 0 && values[slot] > item) { values[slot + 1] = values[slot]; slot-- }
          values[slot + 1] = item
        }
        print values[int(NR / 2) + 1]
      }')
  fi
  local per_token="-"
  if [ -n "$bytecode_length" ] && [ "$tokens" -gt 0 ]; then
    per_token=$(cm_awk -v value="$bytecode_length" -v tokens="$tokens" 'BEGIN { printf "%.6g\n", value / tokens }')
  fi
  printf '%s\ttrue\t\t%s\t%s\t%s\t%s\t%s\t%s\n' "$variant" "$readability" "$length" "$bytecode" "$speed" "$per_token" "$desugared"
}

cm_tournament_run() {
  local directory="$1" file name language runner cases benchmark=1 variant
  if ! cm_json_flat "$directory/target.json" > "$CM_TMP/target.flat" 2>/dev/null; then
    cm_stderr "codemaster: $directory/target.json is missing or not valid JSON"
    return 2
  fi
  file=$(cm_flat_get file < "$CM_TMP/target.flat")
  name=$(cm_flat_get functionName < "$CM_TMP/target.flat")
  if ! printf '%s' "$name" | grep -E -q '^[A-Za-z_][A-Za-z0-9_]*$'; then
    cm_stderr "codemaster: target.json functionName must be an identifier"
    return 2
  fi
  runner=$(cm_runner_for "$file")
  if [ -z "$runner" ]; then
    for variant in $CM_TOURNAMENT_ORDER; do
      for path in "$directory/$variant".*; do
        [ -f "$path" ] && runner=$(cm_runner_for "$path") && break 2
      done
    done
  fi
  if [ -z "$runner" ]; then
    cm_stderr "codemaster: no tournament runner for $file (supported: JavaScript and TypeScript with node, Python, Ruby, PHP, Go)"
    return 2
  fi
  cases=""
  for path in "$directory/cases.json" "$directory/cases.ts" "$directory/cases.mts" "$directory/cases.js" "$directory/cases.mjs"; do
    if [ -f "$path" ]; then
      case "$path" in
        *.json) cases="$path" ;;
        *) [ "$runner" = "node" ] && cases="$path" ;;
      esac
      [ -n "$cases" ] && break
    fi
  done
  if [ -z "$cases" ]; then
    cm_stderr "codemaster: $directory has no cases.json"
    return 2
  fi
  case "$cases" in
    *.json)
      cm_json_flat "$cases" > "$CM_TMP/cases.flat" 2>/dev/null
      [ "$(cm_flat_get benchmark < "$CM_TMP/cases.flat")" = "false" ] && benchmark=0
      ;;
    *)
      [ "$(cm_runner_call node benchmark "$cases" "$cases" "$name" 2>&1 | cm_result_value benchmark)" = "false" ] && benchmark=0
      ;;
  esac
  : > "$CM_TMP/variants"
  for variant in $CM_TOURNAMENT_ORDER; do
    cm_evaluate_variant "$directory" "$variant" "$runner" "$name" "$cases" "$benchmark" >> "$CM_TMP/variants"
  done
  cm_awk -F '\t' -f "$CM_AWK_DIR/util.awk" -f "$CM_AWK_DIR/cfg.awk" -f "$CM_AWK_DIR/score.awk" \
    -v file="$file" -v name="$name" -v result="$directory/result.json" "$CM_CONFIG" "$CM_TMP/variants"
}

cm_tournament_command() {
  local first="${1:-}" second="${2:-}" reason="" argument previous="" key file name hash directory
  case "$first" in
    --candidates | --skip | --done)
      if ! cm_is_repository; then
        printf 'codemaster: not a git repository; the tournament keeps its state in git\n'
        return 0
      fi
      ;;
  esac
  if [ "$first" = "--skip" ]; then
    for argument in "$@"; do
      [ "$previous" = "--reason" ] && reason="$argument"
      previous="$argument"
    done
    if [ -z "$second" ] || [ "$second" = "--reason" ] || [ -z "$reason" ]; then
      cm_stderr "usage: codemaster tournament --skip <file>#<name> --reason <text>"
      return 2
    fi
    cm_append_done "$second" "" true "$reason"
    return 0
  fi
  if [ -z "$first" ] || { [ "$first" = "--done" ] && [ -z "$second" ]; }; then
    cm_stderr "usage: codemaster tournament <dir> | --candidates | --skip <file>#<name> --reason <text> | --done <dir>"
    return 2
  fi
  cm_ensure_ast_grep || return 1
  if [ "$first" = "--candidates" ]; then
    cm_changed_paths | cm_select_sources > "$CM_TMP/changed"
    cm_find_candidates "$CM_TMP/changed"
    return 0
  fi
  if [ "$first" = "--done" ]; then
    directory="$second"
    case "$directory" in
      /* | [A-Za-z]:*) ;;
      *) directory="$CM_PROJECT_ROOT/$directory" ;;
    esac
    cm_json_flat "$directory/target.json" > "$CM_TMP/target.flat" 2>/dev/null || {
      cm_stderr "codemaster: $directory/target.json is missing or not valid JSON"
      return 2
    }
    file=$(cm_flat_get file < "$CM_TMP/target.flat")
    name=$(cm_flat_get functionName < "$CM_TMP/target.flat")
    hash=""
    printf '%s\n' "$file" | cm_roles > "$CM_TMP/done.role"
    IFS="$(printf '\t')" read -r _ role entity global language < "$CM_TMP/done.role"
    [ "$entity" = "-" ] && entity=""
    if [ -f "$CM_PROJECT_ROOT/$file" ] && [ -n "$language" ]; then
      cm_analyze_file "$file" "$role" "$entity" "$global" "$language" functions -v body_prefix="$CM_TMP/done.body" > "$CM_TMP/done.functions"
      hash=$(cm_awk -F '\t' -v name="$name" '$1 == name { print $8; exit }' "$CM_TMP/done.functions")
      [ -n "$hash" ] && hash=$(cm_hash_file "$hash")
    fi
    cm_append_done "$file#$name" "$hash" false ""
    return 0
  fi
  directory="$first"
  case "$directory" in
    /* | [A-Za-z]:*) ;;
    *) directory="$CM_PROJECT_ROOT/$directory" ;;
  esac
  cm_tournament_run "$directory"
}
