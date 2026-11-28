# Stop and SessionStart hooks. They never fail a session: problems are one stderr line and exit code 0.

CM_HOOK_HEADER="Run the codemaster skill (code-organizer:codemaster) for this branch."
CM_HOOK_FINDINGS_LIMIT=30
CM_HOOK_CANDIDATES_LIMIT=30
CM_HOOK_LIBRARIES_LIMIT=10
CM_HOOK_FILES_LIMIT=200
CM_HOOK_STATE_FILE="checked-files.json"
CM_HOOK_DEFERRED_FILE="deferred-files.json"

cm_hook_entry() {
  local name="$1" root=""
  cm_temp_init || {
    cm_stderr "codemaster: cannot create a temporary directory"
    return 0
  }
  cat > "$CM_TMP/hook.json"
  if cm_json_flat "$CM_TMP/hook.json" > "$CM_TMP/hook.flat" 2>/dev/null; then
    root=$(cm_flat_get cwd < "$CM_TMP/hook.flat")
  else
    : > "$CM_TMP/hook.flat"
  fi
  if [ -z "$root" ] || [ ! -d "$root" ]; then
    root=$(pwd)
  fi
  CM_PROJECT_ROOT=$(cd "$root" && pwd) || return 0
  cm_config_load "$CM_PROJECT_ROOT"
  if [ "$name" = "hook-session-start" ]; then
    cm_session_start
  else
    cm_hook_stop
  fi
  return 0
}

cm_session_start() {
  local roots line indexed=""
  [ "$CM_CFG_HOOK" = "true" ] || return 0
  roots=$(cm_cfg_type sourceRoot)
  if [ "$roots" = "[" ]; then
    roots=$(cm_cfg_list sourceRoot | paste -s -d , -)
  else
    roots=$(cm_cfg sourceRoot)
  fi
  [ -f "$CM_PROJECT_ROOT/.claude/skills/codemaster-libraries/SKILL.md" ] && indexed="; see the codemaster-libraries skill."
  line=$(printf 'codemaster: layout=%s, sourceRoot=%s' "$(cm_detect_layout)" "$roots" | cm_single_line)
  printf '%s\n' "$line"
  printf 'Before a task, check whether the framework or an installed library already does it%s\n' "${indexed:-.}"
  printf 'Follow the codemaster skill rules while coding.\n'
}

# One line per input line, without control or bidirectional characters, at most 300 bytes.
cm_single_line() {
  cm_awk '{
    gsub(/[\001-\037\177]/, " ")
    gsub(/\302\205/, " ")
    gsub(/\342\200[\250-\256]/, " ")
    gsub(/\342\201[\246-\251]/, " ")
    gsub(/\363\240[\200\201][\200-\277]/, " ")
    if (length($0) > 300) {
      $0 = substr($0, 1, 300)
      sub(/[\300-\377][\200-\277]*$/, "")
    }
    print
  }'
}

# Prints a title and at most <limit> lines of a file, with "… and N more".
cm_capped() {
  local title="$1" file="$2" limit="$3" total
  total=$(grep -c . "$file")
  [ "$total" -gt 0 ] || return 0
  printf '%s\n' "$title"
  head -n "$limit" "$file" | cm_single_line
  if [ "$total" -gt "$limit" ]; then
    printf '… and %d more\n' "$((total - limit))"
  fi
}

# Hashes of the changed files and manifests: "path<TAB>hash".
cm_current_hashes() {
  local path
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    if [ -f "$CM_PROJECT_ROOT/$path" ]; then
      printf '%s\t%s\n' "$path" "$(cm_hash_file "$CM_PROJECT_ROOT/$path")"
    else
      printf '%s\t%s\n' "$path" "$(printf '' | git hash-object --stdin)"
    fi
  done
}

# "path<TAB>hash" from a state file written by cm_record_checked.
cm_read_state() {
  if cm_json_flat "$1" > "$CM_TMP/state.flat" 2>/dev/null && [ "$(cm_flat_type "" < "$CM_TMP/state.flat")" = "{" ]; then
    cm_awk -F '\t' '$1 != "" && $1 !~ /\// && $2 == "s" { key = $1; gsub(/%2F/, "/", key); gsub(/%09/, "\t", key); gsub(/%25/, "%", key); print key "\t" $3 }' "$CM_TMP/state.flat"
  fi
}

cm_read_deferred() {
  if cm_json_flat "$1" > "$CM_TMP/deferred.flat" 2>/dev/null && [ "$(cm_flat_type "" < "$CM_TMP/deferred.flat")" = "[" ]; then
    cm_awk -F '\t' '$1 != "" && $2 == "s" { value = $0; sub(/^[^\t]*\t[^\t]*\t/, "", value); gsub(/\\"/, "\"", value); gsub(/\\\\/, "\\", value); print value }' "$CM_TMP/deferred.flat"
  fi
}

cm_write_path_list() {
  cm_awk '
    BEGIN { printf "[" }
    NF { value = $0; gsub(/\\/, "\\\\", value); gsub(/"/, "\\\"", value); printf "%s\"%s\"", (count++ ? "," : ""), value }
    END { print "]" }' "$1" > "$2"
}

# cm_record_checked <checked paths file>: keeps recorded entries of still-changed files, sets checked files and manifests.
cm_record_checked() {
  local checked="$1"
  cm_awk -F '\t' -v changed="$CM_TMP/hook.changed" -v current="$CM_TMP/hook.current" -v manifests="$CM_TMP/hook.manifests" '
    BEGIN {
      while ((getline line < changed) > 0) is_changed[line] = 1
      while ((getline line < current) > 0) { split(line, parts, "\t"); hash[parts[1]] = parts[2] }
      while ((getline line < manifests) > 0) take[line] = 1
    }
    FILENAME == ARGV[1] { if ($1 in is_changed) next_state[$1] = $2; next }
    { take[$0] = 1 }
    END {
      for (path in take) if (path in hash) next_state[path] = hash[path]
      count = 0
      for (path in next_state) keys[++count] = path
      for (position = 2; position <= count; position++) {
        item = keys[position]; slot = position - 1
        while (slot > 0 && keys[slot] > item) { keys[slot + 1] = keys[slot]; slot-- }
        keys[slot + 1] = item
      }
      printf "{"
      for (position = 1; position <= count; position++) {
        key = keys[position]; gsub(/\\/, "\\\\", key); gsub(/"/, "\\\"", key)
        printf "%s\n  \"%s\": \"%s\"", (position > 1 ? "," : ""), key, next_state[keys[position]]
      }
      print (count > 0 ? "\n}" : "}")
    }' "$CM_TMP/hook.recorded" "$checked" > "$CM_TMP/state.json" && cat "$CM_TMP/state.json" > "$CM_HOOK_STATE"
}

cm_hook_stop() {
  local state active pending_count unchecked profile="" reason
  [ "$CM_CFG_HOOK" = "true" ] || return 0
  cm_is_repository || return 0
  state=$(cm_state_directory) || return 0
  CM_HOOK_STATE="$state/$CM_HOOK_STATE_FILE"
  cm_changed_paths > "$CM_TMP/hook.paths"
  cm_select_sources < "$CM_TMP/hook.paths" > "$CM_TMP/hook.changed"
  cm_awk '{ name = $0; sub(/^.*\//, "", name) } name == "package.json" && $0 !~ /(^|\/)(node_modules|\.git)\// { print }' "$CM_TMP/hook.paths" > "$CM_TMP/hook.changed.manifests"
  { printf 'package.json\n'; cat "$CM_TMP/hook.changed.manifests"; } | LC_ALL=C sort -u > "$CM_TMP/hook.manifests"
  cat "$CM_TMP/hook.changed" "$CM_TMP/hook.manifests" | LC_ALL=C sort -u | cm_current_hashes > "$CM_TMP/hook.current"
  cm_read_state "$CM_HOOK_STATE" > "$CM_TMP/hook.recorded"
  cm_awk -F '\t' -v recorded="$CM_TMP/hook.recorded" '
    BEGIN { while ((getline line < recorded) > 0) { split(line, parts, "\t"); old[parts[1]] = parts[2] } }
    { if (!($1 in old) || old[$1] != $2) print $1 }' "$CM_TMP/hook.current" > "$CM_TMP/hook.stale"
  grep -F -x -f "$CM_TMP/hook.changed" "$CM_TMP/hook.stale" > "$CM_TMP/hook.pending" 2>/dev/null
  if [ ! -s "$CM_TMP/hook.pending" ] && ! grep -q -F -x -f "$CM_TMP/hook.changed.manifests" "$CM_TMP/hook.stale" 2>/dev/null; then
    return 0
  fi
  active=$(cm_flat_get stop_hook_active < "$CM_TMP/hook.flat")
  if [ "$active" = "true" ]; then
    cm_read_deferred "$state/$CM_HOOK_DEFERRED_FILE" > "$CM_TMP/hook.deferred"
    grep -v -F -x -f "$CM_TMP/hook.deferred" "$CM_TMP/hook.pending" > "$CM_TMP/hook.checked"
    cm_record_checked "$CM_TMP/hook.checked"
    return 0
  fi
  cm_ensure_ast_grep 2> "$CM_TMP/install.err" || {
    cm_first_line < "$CM_TMP/install.err" >&2
    return 0
  }
  head -n "$CM_HOOK_FILES_LIMIT" "$CM_TMP/hook.pending" > "$CM_TMP/hook.files"
  pending_count=$(grep -c . "$CM_TMP/hook.pending")
  unchecked=$((pending_count - $(grep -c . "$CM_TMP/hook.files")))
  : > "$CM_TMP/hook.warnings"
  cat "$CM_CONFIG_WARNINGS" >> "$CM_TMP/hook.warnings"
  if [ ! -f "$CM_PROJECT_ROOT/$CM_CONFIG_FILE" ]; then
    cm_read_raw
    cm_scan_conventions 0
    cat "$CM_TMP/conventions.warnings" >> "$CM_TMP/hook.warnings"
    cm_write_profile
    cm_config_load "$CM_PROJECT_ROOT"
    CM_LAYOUT=""
    { printf 'layout\tauto\n'; cat "$CM_TMP/profile.sources"; } > "$CM_TMP/first.sources"
    profile=$(cm_format_profile "$CM_CONFIG" "$CM_TMP/first.sources" "$(cm_detect_layout)")
  fi
  cm_run_checks "$CM_TMP/hook.files"
  cm_report hook > "$CM_TMP/hook.report"
  grep -v '^@@summary' "$CM_TMP/hook.report" > "$CM_TMP/hook.findings"
  cm_find_candidates "$CM_TMP/hook.files" > "$CM_TMP/hook.candidates" 2>> "$CM_TMP/hook.warnings"
  : > "$CM_TMP/hook.libraries"
  CM_LIBRARIES_BLOCKING=0
  if [ "$(cm_cfg libraryDigest)" = "true" ]; then
    cm_library_summary "$CM_HOOK_LIBRARIES_LIMIT" > "$CM_TMP/hook.libraries"
  fi
  cm_record_checked "$CM_TMP/hook.files"
  tail -n +"$((CM_HOOK_FILES_LIMIT + 1))" "$CM_TMP/hook.pending" > "$CM_TMP/hook.later"
  cm_write_path_list "$CM_TMP/hook.later" "$state/$CM_HOOK_DEFERRED_FILE"
  if [ -z "$profile" ] && [ ! -s "$CM_TMP/hook.findings" ] && [ ! -s "$CM_TMP/hook.candidates" ] && [ "$CM_LIBRARIES_BLOCKING" -eq 0 ]; then
    return 0
  fi
  reason=$(
    printf '%s\n' "$CM_HOOK_HEADER"
    cm_single_line < "$CM_TMP/hook.warnings"
    [ -n "$profile" ] && printf '%s\n' "$profile" | cm_single_line
    cm_awk -F '\t' '/^@@summary/ { printf "Findings (%d errors, %d warnings):\n", $2, $3 }' "$CM_TMP/hook.report" > "$CM_TMP/hook.title"
    cm_capped "$(cat "$CM_TMP/hook.title")" "$CM_TMP/hook.findings" "$CM_HOOK_FINDINGS_LIMIT"
    cm_capped "Tournament candidates ($(grep -c . "$CM_TMP/hook.candidates")):" "$CM_TMP/hook.candidates" "$CM_HOOK_CANDIDATES_LIMIT"
    if [ -s "$CM_TMP/hook.libraries" ]; then
      printf 'Libraries:\n'
      cm_single_line < "$CM_TMP/hook.libraries"
    fi
    if [ "$unchecked" -gt 0 ]; then
      printf '… and %d more changed files not checked yet; they are checked on the next stop, or run check\n' "$unchecked"
    fi
  )
  printf '{"decision":"block","reason":%s}\n' "$(cm_json_quote "$reason")"
}
