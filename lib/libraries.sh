# libraries: one summary per npm dependency in .claude/skills/codemaster-libraries/.

CM_LIBRARIES_DIRECTORY=".claude/skills/codemaster-libraries"
CM_LIBRARIES_INDEX="SKILL.md"

cm_library_file() {
  printf '%s.md\n' "$1" | sed -e 's#^@##' -e 's#/#__#'
}

# Sets CM_LIBRARIES_PROBLEM ("" when every manifest is valid) and writes $CM_TMP/libraries.manifests.
cm_library_manifests() {
  local manifest
  CM_LIBRARIES_PROBLEM=""
  cm_manifests > "$CM_TMP/libraries.manifests"
  if [ ! -s "$CM_TMP/libraries.manifests" ]; then
    CM_LIBRARIES_PROBLEM="package.json: missing"
    return 0
  fi
  while IFS= read -r manifest; do
    if ! cm_json_flat "$CM_PROJECT_ROOT/$manifest" > "$CM_TMP/manifest.flat" 2>/dev/null || [ "$(cm_flat_type "" < "$CM_TMP/manifest.flat")" != "{" ]; then
      CM_LIBRARIES_PROBLEM="$manifest: invalid JSON"
      return 0
    fi
  done < "$CM_TMP/libraries.manifests"
}

# "name<TAB>dir|dir" for every declared dependency, sorted by name.
cm_library_declared() {
  local manifest directory sections="dependencies"
  [ "$(cm_cfg libraryDigestDev)" = "true" ] && sections="dependencies devDependencies"
  while IFS= read -r manifest; do
    cm_json_flat "$CM_PROJECT_ROOT/$manifest" > "$CM_TMP/manifest.flat" 2>/dev/null || continue
    directory=$(dirname "$manifest")
    for section in $sections; do
      cm_flat_keys "$section" < "$CM_TMP/manifest.flat"
    done | cm_awk -v directory="$directory" '$0 !~ /^@types\// && NF { print $0 "\t" directory }'
  done < "$CM_TMP/libraries.manifests" | cm_awk -F '\t' '
    { if (!($1 in dirs)) { names[++count] = $1; dirs[$1] = $2 } else dirs[$1] = dirs[$1] "|" $2 }
    END { for (position = 1; position <= count; position++) print names[position] "\t" dirs[names[position]] }' | LC_ALL=C sort -t "$(printf '\t')" -k1,1
}

# cm_library_installed <name> <dirs>: "version<TAB>readme<TAB>homepage" from the nearest node_modules, or status 1.
cm_library_installed() {
  local name="$1" dirs="$2" base relative readme version homepage candidate
  printf '%s' "$name" | grep -E -q '^(@[A-Za-z0-9~-][A-Za-z0-9._~-]*/)?[A-Za-z0-9~-][A-Za-z0-9._~-]*$' || return 1
  for base in $(printf '%s' "$dirs" | tr '|' '\n' | cm_awk '
    { current = $0; while (current != "." && current != "") { if (!seen[current]++) print current; if (index(current, "/") == 0) current = "."; else sub(/\/[^\/]*$/, "", current) } }
    END { print "." }' | cm_awk '!seen[$0]++'); do
    if [ "$base" = "." ]; then
      relative="node_modules/$name"
    else
      relative="$base/node_modules/$name"
    fi
    cm_json_flat "$CM_PROJECT_ROOT/$relative/package.json" > "$CM_TMP/installed.flat" 2>/dev/null || continue
    version=$(cm_flat_get version < "$CM_TMP/installed.flat")
    homepage=$(cm_flat_get homepage < "$CM_TMP/installed.flat")
    readme="-"
    for candidate in README.md readme.md Readme.md README; do
      if [ -f "$CM_PROJECT_ROOT/$relative/$candidate" ]; then
        readme="$relative/$candidate"
        break
      fi
    done
    printf '%s\t%s\t%s\n' "${version:-}" "$readme" "${homepage:--}"
    return 0
  done
  return 1
}

# "file<TAB>name<TAB>version<TAB>managed" for every summary.
cm_library_summaries() {
  local directory="$CM_PROJECT_ROOT/$CM_LIBRARIES_DIRECTORY" path
  [ -d "$directory" ] || return 0
  for path in "$directory"/*.md; do
    [ -f "$path" ] || continue
    [ "$(basename "$path")" = "$CM_LIBRARIES_INDEX" ] && continue
    tr -d '\r' < "$path" | cm_awk -v file="$(basename "$path")" '
      NR == 1 && $0 == "---" { inside = 1; next }
      inside && $0 == "---" { inside = 0; done = 1; next }
      inside && match($0, /^[A-Za-z0-9_-]+:/) {
        key = substr($0, 1, RLENGTH - 1)
        value = substr($0, RLENGTH + 1)
        sub(/^[ \t]+/, "", value)
        sub(/[ \t]+$/, "", value)
        fields[key] = value
        has[key] = 1
      }
      END {
        name = fields["name"]
        if (!("name" in has)) {
          name = file
          sub(/\.md$/, "", name)
          if (match(name, /__/)) name = "@" substr(name, 1, RSTART - 1) "/" substr(name, RSTART + 2)
        }
        printf "%s\t%s\t%s\t%d\n", file, name, fields["version"], ("name" in has && "version" in has)
      }'
  done | LC_ALL=C sort
}

# Writes $CM_TMP/libraries.diff with lines "add|stale|remove|missing|more ..." in report order.
cm_library_diff() {
  local name dirs installed file per_run
  per_run=$(cm_cfg libraryDigestPerRun)
  cm_library_manifests
  cm_library_declared > "$CM_TMP/libraries.declared"
  cm_library_summaries > "$CM_TMP/libraries.summaries"
  : > "$CM_TMP/libraries.state"
  while IFS="$(printf '\t')" read -r name dirs; do
    [ -n "$name" ] || continue
    file=$(cm_library_file "$name")
    if installed=$(cm_library_installed "$name" "$dirs"); then
      printf '%s\t%s\tinstalled\t%s\n' "$name" "$file" "$installed" >> "$CM_TMP/libraries.state"
    else
      printf '%s\t%s\tmissing\n' "$name" "$file" >> "$CM_TMP/libraries.state"
    fi
  done < "$CM_TMP/libraries.declared"
  cm_awk -F '\t' -v summaries="$CM_TMP/libraries.summaries" -v per_run="${per_run:-5}" -v problem="$CM_LIBRARIES_PROBLEM" '
    function major(version) { return match(version, /[0-9]+/) ? substr(version, RSTART, RLENGTH) : "" }
    BEGIN {
      while ((getline line < summaries) > 0) {
        split(line, parts, "\t")
        summary_version[parts[1]] = parts[3]
        summary_name[parts[1]] = parts[2]
        summary_managed[parts[1]] = parts[4]
        summary_files[++summary_count] = parts[1]
      }
    }
    {
      declared_file[$2] = 1
      if ($3 == "missing") { missing[++missing_count] = $1; next }
      if (!($2 in summary_version)) { pending[++pending_count] = "add " $1 " " $4 " readme=" $5 " homepage=" $6; next }
      if (major(summary_version[$2]) != major($4)) { pending[++pending_count] = "stale " $1 " " summary_version[$2] " -> " $4 }
    }
    END {
      for (position = 1; position <= pending_count && position <= per_run; position++) {
        if (pending[position] ~ /^add /) print pending[position]
      }
      for (position = 1; position <= pending_count && position <= per_run; position++) {
        if (pending[position] ~ /^stale /) print pending[position]
      }
      if (problem == "") {
        count = 0
        for (position = 1; position <= summary_count; position++) {
          file = summary_files[position]
          if (summary_managed[file] == 1 && !(file in declared_file)) removed[++count] = summary_name[file]
        }
        for (position = 2; position <= count; position++) {
          item = removed[position]; slot = position - 1
          while (slot > 0 && removed[slot] > item) { removed[slot + 1] = removed[slot]; slot-- }
          removed[slot + 1] = item
        }
        for (position = 1; position <= count; position++) print "remove " removed[position]
      }
      for (position = 1; position <= missing_count; position++) print "missing " missing[position] " (not installed)"
      if (pending_count > per_run) print "more " (pending_count - per_run)
    }' "$CM_TMP/libraries.state" > "$CM_TMP/libraries.diff"
}

# Prints the diff; with a limit, "remove" and "missing" lines are capped and the rest counted in "… and N more".
cm_library_lines() {
  cm_awk -v limit="${1:-0}" '
    $1 == "more" { more += $2; next }
    $1 == "remove" { if (limit > 0 && ++removes > limit) { more++; next } }
    $1 == "missing" { if (limit > 0 && ++missings > limit) { more++; next } }
    { print }
    END { if (more > 0) printf "… and %d more\n", more }' "$CM_TMP/libraries.diff"
}

# For the Stop hook: sets CM_LIBRARIES_BLOCKING and prints the capped lines.
cm_library_summary() {
  cm_library_diff
  if grep -q -E '^(add|stale|remove|more) ' "$CM_TMP/libraries.diff"; then
    CM_LIBRARIES_BLOCKING=1
  fi
  cm_library_lines "$1"
}

cm_library_writable() {
  local path real_root real_directory
  for path in .claude .claude/skills "$CM_LIBRARIES_DIRECTORY" "$CM_LIBRARIES_DIRECTORY/$CM_LIBRARIES_INDEX"; do
    if [ -L "$CM_PROJECT_ROOT/$path" ]; then
      cm_stderr "codemaster: refusing to write $CM_LIBRARIES_DIRECTORY: symlink or outside the project"
      return 1
    fi
  done
  if [ -d "$CM_PROJECT_ROOT/$CM_LIBRARIES_DIRECTORY" ]; then
    real_root=$(cd "$CM_PROJECT_ROOT" && pwd -P)
    real_directory=$(cd "$CM_PROJECT_ROOT/$CM_LIBRARIES_DIRECTORY" && pwd -P)
    case "$real_directory" in
      "$real_root"/*) ;;
      *)
        cm_stderr "codemaster: refusing to write $CM_LIBRARIES_DIRECTORY: symlink or outside the project"
        return 1
        ;;
    esac
  fi
}

cm_library_index() {
  local directory="$CM_PROJECT_ROOT/$CM_LIBRARIES_DIRECTORY" file name version managed
  cm_library_writable || return 1
  mkdir -p "$directory"
  {
    printf -- '---\nname: codemaster-libraries\ndescription: Summaries of this project'"'"'s libraries: key APIs, pitfalls and documentation links. Use before implementing something a dependency may already do.\n---\n'
    cm_library_summaries > "$CM_TMP/libraries.index"
    [ -s "$CM_TMP/libraries.index" ] && printf '\n'
    while IFS="$(printf '\t')" read -r file name version managed; do
      tr -d '\r' < "$directory/$file" | cm_awk -v name="$name" -v file="$file" '
        /^## / { if (inside) inside = 0; if ($0 ~ /^## Purpose[ \t]*$/) { inside = 1; next } }
        inside { text = text " " $0 }
        END {
          gsub(/[ \t]+/, " ", text)
          sub(/^ /, "", text)
          sub(/ $/, "", text)
          if (match(text, /[.!?]( |$)/)) text = substr(text, 1, RSTART)
          if (text == "") printf "- [%s](%s)\n", name, file
          else printf "- [%s](%s) — %s\n", name, file, text
        }'
    done < "$CM_TMP/libraries.index"
  } > "$CM_TMP/index.md"
  cat "$CM_TMP/index.md" > "$directory/$CM_LIBRARIES_INDEX"
}

cm_library_prune() {
  local file
  cm_library_writable || return 1
  cm_awk -F '\t' -v diff="$CM_TMP/libraries.diff" '
    BEGIN { while ((getline line < diff) > 0) if (line ~ /^remove /) removed[substr(line, 8)] = 1 }
    $4 == 1 && ($2 in removed) { print $1 }' "$CM_TMP/libraries.summaries" | while IFS= read -r file; do
    rm -f "$CM_PROJECT_ROOT/$CM_LIBRARIES_DIRECTORY/$file"
  done
}

cm_libraries_command() {
  local prune=0 index=0 argument
  if [ "$(cm_cfg libraryDigest)" != "true" ]; then
    printf 'libraries: disabled\n'
    return 0
  fi
  for argument in "$@"; do
    case "$argument" in
      --prune) prune=1 ;;
      --index) index=1 ;;
    esac
  done
  cm_library_diff
  if [ -n "$CM_LIBRARIES_PROBLEM" ]; then
    cm_stderr "warning libraries $CM_LIBRARIES_PROBLEM; nothing pruned"
    [ "$prune" -eq 1 ] && return 1
  fi
  if [ "$prune" -eq 1 ]; then
    cm_library_prune
  fi
  if [ "$prune" -eq 1 ] || [ "$index" -eq 1 ]; then
    cm_library_index
  fi
  if [ "$prune" -eq 1 ] || [ "$index" -eq 0 ]; then
    cm_library_lines
  fi
  return 0
}
