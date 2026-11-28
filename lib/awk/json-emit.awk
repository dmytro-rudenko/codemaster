# Prints JSON from the flat lines of json.awk ("path<TAB>type<TAB>value").
# A later line for an existing path replaces its value in place.
# A line "path<TAB>-<TAB>" deletes the subtree; a later line for the same path refills the same slot.
# -v compact=1 prints one line; otherwise two-space indentation, like JSON.stringify(value, null, 2).
# POSIX awk; run with LC_ALL=C.

BEGIN {
  FS = "\t"
  count = 0
}

{
  path = $1
  type = $2
  value = $0
  sub(/^[^\t]*\t[^\t]*\t?/, "", value)
  if (type == "-") {
    remove(path)
    next
  }
  add(path, type, value)
}

function parent_of(path,    position) {
  position = last_slash(path)
  return position == 0 ? "" : substr(path, 1, position - 1)
}

function last_slash(path,    position, found) {
  found = 0
  for (position = 1; position <= length(path); position++) {
    if (substr(path, position, 1) == "/") {
      found = position
    }
  }
  return found
}

function key_of(path,    position) {
  position = last_slash(path)
  return position == 0 ? path : substr(path, position + 1)
}

function add(path, type, value,    parent) {
  if (!(path in known)) {
    known[path] = 1
    if (path != "") {
      parent = parent_of(path)
      if (!(parent in known)) {
        add(parent, "{", "")
      }
      child_count[parent]++
      child[parent, child_count[parent]] = path
    }
  }
  alive[path] = 1
  node_type[path] = type
  node_value[path] = value
}

function remove(path,    other, prefix) {
  prefix = path "/"
  for (other in known) {
    if (other == path || (path == "" ? 1 : substr(other, 1, length(prefix)) == prefix)) {
      alive[other] = 0
    }
  }
}

function key_text(key) {
  gsub(/%2F/, "/", key)
  gsub(/%09/, "\\t", key)
  gsub(/%25/, "%", key)
  gsub(/\\/, "\\\\", key)
  gsub(/"/, "\\\"", key)
  return "\"" key "\""
}

function pad(depth,    text, step) {
  text = ""
  for (step = 0; step < depth; step++) {
    text = text "  "
  }
  return text
}

function render(path, depth,    type, text, position, member, first, open, closing, separator, inner) {
  type = node_type[path]
  if (type == "s") {
    return "\"" node_value[path] "\""
  }
  if (type != "{" && type != "[") {
    return node_value[path]
  }
  open = type
  closing = type == "{" ? "}" : "]"
  text = ""
  first = 1
  separator = compact ? "," : ",\n"
  inner = compact ? "" : pad(depth + 1)
  for (position = 1; position <= child_count[path]; position++) {
    member = child[path, position]
    if (!alive[member]) {
      continue
    }
    text = text (first ? "" : separator) inner
    if (type == "{") {
      text = text key_text(key_of(member)) (compact ? ":" : ": ")
    }
    text = text render(member, depth + 1)
    first = 0
  }
  if (first) {
    return open closing
  }
  if (compact) {
    return open text closing
  }
  return open "\n" text "\n" pad(depth) closing
}

END {
  if ("" in known && alive[""]) {
    print render("", 0)
  }
}
