# check: deterministic rules over source files.

cm_analyze_awk() {
  LC_ALL=C awk -f "$CM_AWK_DIR/util.awk" -f "$CM_AWK_DIR/cfg.awk" -f "$CM_AWK_DIR/grammar.awk" \
    -f "$CM_AWK_DIR/tree.awk" -f "$CM_AWK_DIR/functions.awk" -f "$CM_AWK_DIR/declarations.awk" \
    -f "$CM_AWK_DIR/analyze.awk" "$@"
}

# tree-sitter-typescript fails on f<typeof import("x")>(); a same-length placeholder keeps lines and columns.
cm_mask_type_imports() {
  cm_awk '{
    line = $0
    out = ""
    while (match(line, /typeof[ \t]+import\([ \t]*["\047][^"\047]*["\047][ \t]*\)/)) {
      head = substr(line, 1, RSTART - 1)
      matched = substr(line, RSTART, RLENGTH)
      keyword = matched
      sub(/import.*/, "", keyword)
      out = out head keyword
      filler = substr(matched, length(keyword) + 1)
      gsub(/./, "_", filler)
      out = out filler
      line = substr(line, RSTART + RLENGTH)
    }
    print out line
  }' "$1"
}

# cm_analyze_file <path> <role> <entity> <global> <language> <mode> [extra awk assignments...]
# Writes the dump next to $CM_TMP/tree and runs analyze.awk; prints its output.
cm_analyze_file() {
  local path="$1" role="$2" entity="$3" global="$4" language="$5" mode="$6" file failure output
  [ "$entity" = "-" ] && entity=""
  shift 6
  file="$CM_PROJECT_ROOT/$path"
  if ! failure=$(cm_ast_dump "$language" "$file" "$CM_TMP/tree"); then
    if [ "$mode" = "check" ]; then
      printf 'warning\tparse\t1\tcould not check: %s\t\n' "$failure"
    else
      printf 'parse\n'
    fi
    return 0
  fi
  output=$(cm_analyze_awk -v config_file="$CM_CONFIG" -v ast_file="$CM_TMP/tree.ast" -v cst_file="$CM_TMP/tree.cst" \
    -v source="$file" -v path="$path" -v language="$language" -v role="$role" -v entity="$entity" \
    -v global="$global" -v layout="$(cm_detect_layout)" -v mode="$mode" "$@" \
    "$CM_CONFIG" "$CM_TMP/tree.ast" "$CM_TMP/tree.cst")
  if [ "$language" = "typescript" ] || [ "$language" = "tsx" ]; then
    case "$output" in
      *parse*)
        if grep -q 'typeof[[:space:]]*import(' "$file"; then
          cm_mask_type_imports "$file" > "$CM_TMP/masked"
          if cm_ast_dump "$language" "$CM_TMP/masked" "$CM_TMP/tree" >/dev/null; then
            output=$(cm_analyze_awk -v config_file="$CM_CONFIG" -v ast_file="$CM_TMP/tree.ast" -v cst_file="$CM_TMP/tree.cst" \
              -v source="$CM_TMP/masked" -v path="$path" -v language="$language" -v role="$role" -v entity="$entity" \
              -v global="$global" -v layout="$(cm_detect_layout)" -v mode="$mode" "$@" \
              "$CM_CONFIG" "$CM_TMP/tree.ast" "$CM_TMP/tree.cst")
          fi
        fi
        ;;
    esac
  fi
  [ -n "$output" ] && printf '%s\n' "$output"
  return 0
}

# Project files' base names, for test files that may live anywhere (Python, Java, C#, PHP, Ruby, C).
cm_project_basenames() {
  if [ -z "${CM_BASENAMES_READY:-}" ]; then
    cm_all_sources | sed 's#^.*/##' | LC_ALL=C sort -u > "$CM_TMP/basenames"
    CM_BASENAMES_READY=1
  fi
}

# Reads role lines on stdin; prints test-placement findings.
cm_check_placement() {
  cm_awk -f "$CM_AWK_DIR/util.awk" -f "$CM_AWK_DIR/cfg.awk" -f "$CM_AWK_DIR/lang.awk" -f "$CM_AWK_DIR/roles.awk" \
    -f "$CM_AWK_DIR/placement.awk" -v location="$(cm_tests_location)" "$CM_CONFIG" -
}

# Reads role lines on stdin; prints test-mirror findings.
cm_check_mirrors() {
  local path severity expected paths names candidate found
  cm_awk -f "$CM_AWK_DIR/util.awk" -f "$CM_AWK_DIR/cfg.awk" -f "$CM_AWK_DIR/lang.awk" -f "$CM_AWK_DIR/mirror.awk" \
    -v location="$(cm_tests_location)" "$CM_CONFIG" - |
    while IFS="$(printf '\t')" read -r path severity expected paths names; do
      found=0
      case "$path" in
        *.rs) grep -q '#\[cfg(test)\]' "$CM_PROJECT_ROOT/$path" && found=1 ;;
      esac
      if [ "$found" -eq 0 ]; then
        for candidate in $(printf '%s' "$paths" | tr '|' '\n' | sed 's/ /%20/g'); do
          candidate=$(printf '%s' "$candidate" | sed 's/%20/ /g')
          if [ -f "$CM_PROJECT_ROOT/$candidate" ]; then
            found=1
            break
          fi
        done
      fi
      if [ "$found" -eq 0 ] && [ -n "$names" ]; then
        cm_project_basenames
        if printf '%s\n' "$names" | tr '|' '\n' | LC_ALL=C grep -F -x -q -f - "$CM_TMP/basenames"; then
          found=1
        fi
      fi
      if [ "$found" -eq 0 ]; then
        printf '%s\t1\t%s\ttest-mirror\tmissing test %s\n' "$path" "$severity" "$expected"
      fi
    done
}

# package.json files of the project: every folder but node_modules, .git, nested repositories and exclude.
cm_manifests() {
  (
    cd "$CM_PROJECT_ROOT" || exit 0
    find . \( -name node_modules -o -name .git \) -prune -o -name package.json -type f -print 2>/dev/null
  ) | sed 's#^\./##' | LC_ALL=C sort | while IFS= read -r manifest; do
    directory=$(dirname "$manifest")
    nested=0
    while [ "$directory" != "." ] && [ -n "$directory" ]; do
      if [ -e "$CM_PROJECT_ROOT/$directory/.git" ]; then
        nested=1
        break
      fi
      directory=$(dirname "$directory")
    done
    [ "$nested" -eq 0 ] && printf '%s\n' "$manifest"
  done | cm_exclude_filter
}

# Drops the paths on stdin that match "exclude".
cm_exclude_filter() {
  cm_awk -f "$CM_AWK_DIR/util.awk" -f "$CM_AWK_DIR/cfg.awk" -f "$CM_AWK_DIR/exclude.awk" "$CM_CONFIG" -
}

cm_check_simple_packages() {
  local manifest
  cm_manifests | while IFS= read -r manifest; do
    cm_json_flat "$CM_PROJECT_ROOT/$manifest" > "$CM_TMP/manifest.flat" || continue
    cm_awk -f "$CM_AWK_DIR/util.awk" -f "$CM_AWK_DIR/cfg.awk" -f "$CM_AWK_DIR/packages.awk" -v manifest="$manifest" -v flat="$CM_TMP/manifest.flat" \
      "$CM_CONFIG" "$CM_PROJECT_ROOT/$manifest"
  done
}

# Runs ast-grep YAML rules from rules/<language>/ (rules/typescript also covers tsx and javascript).
cm_scan_rules() {
  local roles_file="$1" language directory rule copy family
  for language in typescript tsx javascript python go rust java kotlin csharp php ruby c cpp; do
    cm_awk -F '\t' -v language="$language" '$5 == language && $2 != "test" { print $1 }' "$roles_file" > "$CM_TMP/scan.files"
    [ -s "$CM_TMP/scan.files" ] || continue
    family="$language"
    [ "$language" = "tsx" ] || [ "$language" = "javascript" ] && family="typescript"
    directory="$CM_ROOT/rules/$family"
    [ -d "$directory" ] || continue
    for rule in "$directory"/*.yml; do
      [ -f "$rule" ] || continue
      copy="$CM_TMP/rule-$language.yml"
      sed "s/^language: .*/language: $language/" "$rule" > "$copy"
      cm_scan_rule "$copy"
    done
  done
}

cm_scan_rule() {
  local rule="$1" status output
  (cd "$CM_PROJECT_ROOT" && tr '\n' '\0' < "$CM_TMP/scan.files" | xargs -0 "$CM_AST_GREP" scan --rule "$rule" --format github -- 2> "$CM_TMP/scan.err") > "$CM_TMP/scan.out"
  status=$?
  cm_awk '
    /^::(error|warning|notice|info|hint) / {
      level = substr($0, 3, index($0, " ") - 3)
      rest = substr($0, index($0, " ") + 1)
      split_at = index(rest, "::")
      properties = substr(rest, 1, split_at - 1)
      message = substr(rest, split_at + 2)
      count = split(properties, parts, ",")
      file = ""; line = 1; title = ""
      for (position = 1; position <= count; position++) {
        if (parts[position] ~ /^file=/) file = substr(parts[position], 6)
        else if (parts[position] ~ /^line=/) line = substr(parts[position], 6)
        else if (parts[position] ~ /^title=/) title = substr(parts[position], 7)
      }
      printf "%s\t%d\t%s\t%s\t%s\n", file, line, (level == "error" ? "error" : "warning"), title, message
    }' "$CM_TMP/scan.out"
  if [ "$status" -gt 1 ] || { [ "$status" -ne 0 ] && ! grep -q '^::' "$CM_TMP/scan.out"; }; then
    printf '(ast-grep)\t1\twarning\tast-grep\tast-grep failed: %s\n' "$(cm_first_line < "$CM_TMP/scan.err")"
  fi
}

# cm_run_checks <files file>: writes sorted raw findings to $CM_TMP/findings; sets CM_CHECKED_COUNT.
cm_run_checks() {
  local files="$1" path role entity global language line severity rule message reason functions
  cm_detect_layout > /dev/null
  : > "$CM_TMP/findings.raw"
  cm_roles < "$files" > "$CM_TMP/roles"
  cm_check_placement < "$CM_TMP/roles" >> "$CM_TMP/findings.raw"
  CM_CHECKED_COUNT=$(LC_ALL=C sort -u "$files" | grep -c .)
  : > "$CM_TMP/parsed.roles"
  while IFS="$(printf '\t')" read -r path role entity global language; do
    [ -n "$path" ] || continue
    cm_analyze_file "$path" "$role" "$entity" "$global" "$language" check > "$CM_TMP/file.findings"
    functions=-
    while IFS="$(printf '\t')" read -r severity rule line message reason; do
      [ -n "$rule" ] || continue
      if [ "$severity" = "@functions" ]; then
        functions="$line"
        continue
      fi
      printf '%s\t%s\t%s\t%s\t%s\n' "$path" "$line" "$severity" "$rule" "$message" >> "$CM_TMP/findings.raw"
    done < "$CM_TMP/file.findings"
    if ! grep -q "$(printf '^[a-z]*\tparse\t')" "$CM_TMP/file.findings"; then
      printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$path" "$role" "$entity" "$global" "$language" "$functions" >> "$CM_TMP/parsed.roles"
    fi
  done < "$CM_TMP/roles"
  if [ "$(cm_detect_layout)" != "off" ]; then
    cm_check_mirrors < "$CM_TMP/parsed.roles" >> "$CM_TMP/findings.raw"
  fi
  if [ -s "$CM_TMP/parsed.roles" ]; then
    cm_scan_rules "$CM_TMP/parsed.roles" >> "$CM_TMP/findings.raw"
  fi
  cm_check_simple_packages >> "$CM_TMP/findings.raw"
  LC_ALL=C sort -t "$(printf '\t')" -k1,1 -k2,2n -k4,4 -k5 -u "$CM_TMP/findings.raw" > "$CM_TMP/findings"
}

cm_report() {
  cm_awk -f "$CM_AWK_DIR/util.awk" -f "$CM_AWK_DIR/cfg.awk" -f "$CM_AWK_DIR/report.awk" \
    -v format="$1" -v files="${CM_CHECKED_COUNT:-0}" "$CM_CONFIG" "$CM_TMP/findings"
}

# Paths given on the command line to source files ("" for the project root).
cm_expand_paths() {
  local target prefix tracked=""
  if cm_is_repository; then
    tracked="$CM_TMP/tracked"
    cm_tracked_paths | cm_select_sources > "$tracked"
  fi
  CM_MISSING_PATH=""
  : > "$CM_TMP/expanded.all"
  for target in "$@"; do
    prefix=$(printf '%s' "$target" | sed -e 's#\\#/#g' -e 's#^\./##' -e 's#/*$##')
    [ "$prefix" = "." ] && prefix=""
    if [ -n "$tracked" ]; then
      cm_awk -v prefix="$prefix" 'prefix == "" || $0 == prefix || substr($0, 1, length(prefix) + 1) == prefix "/"' "$tracked"
    else
      cm_walk_sources "$prefix"
    fi > "$CM_TMP/expanded"
    if [ ! -s "$CM_TMP/expanded" ] && [ -z "$CM_MISSING_PATH" ]; then
      CM_MISSING_PATH="$target"
    fi
    cat "$CM_TMP/expanded" >> "$CM_TMP/expanded.all"
  done
  LC_ALL=C sort -u "$CM_TMP/expanded.all"
}

cm_check_command() {
  local json=0 all=0 argument
  for argument in "$@"; do
    case "$argument" in
      --json) json=1 ;;
      --all) all=1 ;;
    esac
  done
  if [ "$json" -eq 1 ]; then
    [ -s "$CM_CONFIG_WARNINGS" ] && cat "$CM_CONFIG_WARNINGS" >&2
  else
    cat "$CM_CONFIG_WARNINGS"
  fi
  local paths=""
  for argument in "$@"; do
    case "$argument" in
      --*) ;;
      *) paths=1 ;;
    esac
  done
  if [ -n "$paths" ]; then
    local list=()
    for argument in "$@"; do
      case "$argument" in
        --*) ;;
        *) list[${#list[@]}]="$argument" ;;
      esac
    done
    cm_expand_paths "${list[@]}" > "$CM_TMP/selected"
    if [ -n "$CM_MISSING_PATH" ]; then
      printf 'codemaster: no source files match %s\n' "$CM_MISSING_PATH"
      return 2
    fi
  elif [ "$all" -eq 1 ]; then
    cm_all_sources > "$CM_TMP/selected"
  elif cm_is_repository; then
    cm_changed_paths | cm_select_sources > "$CM_TMP/selected"
  else
    printf 'codemaster: not a git repository; pass paths\n'
    return 0
  fi
  cm_ensure_ast_grep || return 1
  cm_run_checks "$CM_TMP/selected"
  if [ "$json" -eq 1 ]; then
    cm_report json
  else
    cm_report text
  fi
  cm_report hook | cm_awk -F '\t' '/^@@summary/ { exit ($2 > 0) ? 1 : 0 }'
}
