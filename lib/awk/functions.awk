# Functions in the tree: names, parameters, nesting and the tournament metrics. POSIX awk.
# Needs tree.awk and grammar.awk.

function is_function(node) {
  return node_is("function", node)
}

function is_class_like(node,    kind) {
  kind = node_kind[node]
  return node_is("class", node) || kind == "class_definition" || kind == "class_specifier" || kind == "struct_specifier" || kind == "impl_item" || kind == "class" || kind == "module" || kind == "object_declaration" || kind == "interface_declaration" || kind == "trait_declaration" || kind == "trait_item" || kind == "struct_declaration" || kind == "record_declaration" || kind == "enum_declaration"
}

# The identifier node that names a declaration (field name, the C declarator chain, Kotlin's first identifier).
function declared_name(node,    found, member, guard) {
  found = child_by_field(node, "name")
  if (found != 0) {
    return identifier_within(found)
  }
  found = child_by_field(node, "declarator")
  guard = 0
  while (found != 0 && guard++ < 20) {
    if (node_is("identifier", found) || node_kind[found] == "qualified_identifier" || node_kind[found] == "destructor_name" || node_kind[found] == "operator_name") {
      return found
    }
    member = child_by_field(found, "declarator")
    if (member == 0) {
      member = child_of_kind(found, "identifier field_identifier type_identifier qualified_identifier")
    }
    found = member
  }
  if (LANGUAGE == "kotlin") {
    return child_of_kind(node, "simple_identifier type_identifier")
  }
  return 0
}

# Descends to the identifier inside wrappers such as PHP variable_name.
function identifier_within(node,    member, guard) {
  guard = 0
  while (node != 0 && !node_is("identifier", node) && guard++ < 10) {
    member = child_of_kind(node, "identifier name simple_identifier constant type_identifier field_identifier property_identifier")
    if (member == 0) {
      return node_named[node] && is_leaf(node) ? node : 0
    }
    node = member
  }
  return node
}

function owner_name(function_node,    ancestor, found) {
  ancestor = node_parent[function_node]
  while (ancestor != 0) {
    if (is_function(ancestor)) {
      return ""
    }
    if (is_class_like(ancestor)) {
      if (node_kind[ancestor] == "impl_item") {
        found = child_by_field(ancestor, "type")
        return found == 0 ? "" : node_text(found)
      }
      found = declared_name(ancestor)
      return found == 0 ? "" : node_text(found)
    }
    ancestor = node_parent[ancestor]
  }
  return ""
}

function receiver_name(function_node,    receiver, text) {
  receiver = child_by_field(function_node, "receiver")
  if (receiver == 0) {
    return ""
  }
  text = node_text(receiver)
  gsub(/[()*\[\]]/, " ", text)
  gsub(/[ \t\n]+/, " ", text)
  text = trim(text)
  sub(/^.* /, "", text)
  return text
}

# The variable a function value is assigned to, if any.
function assigned_name(function_node,    parent_node, kind, target) {
  parent_node = node_parent[function_node]
  while (parent_node != 0 && (node_kind[parent_node] == "parenthesized_expression" || node_kind[parent_node] == "expression_list")) {
    parent_node = node_parent[parent_node]
  }
  if (parent_node == 0) {
    return ""
  }
  kind = node_kind[parent_node]
  if (kind == "variable_declarator" || kind == "assignment" || kind == "assignment_expression" || kind == "let_declaration" || kind == "short_var_declaration" || kind == "var_spec" || kind == "property_declaration" || kind == "init_declarator" || kind == "lexical_declaration") {
    target = child_by_field(parent_node, "name")
    if (target == 0) {
      target = child_by_field(parent_node, "left")
    }
    if (target == 0) {
      target = child_by_field(parent_node, "pattern")
    }
    if (target == 0) {
      target = child_by_field(parent_node, "declarator")
    }
    if (target == 0 && kind == "property_declaration") {
      target = child_of_kind(parent_node, "variable_declaration")
    }
    if (target == 0 && kind == "variable_declarator") {
      target = child_of_kind(parent_node, "identifier")
    }
    target = identifier_within(target)
    if (target != 0 && target != function_node && !is_inside(target, function_node)) {
      return node_text(target)
    }
  }
  return ""
}

# Sets FUNCTION_NAME ("" for anonymous), FUNCTION_BARE (without the owner) and FUNCTION_METHOD.
function resolve_function_name(node,    found, owner) {
  FUNCTION_METHOD = 0
  found = declared_name(node)
  FUNCTION_BARE = found == 0 ? assigned_name(node) : node_text(found)
  FUNCTION_NAME = FUNCTION_BARE
  if (FUNCTION_BARE == "" || found == 0) {
    return
  }
  owner = LANGUAGE == "go" ? receiver_name(node) : owner_name(node)
  if (owner != "") {
    FUNCTION_METHOD = 1
    FUNCTION_NAME = owner "." FUNCTION_BARE
  }
}

function parameter_list(node,    found, guard) {
  found = child_by_field(node, "parameters")
  if (found != 0) {
    return found
  }
  found = child_by_field(node, "declarator")
  guard = 0
  while (found != 0 && guard++ < 20) {
    if (node_kind[found] == "function_declarator") {
      return child_by_field(found, "parameters")
    }
    found = child_by_field(found, "declarator")
  }
  found = child_of_kind(node, "function_value_parameters lambda_parameters block_parameters closure_parameters method_parameters parameter_list formal_parameters")
  return found
}

function is_self_parameter(member, position,    text) {
  if (node_is("this", member) || node_kind[member] == "self_parameter" || node_kind[member] == "receiver_parameter") {
    return 1
  }
  text = node_text(member)
  if (SCRIPT && text ~ /^this([^A-Za-z0-9_$]|$)/) {
    return 1
  }
  return LANGUAGE == "python" && position == 1 && (text == "self" || text == "cls" || text ~ /^(self|cls)[ :]/)
}

# Fills names[1..n] with the identifier nodes the parameters declare; returns the parameter count.
function collect_parameters(node, names,    list, single, count, members, total, position, member, found, name_count, kids, kid_position) {
  split("", names)
  name_count = 0
  single = child_by_field(node, "parameter")
  list = parameter_list(node)
  if (list == 0) {
    if (single != 0) {
      found = identifier_within(single)
      if (found != 0 && node_is("identifier", found)) {
        names[++name_count] = found
      }
      return 1
    }
    return 0
  }
  total = named_children(list, members)
  count = 0
  for (position = 1; position <= total; position++) {
    member = members[position]
    if (is_self_parameter(member, position)) {
      continue
    }
    if ((LANGUAGE == "c" || LANGUAGE == "cpp") && total == 1 && node_text(member) == "void") {
      continue
    }
    if (LANGUAGE == "go" && node_kind[member] == "parameter_declaration") {
      found = 0
      for (kid_position = 1; kid_position <= kid_count[member]; kid_position++) {
        kids = kid[member, kid_position]
        if (node_field[kids] == "name") {
          names[++name_count] = kids
          found++
        }
      }
      count += found == 0 ? 1 : found
      continue
    }
    count++
    found = parameter_name(member)
    if (found != 0) {
      names[++name_count] = found
    }
  }
  return count
}

function parameter_name(member,    kind, found) {
  kind = node_kind[member]
  if (node_is("identifier", member)) {
    return member
  }
  if (kind == "object_pattern" || kind == "array_pattern" || kind == "tuple_pattern") {
    return 0
  }
  found = child_by_field(member, "pattern")
  if (found == 0) {
    found = child_by_field(member, "name")
  }
  if (found == 0) {
    found = child_by_field(member, "left")
  }
  if (found == 0) {
    found = child_by_field(member, "declarator")
    while (found != 0 && !node_is("identifier", found) && child_by_field(found, "declarator") != 0) {
      found = child_by_field(found, "declarator")
    }
  }
  if (found == 0) {
    found = child_of_kind(member, "identifier simple_identifier variable_name")
  }
  if (found == 0) {
    return 0
  }
  if (node_kind[found] == "object_pattern" || node_kind[found] == "array_pattern") {
    return 0
  }
  found = identifier_within(found)
  return found != 0 && node_is("identifier", found) ? found : 0
}

function function_body(node,    body) {
  body = child_by_field(node, "body")
  if (body == 0) {
    body = child_of_kind(node, "function_body statements block")
  }
  return body
}

function uses_this(node,    stack, top, current, position, member) {
  top = 0
  for (position = 1; position <= kid_count[node]; position++) {
    stack[++top] = kid[node, position]
  }
  while (top > 0) {
    current = stack[top--]
    if (node_is("this", current)) {
      return 1
    }
    if (is_function(current) && node_kind[current] != "arrow_function") {
      continue
    }
    for (position = 1; position <= kid_count[current]; position++) {
      stack[++top] = kid[current, position]
    }
  }
  return 0
}

function is_else_if(node,    parent_node, grand) {
  if (!node_is("if", node)) {
    return 0
  }
  parent_node = node_parent[node]
  if (node_is("else", parent_node)) {
    return 1
  }
  if (node_field[node] == "alternative" && node_is("if", parent_node)) {
    return 1
  }
  if (node_kind[parent_node] == "control_structure_body" && node_field[parent_node] == "alternative" && kid_count[parent_node] == 1) {
    return 1
  }
  return 0
}

function opens_block(node) {
  return node_is("block", node) && !is_else_if(node)
}

# The first control block deeper than the limit inside a function (nested functions excluded), or 0.
function find_deep_block(node, level, limit,    position, member, depth, found) {
  for (position = 1; position <= kid_count[node]; position++) {
    member = kid[node, position]
    if (is_function(member)) {
      continue
    }
    depth = opens_block(member) ? level + 1 : level
    if (depth > limit) {
      return member
    }
    found = find_deep_block(member, depth, limit)
    if (found != 0) {
      return found
    }
  }
  return 0
}

# The argument list (Kotlin call_suffix included) a node sits in, unwrapping argument wrappers; 0 if none.
function enclosing_arguments(node,    parent_node) {
  parent_node = node_parent[node]
  while (parent_node != 0 && node_is("argwrap", parent_node)) {
    parent_node = node_parent[parent_node]
  }
  if (parent_node != 0 && (node_is("arglist", parent_node) || node_field[node] == "arguments")) {
    return parent_node
  }
  return 0
}

function is_callback(node) {
  if (!is_function(node)) {
    return 0
  }
  if (LANGUAGE == "ruby" && (node_kind[node] == "block" || node_kind[node] == "do_block")) {
    return 1
  }
  return enclosing_arguments(node) != 0
}

function callback_depth(node, level,    position, deepest, value, member) {
  deepest = level
  for (position = 1; position <= kid_count[node]; position++) {
    member = kid[node, position]
    value = callback_depth(member, is_callback(member) ? level + 1 : level)
    if (value > deepest) {
      deepest = value
    }
  }
  return deepest
}

function arguments_of(call,    found) {
  found = child_by_field(call, "arguments")
  if (found != 0) {
    return found
  }
  found = child_of_kind(call, "arguments argument_list call_suffix value_arguments")
  if (found != 0 && node_kind[found] == "call_suffix") {
    return found
  }
  return found
}

# Depth of calls nested as arguments: a(b(c())) is 3.
function call_depth(call,    arguments_node, stack, top, current, position, deepest, value) {
  arguments_node = arguments_of(call)
  deepest = 0
  if (arguments_node == 0) {
    return 1
  }
  top = 0
  for (position = 1; position <= kid_count[arguments_node]; position++) {
    stack[++top] = kid[arguments_node, position]
  }
  while (top > 0) {
    current = stack[top--]
    if (node_is("call", current)) {
      value = call_depth(current)
      if (value > deepest) {
        deepest = value
      }
      continue
    }
    if (node_is("argwrap", current) || node_kind[current] == "value_arguments") {
      for (position = 1; position <= kid_count[current]; position++) {
        stack[++top] = kid[current, position]
      }
    }
  }
  return deepest + 1
}

function is_outer_call(call,    arguments_node) {
  arguments_node = enclosing_arguments(call)
  if (arguments_node == 0) {
    return 1
  }
  return node_kind[node_parent[arguments_node]] == "new_expression" || node_kind[node_parent[arguments_node]] == "object_creation_expression"
}

function is_then_call(node,    callee, property) {
  if (node == 0 || node_kind[node] != "call_expression") {
    return 0
  }
  callee = child_by_field(node, "function")
  if (callee == 0 || node_kind[callee] != "member_expression") {
    return 0
  }
  property = child_by_field(callee, "property")
  return property != 0 && node_text(property) == "then"
}

function is_inside_then(node,    ancestor, arguments_node) {
  ancestor = node_parent[node]
  while (ancestor != 0) {
    if (is_function(ancestor)) {
      arguments_node = enclosing_arguments(ancestor)
      if (arguments_node != 0 && is_then_call(node_parent[arguments_node])) {
        return 1
      }
    }
    ancestor = node_parent[ancestor]
  }
  return 0
}

# The logical operator token (&&, ||, ??, and, or) of a binary node, or "".
function logical_operator(node,    position, member, operator_node) {
  operator_node = child_by_field(node, "operator")
  if (operator_node != 0 && kind_is("logical", node_text(operator_node))) {
    return node_text(operator_node)
  }
  if (node_kind[node] == "conjunction_expression") {
    return "&&"
  }
  if (node_kind[node] == "disjunction_expression") {
    return "||"
  }
  if (operator_node != 0) {
    return ""
  }
  for (position = 1; position <= kid_count[node]; position++) {
    member = kid[node, position]
    if (!node_named[member] && kind_is("logical", node_kind[member])) {
      return node_kind[member]
    }
  }
  return ""
}

function starts_logical_sequence(node,    operator) {
  if (is_leaf(node)) {
    return 0
  }
  operator = logical_operator(node)
  if (operator == "") {
    return 0
  }
  return logical_operator(node_parent[node]) != operator
}

function is_recursion_call(node, own_name,    callee) {
  if (own_name == "" || !node_is("call", node)) {
    return 0
  }
  callee = child_by_field(node, "function")
  if (callee == 0) {
    callee = child_by_field(node, "method")
  }
  if (callee == 0) {
    callee = child_by_field(node, "name")
  }
  if (callee == 0 && LANGUAGE == "kotlin") {
    callee = child_of_kind(node, "simple_identifier")
  }
  return callee != 0 && node_is("identifier", callee) && node_text(callee) == own_name
}

function flat_increment(node, own_name,    kind) {
  kind = node_kind[node]
  if (node_is("else", node)) {
    return child_of_kind(node, "if_statement if_expression") != 0 ? 0 : 1
  }
  if (node_is("elseif", node)) {
    return 1
  }
  if (starts_logical_sequence(node)) {
    return 1
  }
  if ((kind == "break_statement" || kind == "continue_statement") && child_of_kind(node, "statement_identifier label") != 0) {
    return 1
  }
  return is_recursion_call(node, own_name)
}

# Cognitive complexity by the SonarSource rules.
function cognitive_score(node, nesting, own_name,    position, member, score) {
  score = 0
  for (position = 1; position <= kid_count[node]; position++) {
    member = kid[node, position]
    if (is_function(member)) {
      score += cognitive_score(member, nesting + 1, own_name)
    } else if (is_else_if(member)) {
      score += 1 + cognitive_score(member, nesting, own_name)
    } else if (node_is("nest", member)) {
      score += 1 + nesting + cognitive_score(member, nesting + 1, own_name)
    } else {
      score += flat_increment(member, own_name) + cognitive_score(member, nesting, own_name)
    }
  }
  return score
}

function body_lines(node,    body, text, lines, count, position, total) {
  body = function_body(node)
  if (body == 0) {
    return 0
  }
  text = node_text(body)
  if (substr(text, 1, 1) == "{" && substr(text, length(text), 1) == "}") {
    text = substr(text, 2, length(text) - 2)
  }
  count = split(text, lines, "\n")
  total = 0
  for (position = 1; position <= count; position++) {
    if (lines[position] ~ /[^ \t\r]/) {
      total++
    }
  }
  return total
}

function count_tokens(node,    position, total) {
  if (is_comment(node)) {
    return 0
  }
  if (kid_count[node] == 0) {
    return 1
  }
  total = 0
  for (position = 1; position <= kid_count[node]; position++) {
    total += count_tokens(kid[node, position])
  }
  return total
}

# Names declared inside a function (parameters, variables), nested functions excluded.
function collect_declared(node, declared,    stack, top, current, position, member, names, count, target) {
  count = collect_parameters(node, names)
  for (position = 1; position in names; position++) {
    declared[node_text(names[position])] = 1
  }
  top = 0
  for (position = 1; position <= kid_count[node]; position++) {
    stack[++top] = kid[node, position]
  }
  while (top > 0) {
    current = stack[top--]
    if (is_function(current)) {
      continue
    }
    if (node_is("name_declaration", current) || node_kind[current] == "catch_clause") {
      target = child_by_field(current, "name")
      if (target == 0) {
        target = child_by_field(current, "left")
      }
      if (target == 0) {
        target = child_by_field(current, "pattern")
      }
      if (target == 0) {
        target = child_by_field(current, "parameter")
      }
      target = identifier_within(target)
      if (target != 0) {
        declared[node_text(target)] = 1
      }
    }
    for (position = 1; position <= kid_count[current]; position++) {
      stack[++top] = kid[current, position]
    }
  }
}

function captures_outer(nested, declared,    stack, top, current, position) {
  top = 1
  stack[1] = nested
  while (top > 0) {
    current = stack[top--]
    if (node_kind[current] == "identifier" && (node_text(current) in declared)) {
      return 1
    }
    for (position = 1; position <= kid_count[current]; position++) {
      stack[++top] = kid[current, position]
    }
  }
  return 0
}

# Constructs the runtime expands into hidden work: spread, destructuring, ?., ??, async/await, closures, try...
function count_desugared(node,    declared, total, current, last) {
  total = has_token(node, "async") ? 1 : 0
  collect_declared(node, declared)
  last = last_descendant(node)
  for (current = node + 1; current <= last; current++) {
    if (node_is("sugar", current) && !is_function(current)) {
      total++
    } else if (!node_named[current] && node_kind[current] == "??") {
      total++
    } else if (is_function(current) && captures_outer(current, declared)) {
      total++
    }
  }
  return total
}

# Nodes are numbered in pre-order, so a subtree is the range node..last_descendant(node).
function last_descendant(node) {
  while (kid_count[node] > 0) {
    node = kid[node, kid_count[node]]
  }
  return node
}
