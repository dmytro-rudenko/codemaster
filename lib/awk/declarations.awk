# Top-level declarations of a file: constant, data-variable, interface, type, enum, class, function, method, object.
# Fills decl_kind, decl_name, decl_line, decl_node (1..decl_total). POSIX awk; needs tree, grammar, functions.

function declare(kind, name_node, statement,    name) {
  if (name_node == 0) {
    return
  }
  name = node_text(name_node)
  if (name == "" || name == "_") {
    return
  }
  decl_total++
  decl_kind[decl_total] = kind
  decl_name[decl_total] = name
  decl_line[decl_total] = line_of(name_node)
  decl_node[decl_total] = statement
}

function collect_declarations() {
  decl_total = 0
  walk_top(1)
}

function walk_top(container,    members, count, position) {
  count = named_children(container, members)
  for (position = 1; position <= count; position++) {
    classify_statement(members[position], "")
  }
}

function is_numeric_literal(node) {
  return node_kind[node] ~ /(number|integer|int|float|real|decimal)/
}

function has_interpolation(node,    last, current) {
  last = last_descendant(node)
  for (current = node + 1; current <= last; current++) {
    if (node_is("interpolation", current)) {
      return 1
    }
  }
  return 0
}

# 1 when a value is plain data: literals, and arrays or maps made only of literals.
function is_data(node,    kind, members, count, position, value, inner, callee) {
  if (node == 0) {
    return 0
  }
  kind = node_kind[node]
  if (node_is("literal", node)) {
    return !has_interpolation(node)
  }
  if (kind == "parenthesized_expression" || kind == "expression_list" || kind == "literal_element") {
    count = named_children(node, members)
    return count == 1 && is_data(members[1])
  }
  if (kind == "composite_literal") {
    return is_data(child_by_field(node, "body"))
  }
  if (node_is("container", node)) {
    count = named_children(node, members)
    for (position = 1; position <= count; position++) {
      if (node_is("pair", members[position])) {
        value = child_by_field(members[position], "value")
        if (value == 0) {
          named_children(members[position], inner)
          value = inner[length_of(inner)]
        }
        if (!is_data(value)) {
          return 0
        }
      } else if (!is_data(members[position])) {
        return 0
      }
    }
    return 1
  }
  if (kind ~ /unary/) {
    count = named_children(node, members)
    return count == 1 && has_token(node, "-") && is_numeric_literal(members[1])
  }
  if (SCRIPT && (kind == "as_expression" || kind == "satisfies_expression")) {
    if (kind == "as_expression" && node_text(kid[node, kid_count[node]]) != "const") {
      return 0
    }
    count = named_children(node, members)
    return count >= 1 && is_data(members[1])
  }
  if (SCRIPT && kind == "call_expression") {
    callee = child_by_field(node, "function")
    if (callee == 0 || node_text(callee) != "Object.freeze") {
      return 0
    }
    count = named_children(child_by_field(node, "arguments"), members)
    return count == 1 && is_data(members[1])
  }
  return 0
}

function length_of(list,    count) {
  count = 0
  while ((count + 1) in list) {
    count++
  }
  return count
}

# function, constant (data), or object.
function value_kind(value, keyword_constant) {
  if (value == 0) {
    return ""
  }
  if (is_function(value)) {
    return "function"
  }
  if (!is_data(value)) {
    return "object"
  }
  return keyword_constant ? "constant" : "data-variable"
}

function modifiers_text(statement,    found, text) {
  found = child_of_kind(statement, "modifiers")
  text = found == 0 ? "" : " " node_text(found) " "
  for (found = 1; found <= kid_count[statement]; found++) {
    if (node_kind[kid[statement, found]] == "modifier" || node_kind[kid[statement, found]] == "storage_class_specifier" || node_kind[kid[statement, found]] == "type_qualifier") {
      text = text " " node_text(kid[statement, found]) " "
    }
  }
  gsub(/[\n\t]/, " ", text)
  return text
}

function classify_statement(statement, decorators,    kind, inner, members, count, position, declarator, value, name_node, text, keyword) {
  kind = node_kind[statement]
  if (kind == "export_statement") {
    inner = child_by_field(statement, "declaration")
    if (inner != 0) {
      classify_statement(inner, "")
    }
    return
  }
  if (kind == "decorated_definition") {
    classify_statement(child_by_field(statement, "definition"), node_text(statement))
    return
  }
  if (kind == "namespace_declaration" || kind == "namespace_definition" || kind == "linkage_specification" || (LANGUAGE == "ruby" && kind == "module")) {
    inner = child_by_field(statement, "body")
    if (inner != 0) {
      walk_top(inner)
    }
    return
  }
  if (kind == "template_declaration") {
    count = named_children(statement, members)
    if (count > 0) {
      classify_statement(members[count], "")
    }
    return
  }
  if (SCRIPT) {
    classify_script(statement, kind)
  } else if (LANGUAGE == "python") {
    classify_python(statement, kind, decorators)
  } else if (LANGUAGE == "go") {
    classify_go(statement, kind)
  } else if (LANGUAGE == "rust") {
    classify_rust(statement, kind)
  } else if (LANGUAGE == "java" || LANGUAGE == "csharp") {
    classify_class_based(statement, kind, 1)
  } else if (LANGUAGE == "kotlin") {
    classify_kotlin(statement, kind, 1)
  } else if (LANGUAGE == "php") {
    classify_php(statement, kind, 1)
  } else if (LANGUAGE == "ruby") {
    classify_ruby(statement, kind, 1)
  } else {
    classify_c(statement, kind)
  }
}

function classify_script(statement, kind,    keyword, position, member, value_type) {
  if (kind == "lexical_declaration" || kind == "variable_declaration") {
    keyword = node_kind[kid[statement, 1]]
    for (position = 1; position <= kid_count[statement]; position++) {
      member = kid[statement, position]
      if (node_kind[member] != "variable_declarator") {
        continue
      }
      value_type = value_kind(child_by_field(member, "value"), keyword == "const")
      if (value_type != "") {
        declare(value_type, child_by_field(member, "name"), member)
      }
    }
    return
  }
  if (kind == "interface_declaration") {
    declare("interface", child_by_field(statement, "name"), statement)
  } else if (kind == "type_alias_declaration") {
    declare("type", child_by_field(statement, "name"), statement)
  } else if (kind == "enum_declaration") {
    declare("enum", child_by_field(statement, "name"), statement)
  } else if (kind == "class_declaration" || kind == "abstract_class_declaration") {
    declare("class", child_by_field(statement, "name"), statement)
  } else if (kind == "function_declaration" || kind == "generator_function_declaration") {
    declare("function", child_by_field(statement, "name"), statement)
  }
}

function classify_python(statement, kind, decorators,    inner, target, value, name, bases, value_type) {
  if (kind == "expression_statement") {
    inner = kid[statement, 1]
    if (node_kind[inner] != "assignment") {
      return
    }
    target = child_by_field(inner, "left")
    if (node_kind[target] != "identifier") {
      return
    }
    name = node_text(target)
    if (name ~ /^__.*__$/) {
      return
    }
    value = child_by_field(inner, "right")
    if (value == 0) {
      return
    }
    value_type = value_kind(value, 1)
    declare(value_type, target, inner)
    return
  }
  if (kind == "type_alias_statement") {
    declare("type", identifier_within(child_by_field(statement, "left")), statement)
    return
  }
  if (kind == "class_definition") {
    bases = child_by_field(statement, "superclasses")
    bases = bases == 0 ? "" : node_text(bases)
    if (bases ~ /(^|[^A-Za-z0-9_])(Enum|IntEnum|StrEnum|Flag|IntFlag)([^A-Za-z0-9_]|$)/) {
      declare("enum", child_by_field(statement, "name"), statement)
    } else if (bases ~ /(^|[^A-Za-z0-9_])(Protocol|ABC)([^A-Za-z0-9_]|$)/) {
      declare("interface", child_by_field(statement, "name"), statement)
    } else if (bases ~ /(^|[^A-Za-z0-9_])(TypedDict|NamedTuple|BaseModel)([^A-Za-z0-9_]|$)/ || decorators ~ /@(dataclasses\.)?dataclass/) {
      declare("type", child_by_field(statement, "name"), statement)
    } else {
      declare("class", child_by_field(statement, "name"), statement)
    }
    return
  }
  if (kind == "function_definition") {
    declare("function", child_by_field(statement, "name"), statement)
  }
}

function classify_go(statement, kind,    position, spec, member, type_node, value_type) {
  if (kind == "const_declaration" || kind == "var_declaration") {
    for (position = 1; position <= kid_count[statement]; position++) {
      spec = kid[statement, position]
      if (node_kind[spec] == "var_spec_list") {
        classify_go(spec, "var_declaration")
        continue
      }
      if (node_kind[spec] != "const_spec" && node_kind[spec] != "var_spec") {
        continue
      }
      value_type = kind == "const_declaration" ? "constant" : value_kind(child_by_field(spec, "value"), 0)
      if (value_type == "") {
        continue
      }
      for (member = 1; member <= kid_count[spec]; member++) {
        if (node_field[kid[spec, member]] == "name") {
          declare(value_type, kid[spec, member], spec)
        }
      }
    }
    return
  }
  if (kind == "type_declaration") {
    for (position = 1; position <= kid_count[statement]; position++) {
      spec = kid[statement, position]
      if (node_kind[spec] != "type_spec" && node_kind[spec] != "type_alias") {
        continue
      }
      type_node = child_by_field(spec, "type")
      declare(node_kind[type_node] == "interface_type" ? "interface" : "type", child_by_field(spec, "name"), spec)
    }
    return
  }
  if (kind == "function_declaration") {
    declare("function", child_by_field(statement, "name"), statement)
  } else if (kind == "method_declaration") {
    declare("method", child_by_field(statement, "name"), statement)
  }
}

function classify_rust(statement, kind,    value) {
  if (kind == "const_item") {
    declare("constant", child_by_field(statement, "name"), statement)
  } else if (kind == "static_item") {
    value = child_by_field(statement, "value")
    declare(is_data(value) ? "constant" : "object", child_by_field(statement, "name"), statement)
  } else if (kind == "struct_item" || kind == "union_item" || kind == "type_item") {
    declare("type", child_by_field(statement, "name"), statement)
  } else if (kind == "trait_item") {
    declare("interface", child_by_field(statement, "name"), statement)
  } else if (kind == "enum_item") {
    declare("enum", child_by_field(statement, "name"), statement)
  } else if (kind == "function_item") {
    declare("function", child_by_field(statement, "name"), statement)
  }
}

# Java and C#: types at the top level; static final (const) data fields inside the classes are constants.
function classify_class_based(statement, kind, top,    body, members, count, position, member, modifiers, declarator, value, holder) {
  if (kind == "interface_declaration" || kind == "annotation_type_declaration") {
    declare("interface", child_by_field(statement, "name"), statement)
  } else if (kind == "enum_declaration") {
    declare("enum", child_by_field(statement, "name"), statement)
  } else if (kind == "record_declaration" || kind == "struct_declaration" || kind == "record_struct_declaration" || kind == "delegate_declaration") {
    declare("type", child_by_field(statement, "name"), statement)
  } else if (kind == "class_declaration") {
    if (top) {
      declare("class", child_by_field(statement, "name"), statement)
    }
    body = child_by_field(statement, "body")
    count = named_children(body, members)
    for (position = 1; position <= count; position++) {
      member = members[position]
      if (node_kind[member] == "field_declaration") {
        classify_field(member)
      } else if (node_kind[member] != "class_declaration") {
        classify_class_based(member, node_kind[member], 0)
      }
    }
  }
}

function classify_field(field_node,    modifiers, holder, position, declarator, value, constant) {
  modifiers = modifiers_text(field_node)
  constant = index(modifiers, " const ") > 0 || (index(modifiers, " static ") > 0 && (index(modifiers, " final ") > 0 || index(modifiers, " readonly ") > 0))
  if (!constant) {
    return
  }
  holder = child_of_kind(field_node, "variable_declaration")
  if (holder == 0) {
    holder = field_node
  }
  for (position = 1; position <= kid_count[holder]; position++) {
    declarator = kid[holder, position]
    if (node_kind[declarator] != "variable_declarator") {
      continue
    }
    value = child_by_field(declarator, "value")
    if (value == 0) {
      value = kid[declarator, kid_count[declarator]]
      if (value == child_by_field(declarator, "name")) {
        value = 0
      }
    }
    if (is_data(value)) {
      declare("constant", child_by_field(declarator, "name"), declarator)
    }
  }
}

function kotlin_property(statement,    modifiers, binding, value, holder, name_node, value_type) {
  modifiers = modifiers_text(statement)
  binding = child_of_kind(statement, "binding_pattern_kind")
  holder = child_of_kind(statement, "variable_declaration")
  name_node = holder == 0 ? 0 : child_of_kind(holder, "simple_identifier")
  value = kid[statement, kid_count[statement]]
  if (!node_named[value] || value == holder || value == binding) {
    value = 0
  }
  if (index(modifiers, "const") > 0) {
    declare("constant", name_node, statement)
    return
  }
  value_type = value_kind(value, binding != 0 && node_text(binding) == "val")
  if (value_type != "") {
    declare(value_type, name_node, statement)
  }
}

function classify_kotlin(statement, kind, top,    modifiers, body, members, count, position, name_node, type_kind) {
  if (kind == "property_declaration") {
    if (top) {
      kotlin_property(statement)
    } else if (index(modifiers_text(statement), "const") > 0) {
      kotlin_property(statement)
    }
    return
  }
  if (kind == "function_declaration" && top) {
    declare("function", child_of_kind(statement, "simple_identifier"), statement)
    return
  }
  if (kind == "type_alias" && top) {
    declare("type", child_of_kind(statement, "type_identifier simple_identifier"), statement)
    return
  }
  if (kind != "class_declaration" && kind != "object_declaration" && kind != "companion_object") {
    return
  }
  name_node = child_of_kind(statement, "type_identifier simple_identifier")
  modifiers = modifiers_text(statement)
  if (has_token(statement, "interface")) {
    type_kind = "interface"
  } else if (index(modifiers, "enum") > 0 || child_of_kind(statement, "enum_class_body") != 0) {
    type_kind = "enum"
  } else if (index(modifiers, "data") > 0) {
    type_kind = "type"
  } else {
    type_kind = kind == "class_declaration" ? "class" : "object"
  }
  if (top) {
    declare(type_kind, name_node, statement)
  }
  body = child_of_kind(statement, "class_body")
  count = named_children(body, members)
  for (position = 1; position <= count; position++) {
    classify_kotlin(members[position], node_kind[members[position]], 0)
  }
}

function classify_php(statement, kind, top,    position, member, body, members, count, arguments_node, first) {
  if (kind == "const_declaration") {
    for (position = 1; position <= kid_count[statement]; position++) {
      member = kid[statement, position]
      if (node_kind[member] == "const_element") {
        declare("constant", child_of_kind(member, "name"), member)
      }
    }
    return
  }
  if (!top) {
    return
  }
  if (kind == "function_definition") {
    declare("function", child_by_field(statement, "name"), statement)
  } else if (kind == "interface_declaration") {
    declare("interface", child_by_field(statement, "name"), statement)
  } else if (kind == "enum_declaration") {
    declare("enum", child_by_field(statement, "name"), statement)
  } else if (kind == "class_declaration" || kind == "trait_declaration") {
    declare("class", child_by_field(statement, "name"), statement)
    body = child_by_field(statement, "body")
    count = named_children(body, members)
    for (position = 1; position <= count; position++) {
      classify_php(members[position], node_kind[members[position]], 0)
    }
  } else if (kind == "expression_statement") {
    member = kid[statement, 1]
    if (node_kind[member] == "function_call_expression" && node_text(child_by_field(member, "function")) == "define") {
      arguments_node = child_by_field(member, "arguments")
      count = named_children(arguments_node, members)
      if (count >= 1) {
        first = identifier_within(members[1])
        declare("constant", members[1], member)
      }
    }
  }
}

function classify_ruby(statement, kind, top,    target, value, body, members, count, position) {
  if (kind == "assignment") {
    target = child_by_field(statement, "left")
    if (node_kind[target] != "constant") {
      return
    }
    value = child_by_field(statement, "right")
    declare(is_data(value) ? "constant" : "object", target, statement)
    return
  }
  if (!top) {
    return
  }
  if (kind == "method") {
    declare("function", child_by_field(statement, "name"), statement)
  } else if (kind == "singleton_method") {
    declare("method", child_by_field(statement, "name"), statement)
  } else if (kind == "class") {
    declare("class", child_by_field(statement, "name"), statement)
    body = child_by_field(statement, "body")
    count = named_children(body, members)
    for (position = 1; position <= count; position++) {
      classify_ruby(members[position], node_kind[members[position]], 0)
    }
  }
}

function classify_c(statement, kind,    position, member, modifiers, value, name_node, constant, body) {
  if (kind == "preproc_def") {
    if (child_by_field(statement, "value") != 0) {
      declare("constant", child_by_field(statement, "name"), statement)
    }
    return
  }
  if (kind == "function_definition") {
    declare("function", declared_name(statement), statement)
    return
  }
  if (kind == "class_specifier") {
    declare("class", child_by_field(statement, "name"), statement)
    return
  }
  if (kind == "alias_declaration") {
    declare("type", child_by_field(statement, "name"), statement)
    return
  }
  if ((kind == "struct_specifier" || kind == "union_specifier") && child_by_field(statement, "body") != 0) {
    declare("type", child_by_field(statement, "name"), statement)
    return
  }
  if (kind == "enum_specifier" && child_by_field(statement, "body") != 0) {
    declare("enum", child_by_field(statement, "name"), statement)
    return
  }
  if (kind == "type_definition") {
    member = child_by_field(statement, "type")
    declare(node_kind[member] == "enum_specifier" ? "enum" : "type", identifier_within(child_by_field(statement, "declarator")), statement)
    return
  }
  if (kind != "declaration") {
    return
  }
  member = child_by_field(statement, "type")
  if (member != 0 && (node_kind[member] == "struct_specifier" || node_kind[member] == "union_specifier" || node_kind[member] == "enum_specifier") && child_by_field(member, "body") != 0) {
    classify_c(member, node_kind[member])
  }
  modifiers = modifiers_text(statement)
  constant = index(modifiers, " const ") > 0 || index(modifiers, " constexpr ") > 0
  for (position = 1; position <= kid_count[statement]; position++) {
    member = kid[statement, position]
    if (node_field[member] != "declarator" || node_kind[member] != "init_declarator") {
      continue
    }
    value = child_by_field(member, "value")
    name_node = identifier_within(child_by_field(member, "declarator"))
    if (is_data(value)) {
      declare(constant ? "constant" : "data-variable", name_node, member)
    } else {
      declare("object", name_node, member)
    }
  }
}
