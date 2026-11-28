# Merges config layers. Input: sections "@@source <name>" followed by flat JSON lines (json.awk).
# The first section is the defaults; each later section overrides it field by field.
# Prints the effective flat config; warnings go to the file given by -v warnings_file.
# POSIX awk; run with LC_ALL=C, together with util.awk.

BEGIN {
  FS = "\t"
  section = 0
  CONFIG_RULE_PROBLEM = "expected \"off\", a severity or {severity, max, reason}"
  allowed["layout"] = "auto|modular|layered|off"
  allowed["testSuffix"] = "test|spec"
  allowed["constantCase"] = "upper-snake|camel|pascal"
  allowed["interfacePrefix"] = "\"\"|I"
}

/^@@source / {
  if (section > 0) {
    apply_section()
  }
  section++
  source_name = substr($0, 10)
  split("", over_type)
  split("", over_value)
  next
}

{
  value = $0
  sub(/^[^\t]*\t[^\t]*\t?/, "", value)
  if (section == 1) {
    current_type[$1] = $2
    current_value[$1] = value
    remember($1)
  } else {
    over_type[$1] = $2
    over_value[$1] = value
    over_order[$1] = ++over_total
  }
}

END {
  if (section > 1) {
    apply_section()
  }
  for (path in current_type) {
    if (path != "") {
      member_count[parent_of(path)]++
      member[parent_of(path), member_count[parent_of(path)]] = path
    }
  }
  print_tree("")
}

function remember(path) {
  if (!(path in sequence)) {
    sequence[path] = ++sequence_total
  }
}

# Prints a path and its members depth first, members in the order they were first seen.
function print_tree(path,    count, position, slot, current, list) {
  if (path in current_type) {
    printf "%s\t%s\t%s\n", path, current_type[path], current_value[path]
  }
  count = member_count[path]
  for (position = 1; position <= count; position++) {
    list[position] = member[path, position]
  }
  for (position = 2; position <= count; position++) {
    current = list[position]
    slot = position - 1
    while (slot > 0 && sequence[list[slot]] > sequence[current]) {
      list[slot + 1] = list[slot]
      slot--
    }
    list[slot + 1] = current
  }
  for (position = 1; position <= count; position++) {
    print_tree(list[position])
  }
}

function warn(field, problem) {
  printf "warning config %s: %s\n", field, problem >> warnings_file
}

function apply_section() {
  if (section == 1) {
    return
  }
  if (!("" in over_type)) {
    return
  }
  merge_field("", "")
}

function describe(type) {
  if (type == "{") {
    return "object"
  }
  if (type == "[") {
    return "array"
  }
  if (type == "s") {
    return "string"
  }
  if (type == "n") {
    return "number"
  }
  if (type == "b") {
    return "boolean"
  }
  return "null"
}

function parent_of(path) {
  if (index(path, "/") == 0) {
    return ""
  }
  sub(/\/[^\/]*$/, "", path)
  return path
}

function key_of(path) {
  sub(/^.*\//, "", path)
  return path
}

function under(path, root) {
  return root == "" || path == root || substr(path, 1, length(root) + 1) == root "/"
}

function replace_subtree(path,    other) {
  for (other in current_type) {
    if (under(other, path)) {
      delete current_type[other]
      delete current_value[other]
    }
  }
  for (other in over_type) {
    if (under(other, path)) {
      current_type[other] = over_type[other]
      current_value[other] = over_value[other]
    }
  }
  remember_over(path)
}

# New paths take their order from the override file.
function remember_over(path,    other, count, position, slot, current, list) {
  count = 0
  for (other in over_type) {
    if (under(other, path) && !(other in sequence)) {
      list[++count] = other
    }
  }
  for (position = 2; position <= count; position++) {
    current = list[position]
    slot = position - 1
    while (slot > 0 && over_order[list[slot]] > over_order[current]) {
      list[slot + 1] = list[slot]
      slot--
    }
    list[slot + 1] = current
  }
  for (position = 1; position <= count; position++) {
    remember(list[position])
  }
}

function is_relative_path(raw,    text, parts, count, position) {
  text = json_unescape(raw)
  if (text !~ /^[A-Za-z0-9_@.\/-]+$/ || length(text) > 100 || substr(text, 1, 1) == "/") {
    return 0
  }
  count = split(text, parts, "/")
  for (position = 1; position <= count; position++) {
    if (parts[position] == "..") {
      return 0
    }
  }
  return 1
}

function valid_source_root(path,    other, found) {
  if (over_type[path] == "s") {
    return is_relative_path(over_value[path])
  }
  if (over_type[path] != "[") {
    return 0
  }
  found = 0
  for (other in over_type) {
    if (parent_of(other) == path && other != path) {
      if (over_type[other] != "s" || !is_relative_path(over_value[other])) {
        return 0
      }
      found = 1
    }
  }
  return found
}

function value_problem(field, path,    raw, other, options) {
  if (field in allowed) {
    raw = over_type[path] == "s" ? json_unescape(over_value[path]) : "?"
    options = "|" allowed[field] "|"
    if (raw == "" && index(options, "|\"\"|") > 0) {
      return ""
    }
    if (raw != "" && index(options, "|" raw "|") > 0) {
      return ""
    }
    return "expected one of " allowed[field]
  }
  if (over_type[path] == "[") {
    for (other in over_type) {
      if (parent_of(other) == path && other != path && over_type[other] != "s") {
        return "expected string[]"
      }
    }
  }
  return ""
}

function valid_rule(path,    raw, other, key) {
  if (over_type[path] == "s") {
    raw = json_unescape(over_value[path])
    return raw == "off" || raw == "error" || raw == "warning"
  }
  if (over_type[path] != "{") {
    return 0
  }
  for (other in over_type) {
    if (parent_of(other) != path || other == path) {
      continue
    }
    key = key_of(other)
    if (key == "severity" && !(over_type[other] == "s" && (over_value[other] == "error" || over_value[other] == "warning"))) {
      return 0
    }
    if (key == "max" && !(over_type[other] == "n" && over_value[other] ~ /^[0-9]+$/)) {
      return 0
    }
    if (key == "reason" && over_type[other] != "s") {
      return 0
    }
  }
  return 1
}

function merge_field(path, field,    base_kind, over_kind, problem, other, children, count, position, label) {
  if (!(path in over_type)) {
    return
  }
  label = field
  if (field == "sourceRoot") {
    if (valid_source_root(path)) {
      replace_subtree(path)
    } else {
      warn(label, "expected a relative path")
    }
    return
  }
  if (field == "coverageCommand") {
    if (over_type[path] == "z" || over_type[path] == "s") {
      replace_subtree(path)
    } else {
      warn(label, "expected string or null")
    }
    return
  }
  if (field == "testsLocation" && over_type[path] == "s" && json_unescape(over_value[path]) == "colocated") {
    warn(label, "\"colocated\" is not supported, using \"tests\"")
    return
  }
  base_kind = describe(current_type[path])
  over_kind = describe(over_type[path])
  if (base_kind != over_kind) {
    warn(label == "" ? source_name : label, "expected " base_kind)
    return
  }
  problem = value_problem(field, path)
  if (problem != "") {
    warn(label, problem)
    return
  }
  if (over_kind != "object") {
    replace_subtree(path)
    return
  }
  if (field == "rules" || field == "sources") {
    for (other in over_type) {
      if (parent_of(other) != path || other == path) {
        continue
      }
      if (field == "rules" && !valid_rule(other)) {
        warn("rules." key_of(other), CONFIG_RULE_PROBLEM)
        continue
      }
      replace_subtree(other)
    }
    return
  }
  count = 0
  for (other in current_type) {
    if (other != path && parent_of(other) == path) {
      children[++count] = other
    }
  }
  for (position = 1; position <= count; position++) {
    other = children[position]
    merge_field(other, field == "" ? key_of(other) : field "." key_of(other))
  }
}
