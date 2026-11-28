# Syntax tree from ast-grep --debug-query dumps. POSIX awk, run with LC_ALL=C.
# The CST dump (all nodes) is merged with the AST dump (named nodes only) to mark named nodes.
# Arrays: node_kind, node_field, node_named, node_parent, node_depth, kid_count, kid[i, n],
# start_line, start_column, end_line, end_column (0-based, columns in bytes). Node 1 is the root.

function tree_reset() {
  node_total = 0
  named_total = 0
  named_pointer = 1
  dump_pending = ""
  dump_started = 0
  dump_finished = 0
}

# Splits one dump line into dump_indent, dump_field, dump_kind and the range; returns 0 when it is not a node.
function dump_parse(line,    range_start, range_text, label, numbers, colon) {
  if (line !~ /\([0-9]+,[0-9]+\)-\([0-9]+,[0-9]+\)$/) {
    return 0
  }
  range_start = match(line, / \([0-9]+,[0-9]+\)-\([0-9]+,[0-9]+\)$/)
  if (range_start == 0) {
    return 0
  }
  range_text = substr(line, range_start + 1)
  label = substr(line, 1, range_start - 1)
  dump_indent = match(label, /[^ ]/) - 1
  if (dump_indent < 0) {
    dump_indent = length(label)
    label = ""
  } else {
    label = substr(label, dump_indent + 1)
  }
  gsub(/[()]/, "", range_text)
  gsub(/-/, ",", range_text)
  split(range_text, numbers, ",")
  dump_start_line = numbers[1] + 0
  dump_start_column = numbers[2] + 0
  dump_end_line = numbers[3] + 0
  dump_end_column = numbers[4] + 0
  dump_field = ""
  if (label ~ /^[A-Za-z_][A-Za-z0-9_]*: ./) {
    colon = index(label, ": ")
    dump_field = substr(label, 1, colon - 1)
    label = substr(label, colon + 2)
  }
  dump_kind = label
  return 1
}

function dump_line_ready(line) {
  if (dump_finished) {
    return ""
  }
  if (!dump_started) {
    if (line ~ /^Debug (CST|AST):$/) {
      dump_started = 1
    }
    return ""
  }
  if (line == "" && dump_pending == "") {
    dump_finished = 1
    return ""
  }
  dump_pending = dump_pending == "" ? line : dump_pending "\n" line
  if (dump_pending ~ /\([0-9]+,[0-9]+\)-\([0-9]+,[0-9]+\)$/) {
    line = dump_pending
    dump_pending = ""
    return line
  }
  return ""
}

# Feed lines of the AST dump first, then the CST dump.
function tree_named_line(line) {
  line = dump_line_ready(line)
  if (line == "" || !dump_parse(line)) {
    return
  }
  named_total++
  named_key[named_total] = dump_field "|" dump_kind "|" dump_start_line "," dump_start_column "," dump_end_line "," dump_end_column
}

function tree_named_done() {
  dump_started = 0
  dump_finished = 0
  dump_pending = ""
}

function tree_cst_line(line,    depth, key, parent_node) {
  line = dump_line_ready(line)
  if (line == "" || !dump_parse(line)) {
    return
  }
  depth = dump_indent / 2
  node_total++
  node_kind[node_total] = dump_kind
  node_field[node_total] = dump_field
  node_depth[node_total] = depth
  start_line[node_total] = dump_start_line
  start_column[node_total] = dump_start_column
  end_line[node_total] = dump_end_line
  end_column[node_total] = dump_end_column
  key = dump_field "|" dump_kind "|" dump_start_line "," dump_start_column "," dump_end_line "," dump_end_column
  if (named_pointer <= named_total && named_key[named_pointer] == key) {
    node_named[node_total] = 1
    named_pointer++
  } else {
    node_named[node_total] = 0
  }
  depth_stack[depth] = node_total
  kid_count[node_total] = 0
  if (depth == 0) {
    node_parent[node_total] = 0
  } else {
    parent_node = depth_stack[depth - 1]
    node_parent[node_total] = parent_node
    kid_count[parent_node]++
    kid[parent_node, kid_count[parent_node]] = node_total
  }
}

function load_source(path,    line, count) {
  count = 0
  while ((getline line < path) > 0) {
    source_line[count++] = line
  }
  close(path)
  source_line_total = count
}

function node_text(node,    line, out) {
  if (start_line[node] == end_line[node]) {
    return substr(source_line[start_line[node]], start_column[node] + 1, end_column[node] - start_column[node])
  }
  out = substr(source_line[start_line[node]], start_column[node] + 1)
  for (line = start_line[node] + 1; line < end_line[node]; line++) {
    out = out "\n" source_line[line]
  }
  return out "\n" substr(source_line[end_line[node]], 1, end_column[node])
}

function line_of(node) {
  return start_line[node] + 1
}

function child_by_field(node, name,    position, member) {
  for (position = 1; position <= kid_count[node]; position++) {
    member = kid[node, position]
    if (node_field[member] == name) {
      return member
    }
  }
  return 0
}

function child_of_kind(node, kinds,    position, member) {
  for (position = 1; position <= kid_count[node]; position++) {
    member = kid[node, position]
    if (index(" " kinds " ", " " node_kind[member] " ") > 0) {
      return member
    }
  }
  return 0
}

function has_token(node, token,    position, member) {
  for (position = 1; position <= kid_count[node]; position++) {
    member = kid[node, position]
    if (!node_named[member] && node_kind[member] == token) {
      return 1
    }
  }
  return 0
}

# Fills list[1..n] with the named, non-comment children; returns n.
function named_children(node, list,    position, member, count) {
  split("", list)
  count = 0
  for (position = 1; position <= kid_count[node]; position++) {
    member = kid[node, position]
    if (node_named[member] && !is_comment(member)) {
      list[++count] = member
    }
  }
  return count
}

function is_comment(node) {
  return node_kind[node] ~ /comment/
}

function is_leaf(node) {
  return kid_count[node] == 0
}

# 1 when node lies inside ancestor (or is it).
function is_inside(node, ancestor) {
  while (node != 0) {
    if (node == ancestor) {
      return 1
    }
    node = node_parent[node]
  }
  return 0
}

function has_error() {
  for (error_node = 1; error_node <= node_total; error_node++) {
    if (node_kind[error_node] == "ERROR" || node_kind[error_node] ~ /^MISSING( |$)/) {
      return 1
    }
  }
  return 0
}
