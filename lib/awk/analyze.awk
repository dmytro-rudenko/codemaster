# Analyzes one source file from its ast-grep tree dumps.
# Input files: the flat config, the AST dump (-v ast_file), the CST dump (-v cst_file).
# -v source=<file on disk> -v path=<project path> -v language=<ast-grep language>
# -v role, entity, global, layout: the file role (roles.awk).
# -v mode=check: prints findings "severity<TAB>rule<TAB>line<TAB>message".
# -v mode=declarations: prints "kind<TAB>name<TAB>line" of the top-level declarations.
# -v mode=functions -v body_prefix=<path>: prints named functions
#   "name<TAB>line<TAB>end line<TAB>complexity<TAB>body lines<TAB>method<TAB>uses this<TAB>body file".
# -v mode=metrics -v target=<function name>: prints "readability length tokens desugared" for that function.
# A file that does not parse prints "parse" (check mode: a parse warning).
# POSIX awk, with util, cfg, grammar, tree, functions and declarations.

BEGIN {
  FS = "\t"
  tree_reset()
}

FILENAME == config_file {
  cfg_store()
  next
}

FILENAME == ast_file {
  tree_named_line($0)
  next
}

FILENAME == cst_file {
  if (!switched) {
    tree_named_done()
    switched = 1
  }
  tree_cst_line($0)
  next
}

END {
  grammar_setup(language)
  load_source(source)
  if (node_total == 0) {
    if (source_line_total > 0 && mode == "check") {
      finding("warning", "parse", 1, "could not parse")
    }
    exit
  }
  if (has_error()) {
    if (mode == "check") {
      finding("warning", "parse", line_of(error_node), "could not parse")
    } else {
      print "parse"
    }
    exit
  }
  if (mode == "check") {
    run_checks()
  } else if (mode == "declarations") {
    collect_declarations()
    for (position = 1; position <= decl_total; position++) {
      printf "%s\t%s\t%d\n", decl_kind[position], decl_name[position], decl_line[position]
    }
  } else if (mode == "functions") {
    list_functions()
  } else if (mode == "metrics") {
    print_metrics()
  }
}

function finding(severity, rule, line, message) {
  rule_setting(rule)
  if (!rule_enabled) {
    return
  }
  if (rule_explicit) {
    severity = rule_severity
  }
  gsub(/[\t\n\r]/, " ", message)
  printf "%s\t%s\t%d\t%s\t%s\n", severity, rule, line, message, rule_reason
}

function layout_rules_on() {
  return layout != "off"
}

function run_checks(    position) {
  collect_declarations()
  if (layout_rules_on()) {
    check_layout()
  }
  check_global_functions()
  check_naming()
  check_function_rules()
}

function forbidden_kind(kind) {
  return kind == "constant" || kind == "data-variable" || kind == "interface" || kind == "type" || kind == "enum"
}

function check_layout(    position, own, is_shape, folder, size_limit, line_count, kind) {
  own = 0
  for (position = 1; position <= decl_total; position++) {
    if (forbidden_kind(decl_kind[position])) {
      own++
    }
  }
  if (role == "module" || role == "helper" || role == "util") {
    for (position = 1; position <= decl_total; position++) {
      kind = decl_kind[position]
      if (!forbidden_kind(kind)) {
        continue
      }
      is_shape = kind == "interface" || kind == "type"
      folder = is_shape ? cfg_get("roles/interfaces/0") : cfg_get("roles/consts/0")
      finding("error", "layout-forbidden-declaration", decl_line[position], kind " " decl_name[position] " belongs in " folder)
    }
  }
  if ((role == "helper" || role == "util") && !CLASS_BASED) {
    for (position = 1; position <= decl_total; position++) {
      kind = decl_kind[position]
      if (kind == "class" || kind == "object") {
        finding("error", "helpers-only-functions", decl_line[position], kind " " decl_name[position] " is not a function")
      }
    }
  }
  size_limit = rule_limit("single-file-module-size", cfg_get("singleFileMaxLines") + 0)
  line_count = 0
  for (position = 0; position < source_line_total; position++) {
    if (source_line[position] ~ /[^ \t\r]/) {
      line_count++
    }
  }
  if (role == "single-file-module" && own > 0 && line_count > size_limit) {
    finding("warning", "single-file-module-size", 1, "single-file module has " line_count " lines (max " size_limit "); turn it into a folder")
  }
  if (role == "helper") {
    check_mixed_kind()
  }
  if (role == "consts" || role == "interfaces") {
    check_entity_prefixes()
  }
}

function regex_escape(text,    out, position, character) {
  out = ""
  for (position = 1; position <= length(text); position++) {
    character = substr(text, position, 1)
    if (character == "\\") {
      out = out "\\\\"
    } else if (character == "^") {
      out = out "\\^"
    } else if (index(".+*?()|$[]{}/", character) > 0) {
      out = out "[" character "]"
    } else {
      out = out character
    }
  }
  return out
}

function imports_infrastructure(    packages, count, position, member, text, current, last, pattern, callee) {
  count = cfg_list("infrastructurePackages", packages)
  text = ""
  last = node_total
  for (current = 1; current <= last; current++) {
    if (node_is("import", current) || node_kind[current] == "preproc_include") {
      text = text "\n" node_text(current)
    } else if (LANGUAGE == "ruby" && node_kind[current] == "call" && node_parent[current] == 1) {
      callee = child_by_field(current, "method")
      if (callee != 0 && (node_text(callee) == "require" || node_text(callee) == "require_relative")) {
        text = text "\n" node_text(current)
      }
    }
  }
  if (text == "") {
    return 0
  }
  for (position = 1; position <= count; position++) {
    pattern = "(^|[^A-Za-z0-9_.@\\/-])" regex_escape(packages[position]) "([^A-Za-z0-9_-]|$)"
    if (text ~ pattern) {
      return 1
    }
  }
  return 0
}

function has_network_call(text) {
  return text ~ NETWORK
}

function check_mixed_kind(    current, total, network, with_storage, mixes, message, file_text) {
  total = 0
  network = 0
  for (current = 1; current <= node_total; current++) {
    if (!is_function(current) || enclosing_function(current) != 0) {
      continue
    }
    resolve_function_name(current)
    if (FUNCTION_NAME == "") {
      continue
    }
    total++
    if (has_network_call(node_text(current))) {
      network++
    }
  }
  file_text = node_text(1)
  with_storage = imports_infrastructure() && has_network_call(file_text)
  mixes = network > 0 && network < total
  if (!with_storage && !mixes) {
    return
  }
  message = with_storage ? "helper mixes an infrastructure package with network calls" : "helper mixes functions with and without network calls"
  finding("warning", "helpers-mixed-kind", 1, message)
}

function enclosing_function(node,    ancestor) {
  ancestor = node_parent[node]
  while (ancestor != 0) {
    if (is_function(ancestor)) {
      return ancestor
    }
    ancestor = node_parent[ancestor]
  }
  return 0
}

function matches_shape(name, shape) {
  if (shape == "upper-snake") {
    return name ~ /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/
  }
  if (shape == "camel") {
    return name ~ /^[a-z][a-zA-Z0-9]*$/
  }
  return name ~ /^[A-Z][a-zA-Z0-9]*$/
}

function describe_shape(shape, lead) {
  if (shape == "upper-snake") {
    return "UPPER_SNAKE"
  }
  return shape == "camel" ? "camelCase" : lead "PascalCase"
}

function ends_at_boundary(rest, shape) {
  if (shape == "pascal") {
    return rest == "" || rest ~ /^[A-Z]/
  }
  if (shape == "camel") {
    return rest ~ /^[A-Z]/
  }
  return rest != ""
}

# Go exports by the case of the first letter, so both cases pass there.
function fold_go(text) {
  if (LANGUAGE != "go" || text == "") {
    return text
  }
  return toupper(substr(text, 1, 1)) substr(text, 2)
}

function entity_prefix_problem(name, kind, entity_name,    shape, lead, separator, expected, body, compared) {
  shape = kind == "type" ? "pascal" : cfg_get("constantCase")
  if (LANGUAGE == "go" && shape == "camel") {
    shape = "pascal"
  }
  lead = kind == "type" ? cfg_get("interfacePrefix") : ""
  compared = fold_go(name)
  if (entity_name != "" && cfg_get("entityPrefix") == "true") {
    separator = shape == "upper-snake" ? "_" : ""
    expected = lead entity_case(entity_name, shape) separator
    if (substr(compared, 1, length(expected)) != fold_go(expected) || !ends_at_boundary(substr(compared, length(expected) + 1), shape)) {
      return name " should start with " expected
    }
  }
  body = substr(compared, 1, length(lead)) == lead ? substr(compared, length(lead) + 1) : ""
  return matches_shape(body, shape) ? "" : name " should be " describe_shape(shape, lead)
}

function check_entity_prefixes(    position, kind, message, entity_name) {
  entity_name = global == "1" ? "" : entity
  for (position = 1; position <= decl_total; position++) {
    kind = decl_kind[position]
    if (kind == "constant" || kind == "data-variable") {
      kind = "constant"
    } else if (kind == "interface" || kind == "type") {
      kind = "type"
    } else {
      continue
    }
    message = entity_prefix_problem(decl_name[position], kind, entity_name)
    if (message != "") {
      finding("error", "name-entity-prefix", decl_line[position], message)
    }
  }
}

function check_global_functions(    strict, position, current, target, owner, member, name) {
  strict = role == "other" || role == "interfaces" || role == "consts"
  for (position = 1; position <= decl_total; position++) {
    if (decl_kind[position] != "function") {
      continue
    }
    if (strict || (role == "entrypoint" && decl_name[position] != "main")) {
      finding("error", "global-function", decl_line[position], "top-level function " decl_name[position] " outside a module, helper or util")
    }
  }
  if (!SCRIPT) {
    return
  }
  for (current = 1; current <= node_total; current++) {
    if (node_kind[current] == "assignment_expression") {
      target = child_by_field(current, "left")
      if (node_kind[target] != "member_expression") {
        continue
      }
      owner = node_text(child_by_field(target, "object"))
      if ((owner == "globalThis" || owner == "window" || owner == "global") && is_function(child_by_field(current, "right"))) {
        finding("error", "global-function", line_of(current), "function assigned to " node_text(target))
      }
    } else if (node_kind[current] == "ambient_declaration" && node_parent[current] == 1 && node_text(current) ~ /^declare global/) {
      for (member = current + 1; member <= last_descendant(current); member++) {
        if (node_kind[member] == "function_signature" || node_kind[member] == "function_declaration") {
          name = child_by_field(member, "name")
          finding("error", "global-function", line_of(member), "declare global adds function " (name == 0 ? "function" : node_text(name)))
          break
        }
      }
    }
  }
}

function add_name(node, by_text) {
  if (node == 0 || !node_is("identifier", node)) {
    return
  }
  if ((start_line[node] SUBSEP start_column[node]) in name_seen) {
    return
  }
  if (by_text && (node_text(node) in name_text_seen)) {
    return
  }
  name_seen[start_line[node], start_column[node]] = 1
  name_text_seen[node_text(node)] = 1
  name_total++
  name_node[name_total] = node
}

function collect_names(    current, kind, target, position, member, names, count, by_text) {
  name_total = 0
  for (current = 1; current <= node_total; current++) {
    if (is_function(current)) {
      collect_parameters(current, names)
      for (position = 1; position in names; position++) {
        add_name(names[position], 0)
      }
    }
    if (!node_is("name_declaration", current)) {
      continue
    }
    kind = node_kind[current]
    by_text = 0
    if (kind == "assignment" || kind == "assignment_expression") {
      target = child_by_field(current, "left")
      if (node_kind[target] == "variable_name") {
        target = identifier_within(target)
      }
      by_text = 1
      if (target != 0 && (node_kind[target] == "identifier" || node_kind[target] == "constant" || node_kind[target] == "name")) {
        add_name(target, by_text)
      }
      continue
    }
    if (kind == "short_var_declaration") {
      target = child_by_field(current, "left")
      for (position = 1; position <= kid_count[target]; position++) {
        add_name(kid[target, position], 1)
      }
      continue
    }
    if (kind == "var_spec" || kind == "const_spec") {
      for (position = 1; position <= kid_count[current]; position++) {
        member = kid[current, position]
        if (node_field[member] == "name") {
          add_name(member, 0)
        }
      }
      continue
    }
    if (kind == "let_declaration") {
      add_name(child_by_field(current, "pattern"), 0)
      continue
    }
    if (kind == "property_declaration" && LANGUAGE == "kotlin") {
      target = child_of_kind(current, "variable_declaration")
      add_name(target == 0 ? 0 : child_of_kind(target, "simple_identifier"), 0)
      continue
    }
    if (kind == "declaration") {
      for (position = 1; position <= kid_count[current]; position++) {
        member = kid[current, position]
        if (node_field[member] == "declarator") {
          target = member
          while (target != 0 && !node_is("identifier", target)) {
            target = child_by_field(target, "declarator") == 0 ? child_of_kind(target, "identifier") : child_by_field(target, "declarator")
          }
          add_name(target, 0)
        }
      }
      continue
    }
    if (kind == "type_definition") {
      add_name(identifier_within(child_by_field(current, "declarator")), 0)
      continue
    }
    if (kind == "variable_declarator" && LANGUAGE == "csharp") {
      add_name(child_by_field(current, "name") == 0 ? child_of_kind(current, "identifier") : child_by_field(current, "name"), 0)
      continue
    }
    target = declared_name(current)
    if (target != 0 && (node_kind[target] == "array_pattern" || node_kind[target] == "object_pattern")) {
      continue
    }
    add_name(target, 0)
  }
}

function language_allowlist() {
  if (LANGUAGE == "go") {
    return " err ctx "
  }
  if (LANGUAGE == "python") {
    return " args kwargs "
  }
  if (LANGUAGE == "c" || LANGUAGE == "cpp") {
    return " argc argv "
  }
  if (LANGUAGE == "java" || LANGUAGE == "kotlin" || LANGUAGE == "csharp") {
    return " args "
  }
  return " "
}

function find_abbreviation(name, allowlist,    words, count, position, word) {
  if (length(name) == 1 && name != "_") {
    return name
  }
  count = split_words(name, words)
  for (position = 1; position <= count; position++) {
    word = words[position]
    if (index(ABBREVIATIONS, " " word " ") > 0 && index(allowlist, " " word " ") == 0) {
      return word
    }
  }
  return ""
}

function count_name_words(name, prefix,    words, count, prefix_words, prefix_count, position) {
  count = split_words(name, words)
  if (prefix == "") {
    return count
  }
  prefix_count = split_words(prefix, prefix_words)
  for (position = 1; position <= prefix_count; position++) {
    if (words[position] != prefix_words[position]) {
      return count
    }
  }
  return count - prefix_count
}

function skipped_name(name) {
  if (name ~ /^__/ && (LANGUAGE == "python" || LANGUAGE == "php")) {
    return 1
  }
  if (LANGUAGE == "go" && name == "init") {
    return 1
  }
  return name == "self" || name == "_"
}

function check_naming(    allowlist, word_limit, prefix, position, node, name, abbreviation, word_count) {
  ABBREVIATIONS = " cfg conf ctx req res msg btn tmp temp val idx err cb fn str num arr obj elem el evt e args params prev cur curr cnt len mgr svc repo impl init info ref usr pwd addr src dst desc opts env doc docs db "
  allowlist = " " cfg_joined("abbreviationAllowlist") language_allowlist()
  word_limit = rule_limit("name-word-count", 3)
  prefix = global == "1" ? "" : entity
  collect_names()
  sort_names()
  for (position = 1; position <= name_total; position++) {
    node = name_node[position]
    name = node_text(node)
    if (skipped_name(name)) {
      continue
    }
    abbreviation = find_abbreviation(name, allowlist)
    if (abbreviation != "") {
      finding("error", "name-abbreviation", line_of(node), name " contains abbreviation " abbreviation)
    }
    word_count = count_name_words(name, prefix)
    if (word_count > word_limit) {
      finding("warning", "name-word-count", line_of(node), name " has " word_count " words (max " word_limit ")")
    }
  }
}

function sort_names(    position, slot, current) {
  for (position = 2; position <= name_total; position++) {
    current = name_node[position]
    slot = position - 1
    while (slot > 0 && name_node[slot] > current) {
      name_node[slot + 1] = name_node[slot]
      slot--
    }
    name_node[slot + 1] = current
  }
}

function check_function_rules(    parameter_limit, nesting_limit, call_limit, current, name, names, count, deep, callbacks, depth) {
  parameter_limit = rule_limit("max-params", 5)
  nesting_limit = rule_limit("max-nesting", 3)
  call_limit = rule_limit("max-call-nesting", 3)
  for (current = 1; current <= node_total; current++) {
    if (node_is("call", current) && is_outer_call(current)) {
      depth = call_depth(current)
      if (depth > call_limit) {
        finding("warning", "max-call-nesting", line_of(current), "calls nested " depth " levels deep (max " call_limit ")")
      }
    }
    if (SCRIPT && is_then_call(current) && is_inside_then(current)) {
      finding("error", "max-nesting", line_of(current), "then called inside another then callback")
    }
    if (!is_function(current)) {
      continue
    }
    if (LANGUAGE == "ruby" && (node_kind[current] == "block" || node_kind[current] == "do_block")) {
      continue
    }
    resolve_function_name(current)
    name = FUNCTION_NAME == "" ? "anonymous" : FUNCTION_NAME
    count = collect_parameters(current, names)
    if (count > parameter_limit) {
      finding("error", "max-params", line_of(current), "function " name " has " count " parameters (max " parameter_limit ")")
    }
    deep = find_deep_block(current, 0, nesting_limit)
    callbacks = callback_depth(current, 0)
    if (deep != 0) {
      finding("error", "max-nesting", line_of(deep), "function " name " nests blocks deeper than " nesting_limit)
    } else if (callbacks > 2) {
      finding("error", "max-nesting", line_of(current), "function " name " nests callbacks " callbacks " levels deep (max 2)")
    }
  }
}

function list_functions(    current, body, file_name, body_count) {
  body_count = 0
  for (current = 1; current <= node_total; current++) {
    if (!is_function(current)) {
      continue
    }
    resolve_function_name(current)
    if (FUNCTION_NAME == "") {
      continue
    }
    body = function_body(current)
    body_count++
    file_name = body_prefix "." body_count
    printf "%s", (body == 0 ? "" : node_text(body)) > file_name
    close(file_name)
    printf "%s\t%d\t%d\t%d\t%d\t%d\t%d\t%s\n", FUNCTION_NAME, line_of(current), end_line[current] + 1, cognitive_score(current, 0, FUNCTION_BARE), body_lines(current), FUNCTION_METHOD, uses_this(current), file_name
  }
}

function print_metrics(    current) {
  for (current = 1; current <= node_total; current++) {
    if (!is_function(current)) {
      continue
    }
    resolve_function_name(current)
    if (FUNCTION_NAME != target && FUNCTION_BARE != target) {
      continue
    }
    printf "%d %d %d %d\n", cognitive_score(current, 0, FUNCTION_BARE), body_lines(current), count_tokens(current), count_desugared(current)
    return
  }
}
