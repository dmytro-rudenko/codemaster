# ast-grep: a prebuilt binary downloaded from the npm registry with curl (or wget) and tar.
# No npm or Node is needed. The binary lands in the data folder, never in the project.

CM_AST_GREP_VERSION="0.51.3"
CM_INSTALL_RETRY_SECONDS=3600

cm_data_directory() {
  if [ -n "${CODEMASTER_DATA_DIR:-}" ]; then
    printf '%s\n' "$CODEMASTER_DATA_DIR"
  elif [ -n "${XDG_DATA_HOME:-}" ]; then
    printf '%s/codemaster\n' "$XDG_DATA_HOME"
  else
    printf '%s/.local/share/codemaster\n' "${HOME:-.}"
  fi
}

cm_binary_name() {
  if [ "$(cm_platform)" = "win32" ]; then
    printf 'ast-grep.exe\n'
  else
    printf 'ast-grep\n'
  fi
}

cm_installed_binary() {
  printf '%s/ast-grep-%s/%s\n' "$(cm_data_directory)" "$CM_AST_GREP_VERSION" "$(cm_binary_name)"
}

# The npm package that carries the binary for this machine, e.g. cli-linux-x64-gnu.
cm_platform_package() {
  local platform machine libc
  platform=$(cm_platform)
  machine=$(uname -m 2>/dev/null)
  case "$machine" in
    x86_64 | amd64) machine="x64" ;;
    arm64 | aarch64) machine="arm64" ;;
    i386 | i686) machine="ia32" ;;
    *) return 1 ;;
  esac
  case "$platform" in
    darwin)
      [ "$machine" = "ia32" ] && return 1
      printf 'cli-darwin-%s\n' "$machine"
      ;;
    win32)
      printf 'cli-win32-%s-msvc\n' "$machine"
      ;;
    *)
      [ "$machine" = "ia32" ] && return 1
      libc="gnu"
      if ls /lib/ld-musl-* >/dev/null 2>&1 || (ldd --version 2>&1 | grep -qi musl); then
        libc="musl"
      fi
      printf 'cli-linux-%s-%s\n' "$machine" "$libc"
      ;;
  esac
}

cm_download() {
  local url="$1" target="$2"
  if cm_has_command curl; then
    curl -fsSL --retry 1 --connect-timeout 20 --max-time 170 -o "$target" "$url"
  elif cm_has_command wget; then
    wget -q -T 20 -O "$target" "$url"
  else
    printf 'neither curl nor wget is installed\n' >&2
    return 1
  fi
}

cm_install_ast_grep() {
  local data package registry url archive directory unpacked binary failure
  data=$(cm_data_directory)
  package=$(cm_platform_package) || {
    printf 'codemaster: install failed (no ast-grep build for %s %s)\n' "$(uname -s)" "$(uname -m)"
    return 1
  }
  registry="${CODEMASTER_REGISTRY:-${npm_config_registry:-https://registry.npmjs.org}}"
  registry="${registry%/}"
  url="$registry/@ast-grep/$package/-/$package-$CM_AST_GREP_VERSION.tgz"
  mkdir -p "$data" 2>/dev/null || {
    printf 'codemaster: install failed (cannot create %s)\n' "$data"
    return 1
  }
  directory="$data/ast-grep-$CM_AST_GREP_VERSION"
  unpacked=$(mktemp -d "$data/.download.XXXXXX") || {
    printf 'codemaster: install failed (cannot write %s)\n' "$data"
    return 1
  }
  archive="$unpacked/package.tgz"
  if ! failure=$(cm_download "$url" "$archive" 2>&1); then
    rm -rf "$unpacked"
    failure=$(printf '%s\n' "$failure" | cm_first_line)
    printf 'codemaster: install failed (%s)\n' "${failure:-download of $url failed}"
    return 1
  fi
  if ! failure=$(tar -xzf "$archive" -C "$unpacked" 2>&1); then
    rm -rf "$unpacked"
    printf 'codemaster: install failed (%s)\n' "$(printf '%s\n' "$failure" | cm_first_line)"
    return 1
  fi
  binary="$unpacked/package/$(cm_binary_name)"
  if [ ! -f "$binary" ]; then
    rm -rf "$unpacked"
    printf 'codemaster: install failed (no binary in %s)\n' "$package"
    return 1
  fi
  chmod +x "$binary" 2>/dev/null
  rm -rf "$directory"
  mkdir -p "$directory" && mv "$binary" "$directory/" && rm -rf "$unpacked"
  if ! "$(cm_installed_binary)" --version >/dev/null 2>&1; then
    printf 'codemaster: install failed (the downloaded ast-grep does not run)\n'
    return 1
  fi
  printf 'codemaster: installed ast-grep %s into %s\n' "$CM_AST_GREP_VERSION" "$directory"
}

# An ast-grep already on PATH; "sg" only when it really is ast-grep (util-linux also has an sg).
cm_path_ast_grep() {
  local candidate
  for candidate in ast-grep sg; do
    if cm_has_command "$candidate" && "$candidate" --version 2>/dev/null | grep -q '^ast-grep '; then
      command -v "$candidate"
      return 0
    fi
  done
  return 1
}

# Sets CM_AST_GREP. Installs on first use; after a failed install waits an hour before the next try.
# Prints a one-line message on failure (and on install) to stderr.
cm_ensure_ast_grep() {
  local marker failed_at now message fallback
  if [ -n "${CM_AST_GREP:-}" ]; then
    return 0
  fi
  if [ -n "${CODEMASTER_AST_GREP:-}" ]; then
    CM_AST_GREP="$CODEMASTER_AST_GREP"
    return 0
  fi
  if [ -x "$(cm_installed_binary)" ]; then
    CM_AST_GREP=$(cm_installed_binary)
    return 0
  fi
  marker="$(cm_data_directory)/install-failed"
  now=$(date +%s)
  failed_at=$(cat "$marker" 2>/dev/null)
  case "$failed_at" in
    '' | *[!0-9]*) failed_at=0 ;;
  esac
  fallback=$(cm_path_ast_grep)
  if [ $((failed_at + CM_INSTALL_RETRY_SECONDS)) -gt "$now" ]; then
    if [ -n "$fallback" ]; then
      CM_AST_GREP="$fallback"
      return 0
    fi
    cm_stderr "codemaster: install failed recently; retrying after $((failed_at + CM_INSTALL_RETRY_SECONDS - now)) seconds; run codemaster install to retry now"
    return 1
  fi
  if message=$(cm_install_ast_grep); then
    rm -f "$marker"
    cm_stderr "$message"
    CM_AST_GREP=$(cm_installed_binary)
    return 0
  fi
  mkdir -p "$(cm_data_directory)" 2>/dev/null && printf '%s\n' "$now" > "$marker"
  if [ -n "$fallback" ]; then
    CM_AST_GREP="$fallback"
    return 0
  fi
  cm_stderr "$message"
  return 1
}

cm_install_command() {
  rm -f "$(cm_data_directory)/install-failed"
  if cm_ensure_ast_grep; then
    "$CM_AST_GREP" --version 2>/dev/null | sed 's/^/codemaster: using /' >&2
  fi
  return 0
}

# The largest file (bytes) that fits into one command-line argument.
cm_parse_limit() {
  case "$(cm_platform)" in
    win32) printf '30000\n' ;;
    darwin) printf '900000\n' ;;
    *) printf '120000\n' ;;
  esac
}

# cm_ast_dump <language> <file> <out prefix>: writes <prefix>.cst and <prefix>.ast (tree dumps).
# ast-grep prints the tree of a pattern with --debug-query; the whole file is passed as the pattern.
cm_ast_dump() {
  local language="$1" file="$2" prefix="$3" size text
  size=$(wc -c < "$file" | tr -d ' ')
  if [ "$size" -gt "$(cm_parse_limit)" ]; then
    printf 'too large (%s bytes) for one ast-grep call\n' "$size"
    return 1
  fi
  if [ "$size" -eq 0 ]; then
    : > "$prefix.cst"
    : > "$prefix.ast"
    return 0
  fi
  text=$(cat "$file"; printf x)
  text="${text%x}"
  "$CM_AST_GREP" run --lang "$language" --pattern "$text" --debug-query=cst --stdin < /dev/null > /dev/null 2> "$prefix.cst"
  "$CM_AST_GREP" run --lang "$language" --pattern "$text" --debug-query=ast --stdin < /dev/null > /dev/null 2> "$prefix.ast"
  if ! grep -q '^Debug CST:' "$prefix.cst"; then
    cm_first_line < "$prefix.cst"
    return 1
  fi
  return 0
}
