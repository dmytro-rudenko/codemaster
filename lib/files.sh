# Source file selection, file roles and layout detection.

cm_files_awk() {
  LC_ALL=C awk -f "$CM_AWK_DIR/util.awk" -f "$CM_AWK_DIR/cfg.awk" -f "$CM_AWK_DIR/lang.awk" \
    -f "$CM_AWK_DIR/roles.awk" -f "$CM_AWK_DIR/files.awk" "$@"
}

# Filters project paths on stdin to existing source files of enabled languages.
cm_select_sources() {
  local path
  cm_files_awk -v mode=filter "$CM_CONFIG" - | while IFS= read -r path; do
    [ -f "$CM_PROJECT_ROOT/$path" ] && printf '%s\n' "$path"
  done
}

# Every source file of the project: git's view in a repository, else a walk of the folders.
cm_all_sources() {
  if cm_is_repository; then
    cm_tracked_paths | cm_select_sources
  else
    cm_walk_sources ""
  fi
}

# cm_walk_sources <relative path>: source files under a path, without git.
cm_walk_sources() {
  local target="$1" start
  start="$CM_PROJECT_ROOT"
  [ -n "$target" ] && start="$CM_PROJECT_ROOT/$target"
  if [ -f "$start" ]; then
    printf '%s\n' "$target" | cm_select_sources
    return 0
  fi
  [ -d "$start" ] || return 0
  (
    cd "$CM_PROJECT_ROOT" || exit 0
    find "./${target:-.}" \( -name .git -o -name node_modules \) -prune -o -type f -print 2>/dev/null
  ) | sed -e 's#^\./##' -e 's#^\./##' -e 's#//*#/#g' | LC_ALL=C sort | cm_select_sources
}

cm_detect_layout() {
  if [ -n "${CM_LAYOUT:-}" ]; then
    printf '%s\n' "$CM_LAYOUT"
    return 0
  fi
  if [ "$CM_CFG_LAYOUT" != "auto" ]; then
    CM_LAYOUT="$CM_CFG_LAYOUT"
    printf '%s\n' "$CM_LAYOUT"
    return 0
  fi
  CM_LAYOUT=$(
    cm_source_roots | while IFS= read -r root; do
      directory="$CM_PROJECT_ROOT"
      [ -n "$root" ] && directory="$CM_PROJECT_ROOT/$root"
      [ -d "$directory" ] || continue
      for folder in "$directory"/*/ "$directory"/.*/; do
        [ -d "$folder" ] || continue
        name=$(basename "$folder")
        [ "$name" = "." ] || [ "$name" = ".." ] && continue
        printf '%s\t\n' "$name"
        for entry in "$folder"* "$folder".*; do
          [ -e "$entry" ] || continue
          entry_name=$(basename "$entry")
          [ "$entry_name" = "." ] || [ "$entry_name" = ".." ] && continue
          printf '%s\t%s\n' "$name" "$entry_name"
        done
      done
    done | cm_files_awk -v mode=layout "$CM_CONFIG" -
  )
  printf '%s\n' "$CM_LAYOUT"
}

# Paths on stdin to "path<TAB>role<TAB>entity<TAB>global<TAB>language" lines.
cm_roles() {
  cm_files_awk -v mode=roles -v layout="$(cm_detect_layout)" "$CM_CONFIG" -
}

cm_tests_location() {
  printf '%s\n' "${CM_CFG_TESTS_LOCATION:-tests}"
}
