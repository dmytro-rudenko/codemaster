# The plugin's own files: manifests, hooks, skills, README.

frontmatter() {
  awk 'NR == 1 && $0 == "---" { inside = 1; next } inside && $0 == "---" { exit } inside { print }' "$PLUGIN_ROOT/$1"
}

json_value() {
  awk -f "$PLUGIN_ROOT/lib/awk/json.awk" "$PLUGIN_ROOT/$1" | awk -F '\t' -v path="$2" '$1 == path { print $3 }'
}

test_plugin_manifest() {
  assert_equal "codemaster" "$(json_value .claude-plugin/plugin.json name)"
  assert_equal "0.3.0" "$(json_value .claude-plugin/plugin.json version)"
  assert_equal "./hooks/hooks.json" "$(json_value .claude-plugin/plugin.json hooks)"
  assert_equal "0.3.0" "$(json_value .claude-plugin/marketplace.json plugins/0/version)"
}

test_hooks_run_the_bash_cli() {
  local stop session
  stop=$(json_value hooks/hooks.json hooks/Stop/0/hooks/0/command)
  session=$(json_value hooks/hooks.json hooks/SessionStart/0/hooks/0/command)
  assert_contains "$stop" 'bash \"${CLAUDE_PLUGIN_ROOT}/bin/codemaster\" hook-stop'
  assert_contains "$session" 'hook-session-start'
  assert_not_contains "$stop$session" "node"
}

test_skills_carry_their_names_and_versions() {
  assert_match '^name: codemaster$' "$(frontmatter skills/codemaster/SKILL.md)"
  assert_match '^version: 0\.3\.0$' "$(frontmatter skills/codemaster/SKILL.md)"
  assert_match '^name: codemaster-audit$' "$(frontmatter skills/codemaster-audit/SKILL.md)"
  assert_match '^version: 0\.3\.0$' "$(frontmatter skills/codemaster-audit/SKILL.md)"
}

test_readme_in_english_with_an_install_section() {
  assert_match '^## Install$' "$(cat "$PLUGIN_ROOT/README.md")"
}

test_no_node_toolchain_is_left() {
  assert_no_file "$PLUGIN_ROOT/package.json"
  assert_equal "" "$(cd "$PLUGIN_ROOT" && git ls-files | grep -E '(^|/)node_modules/|^src/|\.ts$' | grep -v '^tests/fixtures/')"
}

test_docs_name_the_bash_cli() {
  local file
  for file in README.md skills/codemaster/SKILL.md skills/codemaster-audit/SKILL.md skills/codemaster/references/rules.md skills/codemaster/references/tournament.md skills/codemaster/references/libraries.md; do
    assert_not_contains "$(cat "$PLUGIN_ROOT/$file")" "codemaster.ts"
  done
}
