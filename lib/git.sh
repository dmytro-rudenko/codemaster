# git helpers. Paths are relative to the project root and use "/".

cm_git() {
  git -C "$CM_PROJECT_ROOT" "$@" 2>/dev/null
}

cm_is_repository() {
  [ "$(cm_git rev-parse --is-inside-work-tree)" = "true" ]
}

cm_has_revision() {
  cm_git rev-parse --verify --quiet "$1" >/dev/null
}

cm_base_branch() {
  local remote current branch
  remote=$(cm_git symbolic-ref --short refs/remotes/origin/HEAD)
  if [ -n "$remote" ]; then
    printf '%s\n' "$remote"
    return 0
  fi
  current=$(cm_git branch --show-current)
  for branch in main master dev; do
    [ "$branch" = "$current" ] && continue
    if cm_has_revision "refs/heads/$branch"; then
      printf '%s\n' "$branch"
      return 0
    fi
  done
  return 1
}

cm_merge_base() {
  local base
  base=$(cm_base_branch) || return 1
  cm_git merge-base HEAD "$base"
}

# The commit the branch is compared with: the merge base, else HEAD, else nothing (no commits yet).
cm_diff_base() {
  if [ -z "${CM_DIFF_BASE_DONE:-}" ]; then
    CM_DIFF_BASE=$(cm_merge_base)
    if [ -z "$CM_DIFF_BASE" ] && cm_has_revision HEAD; then
      CM_DIFF_BASE="HEAD"
    fi
    CM_DIFF_BASE_DONE=1
  fi
  [ -n "$CM_DIFF_BASE" ] && printf '%s\n' "$CM_DIFF_BASE"
}

# Paths changed on the branch (committed, uncommitted) plus untracked ones, one per line.
cm_changed_paths() {
  local base
  base=$(cm_diff_base)
  {
    if [ -n "$base" ]; then
      cm_git -c core.quotePath=false diff --name-only --relative "$base"
    else
      cm_git -c core.quotePath=false ls-files --cached
    fi
    cm_git -c core.quotePath=false ls-files --others --exclude-standard
  } | LC_ALL=C sort -u
}

cm_tracked_paths() {
  cm_git -c core.quotePath=false ls-files --cached --others --exclude-standard | LC_ALL=C sort -u
}

# cm_changed_ranges <file>: "start end" lines of the changed hunks, or "new" for a file git does not track.
cm_changed_ranges() {
  local base="$1" file="$2"
  if [ -z "$base" ] || ! cm_git ls-files --error-unmatch -- "$file" >/dev/null; then
    printf 'new\n'
    return 0
  fi
  cm_git diff -U0 "$base" -- "$file" | cm_awk '
    /^@@ / {
      spec = $3
      sub(/^\+/, "", spec)
      count = 1
      if (index(spec, ",") > 0) {
        count = substr(spec, index(spec, ",") + 1) + 0
        spec = substr(spec, 1, index(spec, ",") - 1)
      }
      if (count > 0) {
        print spec + 0, spec + count - 1
      }
    }'
}

cm_state_directory() {
  local path
  path=$(cm_git rev-parse --git-path codemaster) || return 1
  [ -n "$path" ] || return 1
  case "$path" in
    /* | [A-Za-z]:*) ;;
    *) path="$CM_PROJECT_ROOT/$path" ;;
  esac
  mkdir -p "$path" 2>/dev/null || return 1
  printf '%s\n' "$path"
}
