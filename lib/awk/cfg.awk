# Reads the effective flat config (the first input file) into cfg_type and cfg_raw. POSIX awk.
# Use: FNR == NR { cfg_store(); next } in the main program.

function cfg_store(    value) {
  value = $0
  sub(/^[^\t]*\t[^\t]*\t?/, "", value)
  cfg_type[$1] = $2
  cfg_raw[$1] = value
}

function cfg_get(path) {
  if (!(path in cfg_type)) {
    return ""
  }
  return cfg_type[path] == "s" ? json_unescape(cfg_raw[path]) : cfg_raw[path]
}

function cfg_has(path) {
  return path in cfg_type
}

# Fills items[1..n] with the array members at path (or the single string there); returns n.
function cfg_list(path, items,    count, position) {
  split("", items)
  if (cfg_type[path] == "s") {
    items[1] = json_unescape(cfg_raw[path])
    return 1
  }
  count = 0
  for (position = 0; (path "/" position) in cfg_type; position++) {
    items[++count] = cfg_get(path "/" position)
  }
  return count
}

function cfg_joined(path,    items, count, position, out) {
  count = cfg_list(path, items)
  out = ""
  for (position = 1; position <= count; position++) {
    out = out (position > 1 ? " " : "") items[position]
  }
  return out
}

function cfg_severity_default(rule) {
  if (rule == "single-file-module-size" || rule == "file-name-suffix" || rule == "array-repeated-elements" || rule == "lookup-chain" || rule == "helpers-mixed-kind" || rule == "name-word-count" || rule == "max-call-nesting" || rule == "prefer-destructuring" || rule == "simple-package" || rule == "parse" || rule == "ast-grep") {
    return "warning"
  }
  return "error"
}

# Rule settings: rule_enabled, rule_max (or -1), rule_severity, rule_explicit, rule_reason.
function rule_setting(rule,    path, kind, raw) {
  path = "rules/" rule
  rule_enabled = 1
  rule_max = -1
  rule_severity = cfg_severity_default(rule)
  rule_explicit = 0
  rule_reason = ""
  kind = cfg_type[path]
  if (kind == "s") {
    raw = cfg_get(path)
    if (raw == "off") {
      rule_enabled = 0
    } else if (raw == "error" || raw == "warning") {
      rule_severity = raw
      rule_explicit = 1
    }
    return
  }
  if (kind != "{") {
    return
  }
  raw = cfg_get(path "/severity")
  if (raw == "error" || raw == "warning") {
    rule_severity = raw
    rule_explicit = 1
  }
  if (cfg_type[path "/max"] == "n") {
    rule_max = cfg_get(path "/max") + 0
  }
  if (cfg_type[path "/reason"] == "s") {
    rule_reason = cfg_get(path "/reason")
  }
}

function rule_limit(rule, fallback) {
  rule_setting(rule)
  return rule_max >= 0 ? rule_max : fallback
}
