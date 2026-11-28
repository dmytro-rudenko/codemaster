# Loads .codemaster.json and .codemaster.local.json over lib/defaults.json.

CM_CONFIG_FILE=".codemaster.json"
CM_CONFIG_LOCAL_FILE=".codemaster.local.json"

# cm_config_load <project root>: writes $CM_CONFIG (flat effective config) and $CM_CONFIG_WARNINGS.
cm_config_load() {
  local root="$1" name path flat
  CM_CONFIG="$CM_TMP/config.flat"
  CM_CONFIG_WARNINGS="$CM_TMP/config.warnings"
  : > "$CM_CONFIG_WARNINGS"
  {
    printf '@@source defaults\n'
    cm_json_flat "$CM_ROOT/lib/defaults.json"
    for name in "$CM_CONFIG_FILE" "$CM_CONFIG_LOCAL_FILE"; do
      path="$root/$name"
      [ -f "$path" ] || continue
      if ! flat=$(cm_json_flat "$path"); then
        printf 'warning config %s: invalid JSON\n' "$name" >> "$CM_CONFIG_WARNINGS"
        continue
      fi
      if [ "$(printf '%s\n' "$flat" | cm_flat_type "")" != "{" ]; then
        printf 'warning config %s: expected object\n' "$name" >> "$CM_CONFIG_WARNINGS"
        continue
      fi
      printf '@@source %s\n' "$name"
      printf '%s\n' "$flat"
    done
  } | cm_awk_program config.awk -v warnings_file="$CM_CONFIG_WARNINGS" > "$CM_CONFIG"
  CM_CFG_HOOK=$(cm_cfg hook)
  CM_CFG_LAYOUT=$(cm_cfg layout)
  CM_CFG_TESTS_LOCATION=$(cm_cfg testsLocation)
}

cm_cfg() {
  cm_flat_get "$1" < "$CM_CONFIG"
}

cm_cfg_list() {
  cm_flat_list "$1" < "$CM_CONFIG"
}

cm_cfg_type() {
  cm_flat_type "$1" < "$CM_CONFIG"
}

# Source roots, one per line, normalised: no leading "./", no trailing "/", "." becomes "".
cm_source_roots() {
  local type
  type=$(cm_cfg_type sourceRoot)
  if [ "$type" = "[" ]; then
    cm_cfg_list sourceRoot
  else
    cm_cfg sourceRoot
  fi | cm_awk '{ gsub(/\\/, "/"); sub(/^\.(\/|$)/, ""); sub(/\/+$/, ""); print }'
}
