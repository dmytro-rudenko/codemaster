# conventions: scans the project and writes its profile into .codemaster.json.

CM_CONVENTION_ROOTS="src app server lib"
CM_PACKAGE_MANIFESTS="package.json pyproject.toml setup.py go.mod Cargo.toml pom.xml build.gradle build.gradle.kts composer.json Gemfile"
CM_PROFILE_FIELDS="layout sourceRoot roles testsLocation testSuffix constantCase interfacePrefix entityPrefix rules"

# The raw .codemaster.json as flat lines in $CM_TMP/raw.flat ("{}" when missing). Status 1 when it is invalid.
cm_read_raw() {
  local path="$CM_PROJECT_ROOT/$CM_CONFIG_FILE"
  if [ ! -f "$path" ]; then
    printf '\t{\t\n' > "$CM_TMP/raw.flat"
    return 0
  fi
  if ! cm_json_flat "$path" > "$CM_TMP/raw.flat" || [ "$(cm_flat_type "" < "$CM_TMP/raw.flat")" != "{" ]; then
    printf '\t{\t\n' > "$CM_TMP/raw.flat"
    return 1
  fi
}

# A field the person wrote: present in the raw file without an entry in "sources". Keys: field or rules.<id>.
cm_user_owned() {
  local key="$1" path
  path="$key"
  case "$key" in
    rules.*) path="rules/${key#rules.}" ;;
  esac
  cm_awk -F '\t' -v path="$path" -v source="sources/$key" '
    $1 == source { sourced = 1 }
    $1 == path { present = 1 }
    END { exit (present && !sourced) ? 0 : 1 }' "$CM_TMP/raw.flat"
}

cm_find_source_root() {
  local name packages="" roots="" folder inner manifest found count=0 directory
  for name in $CM_CONVENTION_ROOTS; do
    if [ -d "$CM_PROJECT_ROOT/$name" ]; then
      printf 'sourceRoot\ts\t%s\n@source\tsourceRoot\tfound: %s\n' "$name" "$name"
      return 0
    fi
  done
  for directory in "$CM_PROJECT_ROOT"/*/; do
    [ -d "$directory" ] || continue
    folder=$(basename "$directory")
    case "$folder" in
      node_modules | dist | build | coverage | vendor | target | .*) continue ;;
    esac
    found=0
    for manifest in $CM_PACKAGE_MANIFESTS; do
      [ -f "$directory$manifest" ] && found=1
    done
    [ "$found" -eq 1 ] || continue
    inner="$folder"
    for name in $CM_CONVENTION_ROOTS; do
      if [ -d "$directory$name" ]; then
        inner="$folder/$name"
        break
      fi
    done
    packages="${packages:+$packages, }$folder"
    roots="$roots$inner
"
    count=$((count + 1))
  done
  if [ "$count" -eq 0 ]; then
    printf 'sourceRoot\ts\t.\n@source\tsourceRoot\tdefault\n'
  elif [ "$count" -eq 1 ]; then
    printf 'sourceRoot\ts\t%s\n@source\tsourceRoot\tpackages: %s\n' "${roots%?}" "$packages"
  else
    printf 'sourceRoot\t[\t\n'
    printf '%s' "$roots" | cm_awk 'NF { printf "sourceRoot/%d\ts\t%s\n", NR - 1, $0 }'
    printf '@source\tsourceRoot\tpackages: %s\n' "$packages"
  fi
}

# Replaces the subtrees of the given fields of a flat file with the lines of another flat file.
cm_flat_override() {
  local base="$1" patch="$2"
  cm_awk -F '\t' '
    FNR == NR { if ($1 !~ /^@/) { patched[$1] = 1; top = $1; sub(/\/.*$/, "", top); roots[top] = 1; lines[++count] = $0 } next }
    { top = $1; sub(/\/.*$/, "", top); if (!(top in roots)) print }
    END { for (position = 1; position <= count; position++) print lines[position] }' "$patch" "$base"
}

cm_flat_subtree() {
  cm_awk -F '\t' -v root="$1" '
    $1 == root { line = $0; sub(/^[^\t]*/, "", line); print line; next }
    substr($1, 1, length(root) + 1) == root "/" { line = $0; print substr(line, length(root) + 2) }' "$2"
}

cm_compact_json() {
  cm_flat_subtree "$1" "$2" | cm_json_emit compact
}

# Tallies of top-level constants in consts files and interfaces everywhere; prints profile lines.
cm_scan_declarations() {
  local config="$1" files="$2" path role entity global language
  : > "$CM_TMP/declarations"
  CM_SAVED_CONFIG="$CM_CONFIG"
  CM_CONFIG="$config"
  CM_LAYOUT=""
  cm_detect_layout > /dev/null
  cm_roles < "$files" > "$CM_TMP/scan.roles"
  while IFS="$(printf '\t')" read -r path role entity global language; do
    case "$role" in
      consts | interfaces) ;;
      *) continue ;;
    esac
    [ "$entity" = "-" ] && entity=""
    cm_analyze_file "$path" "$role" "$entity" "$global" "$language" declarations |
      cm_awk -F '\t' -v role="$role" -v entity="$entity" -v language="$language" 'NF >= 2 { print role "\t" entity "\t" $1 "\t" $2 "\t" language }' >> "$CM_TMP/declarations"
  done < "$CM_TMP/scan.roles"
  CM_CONFIG="$CM_SAVED_CONFIG"
  CM_LAYOUT=""
  cm_awk -F '\t' -v root="$CM_PROJECT_ROOT" '$2 != "test" && $2 != "other" && $2 != "consts" && $2 != "interfaces" { print root "/" $1 }' "$CM_TMP/scan.roles" |
    tr '\n' '\0' | xargs -0 env LC_ALL=C awk '
      /^[ \t]*(export[ \t]+)?(public[ \t]+|internal[ \t]+|private[ \t]+)*interface[ \t]+[A-Za-z_]/ {
        line = $0
        sub(/^.*interface[ \t]+/, "", line)
        sub(/[^A-Za-z0-9_].*$/, "", line)
        print "other\t\tinterface\t" line "\t-"
      }
      /^[ \t]*type[ \t]+[A-Za-z_][A-Za-z0-9_]*[ \t]+interface/ {
        line = $0
        sub(/^[ \t]*type[ \t]+/, "", line)
        sub(/[^A-Za-z0-9_].*$/, "", line)
        print "other\t\tinterface\t" line "\t-"
      }' /dev/null 2>/dev/null >> "$CM_TMP/declarations"
  cm_awk -F '\t' '
    function case_of(name) {
      if (name ~ /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/) return "upper-snake"
      if (name ~ /^[a-z][a-zA-Z0-9]*$/) return "camel"
      if (name ~ /^[A-Z][a-zA-Z0-9]*$/ && name ~ /[a-z]/) return "pascal"
      return ""
    }
    function dominant(key, counts, total, fallback,    best, best_count, item) {
      best = ""; best_count = 0
      for (item in counts) {
        if (counts[item] > best_count || (counts[item] == best_count && item < best)) { best = item; best_count = counts[item] }
      }
      if (best_count < 5 || best_count / total < 0.6) {
        printf "%s\t%s\t%s\n@source\t%s\tdefault\n", key, ((fallback == "true" || fallback == "false") ? "b" : "s"), fallback, key
        return
      }
      printf "%s\t%s\t%s\n@source\t%s\tdominant %d%% (%d/%d)\n", key, ((best == "true" || best == "false") ? "b" : "s"), best, key, int(best_count / total * 100 + 0.5), best_count, total
    }
    $3 == "interface" { prefixes[$4 ~ /^I[A-Z]/ ? "I" : ""]++; prefix_total++ }
    $1 == "consts" && $3 == "constant" {
      shape = case_of($4)
      if (shape != "") { cases[shape]++; case_total++ }
      if ($2 != "") {
        stem = tolower($2); gsub(/[-_]/, "", stem)
        name = tolower($4); gsub(/_/, "", name)
        entities[substr(name, 1, length(stem)) == stem ? "true" : "false"]++
        entity_total++
      }
    }
    END {
      dominant("constantCase", cases, case_total, "upper-snake")
      dominant("interfacePrefix", prefixes, prefix_total, "")
      dominant("entityPrefix", entities, entity_total, "true")
    }' "$CM_TMP/declarations"
}

# Adds an "@source" line for each profile field in the linter lines on stdin.
cm_linter_sources() {
  cm_awk -F '\t' -v source="$1" '
    { print }
    $1 ~ /^rules\/[^\/]+$/ { keys[++count] = "rules." substr($1, 7) }
    $1 !~ /\// { keys[++count] = $1 }
    END { for (position = 1; position <= count; position++) print "@source\t" keys[position] "\t" source }'
}

# Linter limits: ESLint (only when allowed, it runs repository code) or biome.json.
cm_scan_linters() {
  local linter="$1" files="$2" file roots eslint="$CM_PROJECT_ROOT/node_modules/.bin/eslint" status reason
  if [ -x "$eslint" ] || [ -f "$eslint" ]; then
    if [ "$linter" != "1" ]; then
      printf 'warning conventions eslint: skipped; run conventions --refresh to read it\n' >> "$CM_TMP/conventions.warnings"
      return 0
    fi
    file=$(cm_awk -F '\t' '$2 != "test" && $2 != "other" { print $1; exit }' "$CM_TMP/scan.roles")
    [ -n "$file" ] || file=$(head -n 1 "$files")
    [ -n "$file" ] || return 0
    (cd "$CM_PROJECT_ROOT" && cm_run_timeout 30 "$eslint" --print-config "./$file") > "$CM_TMP/eslint.out" 2> "$CM_TMP/eslint.err"
    status=$?
    if [ "$status" -ne 0 ]; then
      reason=$(cm_first_line < "$CM_TMP/eslint.err")
      [ "$status" -eq 124 ] && reason="${reason:-timed out}"
      printf 'warning conventions eslint: %s\n' "${reason:-exit $status}" >> "$CM_TMP/conventions.warnings"
      return 0
    fi
    if ! cm_json_flat "$CM_TMP/eslint.out" > "$CM_TMP/eslint.flat"; then
      printf 'warning conventions eslint: invalid JSON from --print-config\n' >> "$CM_TMP/conventions.warnings"
      return 0
    fi
    cm_awk -f "$CM_AWK_DIR/util.awk" -f "$CM_AWK_DIR/linters.awk" -v kind=eslint "$CM_TMP/eslint.flat" |
      cm_linter_sources "eslint --print-config"
    return 0
  fi
  if cm_json_flat "$CM_PROJECT_ROOT/biome.json" > "$CM_TMP/biome.flat" 2>/dev/null; then
    cm_awk -f "$CM_AWK_DIR/util.awk" -f "$CM_AWK_DIR/linters.awk" -v kind=biome "$CM_TMP/biome.flat" |
      cm_linter_sources biome.json
  fi
}

# cm_scan_conventions <linter 0|1>: writes $CM_TMP/profile.flat (fields the scanner owns) and $CM_TMP/profile.sources.
cm_scan_conventions() {
  local linter="$1" roots_patch config field key
  : > "$CM_TMP/conventions.warnings"
  cm_all_sources > "$CM_TMP/scan.files"
  cm_find_source_root > "$CM_TMP/found.flat"
  roots_patch="$CM_TMP/roots.flat"
  if cm_user_owned sourceRoot; then
    cm_flat_subtree sourceRoot "$CM_CONFIG" | cm_awk -F '\t' '{ path = $1 == "" ? "sourceRoot" : "sourceRoot/" $1; line = $0; sub(/^[^\t]*/, "", line); print path line }' > "$roots_patch"
  else
    grep -v '^@' "$CM_TMP/found.flat" > "$roots_patch"
  fi
  cm_flat_override "$CM_CONFIG" "$roots_patch" > "$CM_TMP/scan.config"
  cm_awk -f "$CM_AWK_DIR/util.awk" -f "$CM_AWK_DIR/cfg.awk" -f "$CM_AWK_DIR/lang.awk" -f "$CM_AWK_DIR/roles.awk" \
    -f "$CM_AWK_DIR/conventions.awk" -v roots="$(CM_CONFIG="$CM_TMP/scan.config" cm_source_roots | cm_awk '{ printf "%s%s", (NR > 1 ? "|" : ""), ($0 == "" ? "." : $0) }')" \
    "$CM_TMP/scan.config" "$CM_TMP/scan.files" >> "$CM_TMP/found.flat"
  if cm_user_owned roles; then
    config="$CM_TMP/scan.config"
  else
    grep '^roles' "$CM_TMP/found.flat" > "$CM_TMP/roles.flat"
    cm_flat_override "$CM_TMP/scan.config" "$CM_TMP/roles.flat" > "$CM_TMP/scan.roles.config"
    config="$CM_TMP/scan.roles.config"
  fi
  cm_scan_declarations "$config" "$CM_TMP/scan.files" >> "$CM_TMP/found.flat"
  cm_scan_linters "$linter" "$CM_TMP/scan.files" >> "$CM_TMP/found.flat"
  : > "$CM_TMP/profile.flat"
  : > "$CM_TMP/profile.sources"
  for key in $(cm_awk -F '\t' '$1 == "@source" && !seen[$2]++ { print $2 }' "$CM_TMP/found.flat"); do
    cm_user_owned "$key" && continue
    field="$key"
    case "$key" in
      rules.*) field="rules/${key#rules.}" ;;
    esac
    cm_awk -F '\t' -v field="$field" '$1 == field || substr($1, 1, length(field) + 1) == field "/"' "$CM_TMP/found.flat" >> "$CM_TMP/profile.flat"
    cm_awk -F '\t' -v key="$key" '$1 == "@source" && $2 == key { print $2 "\t" $3 }' "$CM_TMP/found.flat" | tail -n 1 >> "$CM_TMP/profile.sources"
  done
}

# Writes .codemaster.json: the raw file with the profile fields replaced and the sources merged.
cm_write_profile() {
  {
    cat "$CM_TMP/raw.flat"
    cm_awk -F '\t' '$1 !~ /^rules\// { top = $1; sub(/\/.*$/, "", top); if (!(top in done)) { done[top] = 1; print top "\t-\t" } }' "$CM_TMP/profile.flat"
    grep -v '^rules/' "$CM_TMP/profile.flat"
    if grep -q '^rules/' "$CM_TMP/profile.flat"; then
      grep -q "^rules$(printf '\t')" "$CM_TMP/raw.flat" || printf 'rules\t{\t\n'
      cm_awk -F '\t' '$1 ~ /^rules\/[^\/]*$/ { print $1 "\t-\t" }' "$CM_TMP/profile.flat"
      grep '^rules/' "$CM_TMP/profile.flat"
    fi
    grep -q "^sources$(printf '\t')" "$CM_TMP/raw.flat" || printf 'sources\t{\t\n'
    cm_awk -F '\t' '{ key = $1; gsub(/%/, "%25", key); gsub(/\//, "%2F", key); value = $2; gsub(/\\/, "\\\\", value); gsub(/"/, "\\\"", value); print "sources/" key "\ts\t" value }' "$CM_TMP/profile.sources"
  } | cm_json_emit > "$CM_TMP/profile.json" && cat "$CM_TMP/profile.json" > "$CM_PROJECT_ROOT/$CM_CONFIG_FILE"
}

# cm_format_profile <config flat> <sources file "key<TAB>source"> <layout>: the "codemaster profile:" block.
cm_format_profile() {
  local config="$1" sources="$2" layout="$3" field value source
  printf 'codemaster profile:\n'
  for field in $CM_PROFILE_FIELDS; do
    if [ "$field" = "layout" ]; then
      value="\"$layout\""
    else
      value=$(cm_compact_json "$field" "$config")
      [ -n "$value" ] || continue
    fi
    if [ "$field" = "rules" ]; then
      source=$(cm_awk -F '\t' '$1 ~ /^rules\./ && !seen[$2]++ { out = out (out == "" ? "" : ", ") $2 } END { print out }' "$sources")
      [ -n "$source" ] || source=$(cm_awk -F '\t' '$1 == "rules" { print $2 }' "$sources")
    else
      source=$(cm_awk -F '\t' -v key="$field" '$1 == key { found = $2 } END { print found }' "$sources")
    fi
    printf '  %s = %s  (%s)\n' "$field" "$value" "${source:-default}"
  done
}

# The sources of the effective config: "sources" of the file, "user" for fields written by hand.
cm_describe_sources() {
  {
    if [ "$CM_CFG_LAYOUT" = "auto" ]; then
      printf 'layout\tauto\n'
    else
      printf 'layout\tuser\n'
    fi
    cm_awk -F '\t' '$1 ~ /^sources\/[^\/]*$/ { key = substr($1, 9); gsub(/%2F/, "/", key); gsub(/%25/, "%", key); print key "\t" $3 }' "$CM_CONFIG"
    for key in $(cm_awk -F '\t' '$1 !~ /\// && $1 != "" { print $1 }' "$CM_TMP/raw.flat"); do
      cm_user_owned "$key" && printf '%s\tuser\n' "$key"
    done
  } > "$CM_TMP/describe.sources"
}

cm_conventions_command() {
  local refresh=0 argument warning
  for argument in "$@"; do
    [ "$argument" = "--refresh" ] && refresh=1
  done
  if ! cm_read_raw; then
    cm_stderr "warning config $CM_CONFIG_FILE: invalid JSON; profile not written"
    return 1
  fi
  if [ -f "$CM_PROJECT_ROOT/$CM_CONFIG_FILE" ] && [ "$refresh" -eq 0 ]; then
    cm_describe_sources
    cm_format_profile "$CM_CONFIG" "$CM_TMP/describe.sources" "$(cm_detect_layout)"
    return 0
  fi
  cm_ensure_ast_grep || return 1
  cm_scan_conventions "$refresh"
  cm_write_profile
  cm_config_load "$CM_PROJECT_ROOT"
  cm_read_raw
  CM_LAYOUT=""
  if [ -s "$CM_TMP/conventions.warnings" ]; then
    cat "$CM_TMP/conventions.warnings" >&2
  fi
  cm_describe_sources
  cm_format_profile "$CM_CONFIG" "$CM_TMP/describe.sources" "$(cm_detect_layout)"
  return 0
}
