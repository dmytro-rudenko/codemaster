# File roles (module, single-file-module, interfaces, consts, helper, util, test, entrypoint, other).
# POSIX awk, together with util.awk, cfg.awk and lang.awk.

function roles_init(    items, count, position, root) {
  if (roles_ready) {
    return
  }
  roles_ready = 1
  count = cfg_list("sourceRoot", items)
  root_count = 0
  for (position = 1; position <= count; position++) {
    root = items[position]
    gsub(/\\/, "/", root)
    sub(/^\.(\/|$)/, "", root)
    sub(/\/+$/, "", root)
    source_root[++root_count] = root
  }
  split("module interfaces consts helper util", role_keys, " ")
  for (position = 1; position <= 5; position++) {
    role_aliases[role_keys[position]] = " " cfg_joined("roles/" role_keys[position]) " "
  }
  entry_count = cfg_list("entrypoints", entry_glob)
  tests_location = cfg_get("testsLocation")
  sub(/^\.\//, "", tests_location)
  sub(/\/+$/, "", tests_location)
  split("interfaces:interfaces interface:interfaces types:interfaces type:interfaces consts:consts const:consts constants:consts constant:consts helpers:helper helper:helper utils:util util:util", pairs, " ")
  for (position = 1; position in pairs; position++) {
    split(pairs[position], pair, ":")
    file_role[pair[1]] = pair[2]
  }
}

function alias_role(name,    position) {
  for (position = 1; position <= 5; position++) {
    if (index(role_aliases[role_keys[position]], " " name " ") > 0) {
      return role_keys[position]
    }
  }
  return ""
}

function name_role(name,    found) {
  found = alias_role(name)
  if (found != "") {
    return found
  }
  return (name in file_role) ? file_role[name] : ""
}

function without_extension(name) {
  sub(/\.[^.\/]+$/, "", name)
  return name
}

function entity_of(name) {
  name = without_extension(name)
  sub(/\..*$/, "", name)
  return name
}

function stem_of(name) {
  name = without_extension(name)
  sub(/^.*\./, "", name)
  return name
}

function is_test_name(name) {
  if (name ~ /\.(test|spec)\.[^.]+$/) {
    return 1
  }
  if (name ~ /^test_.*\.py$/ || name ~ /_test\.(py|go|rs|rb|c|cc|cpp|cxx|php|kt)$/ || name ~ /_spec\.rb$/) {
    return 1
  }
  return name ~ /[a-z0-9](Test|Tests|Spec|IT)\.(java|kt|kts|cs|php)$/
}

function is_test_folder(name) {
  return name == "tests" || name == "test" || name == "__tests__" || name == "spec"
}

function is_test_path(path,    segments, count, position) {
  count = split(path, segments, "/")
  if (is_test_name(segments[count])) {
    return 1
  }
  for (position = 1; position < count; position++) {
    if (is_test_folder(segments[position])) {
      return 1
    }
  }
  if (path ~ /(^|\/)src\/test\//) {
    return 1
  }
  return tests_location != "" && tests_location != "colocated" && (path == tests_location || substr(path, 1, length(tests_location) + 1) == tests_location "/")
}

# Fills relative[1..n] with the segments below the deepest source root holding the path; returns n or 0.
function relative_segments(path, relative,    segments, count, position, best, best_length, root_parts, root_length, part, matched) {
  count = split(path, segments, "/")
  best = 0
  best_length = -1
  for (position = 1; position <= root_count; position++) {
    root_length = source_root[position] == "" ? 0 : split(source_root[position], root_parts, "/")
    if (count <= root_length) {
      continue
    }
    matched = 1
    for (part = 1; part <= root_length; part++) {
      if (segments[part] != root_parts[part]) {
        matched = 0
        break
      }
    }
    if (matched && root_length > best_length) {
      best = position
      best_length = root_length
    }
  }
  split("", relative)
  if (best == 0) {
    return 0
  }
  for (position = best_length + 1; position <= count; position++) {
    relative[position - best_length] = segments[position]
  }
  return count - best_length
}

function global_name(name) {
  return name == "global" || name == "globals" || name == "shared" || name == "index"
}

function set_role(role, entity, is_global) {
  ROLE = role
  ENTITY = entity
  GLOBAL = is_global
}

function resolve_layered(relative, count,    role, entity) {
  if (count == 1) {
    set_role("single-file-module", entity_of(relative[1]), 0)
    return
  }
  role = alias_role(relative[1])
  if (role == "") {
    set_role("module", relative[1], 0)
    return
  }
  if (count > 2) {
    set_role(role, relative[2], 0)
    return
  }
  entity = entity_of(relative[2])
  if (role == "module") {
    set_role("single-file-module", entity, 0)
    return
  }
  if ((role == "consts" || role == "interfaces") && global_name(entity)) {
    set_role(role, "", 1)
    return
  }
  set_role(role, entity, 0)
}

function resolve_modular(relative, count,    role, position, found) {
  if (count == 1) {
    set_role("single-file-module", entity_of(relative[1]), 0)
    return
  }
  if (index(role_aliases["util"], " " relative[1] " ") > 0) {
    set_role("util", "", 0)
    return
  }
  found = name_role(stem_of(relative[count]))
  for (position = count - 1; found == "" && position >= 2; position--) {
    found = name_role(relative[position])
  }
  role = found == "" ? "module" : found
  set_role(role, relative[1], relative[1] == "global" || relative[1] == "shared")
}

# Sets ROLE, ENTITY ("" for none) and GLOBAL for a project path under a layout (modular, layered, off).
function resolve_role(path, layout,    relative, count, position) {
  roles_init()
  gsub(/\\/, "/", path)
  sub(/^\.\//, "", path)
  if (is_test_path(path)) {
    set_role("test", "", 0)
    return
  }
  for (position = 1; position <= entry_count; position++) {
    if (glob_match(path, entry_glob[position])) {
      set_role("entrypoint", "", 0)
      return
    }
  }
  count = relative_segments(path, relative)
  if (count == 0) {
    set_role("other", "", 0)
    return
  }
  if (layout == "off") {
    set_role("module", "", 0)
    return
  }
  if (layout == "layered") {
    resolve_layered(relative, count)
  } else {
    resolve_modular(relative, count)
  }
}
