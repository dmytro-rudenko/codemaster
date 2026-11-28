# Node kinds of each language's tree-sitter grammar, grouped by what the rules need. POSIX awk.
# kind_is(group, kind) answers whether a node kind belongs to a group.

function kind_group(group, kinds,    list, count, position) {
  count = split(kinds, list, " ")
  for (position = 1; position <= count; position++) {
    kind_set[group, list[position]] = 1
  }
}

function kind_is(group, kind) {
  return (group SUBSEP kind) in kind_set
}

function node_is(group, node) {
  return (group SUBSEP node_kind[node]) in kind_set
}

function grammar_setup(language) {
  LANGUAGE = language
  SCRIPT = language == "typescript" || language == "tsx" || language == "javascript"
  CLASS_BASED = language == "java" || language == "csharp"
  kind_group("comment", "comment line_comment block_comment doc_comment")
  kind_group("arglist", "arguments argument_list value_arguments call_suffix")
  kind_group("argwrap", "argument value_argument annotated_lambda")
  kind_group("identifier", "identifier simple_identifier name constant field_identifier type_identifier property_identifier private_property_identifier shorthand_property_identifier_pattern")
  kind_group("logical", "&& || ?? and or")
  kind_group("if", "if_statement if_expression if unless")
  if (SCRIPT) {
    kind_group("function", "function_declaration function_expression arrow_function method_definition generator_function_declaration generator_function function")
    kind_group("block", "if_statement for_statement for_in_statement while_statement do_statement switch_statement try_statement")
    kind_group("nest", "if_statement ternary_expression switch_statement for_statement for_in_statement while_statement do_statement catch_clause")
    kind_group("else", "else_clause")
    kind_group("call", "call_expression")
    kind_group("literal", "string number true false null regex template_string")
    kind_group("interpolation", "template_substitution")
    kind_group("container", "array object")
    kind_group("pair", "pair")
    kind_group("class", "class_declaration abstract_class_declaration class")
    kind_group("import", "import_statement")
    kind_group("sugar", "spread_element rest_pattern object_pattern array_pattern optional_chain yield_expression await_expression try_statement template_substitution")
    kind_group("name_declaration", "variable_declarator function_declaration generator_function_declaration function_expression class_declaration abstract_class_declaration class interface_declaration type_alias_declaration enum_declaration method_definition")
    kind_group("params", "formal_parameters")
    kind_group("this", "this")
    NETWORK = "(^|[^A-Za-z0-9_$.])fetch\\(|(^|[^A-Za-z0-9_$])https?\\.request([^A-Za-z0-9_$]|$)"
  } else if (language == "python") {
    kind_group("function", "function_definition lambda")
    kind_group("block", "if_statement for_statement while_statement try_statement match_statement")
    kind_group("nest", "if_statement conditional_expression for_statement while_statement except_clause match_statement")
    kind_group("else", "else_clause")
    kind_group("elseif", "elif_clause")
    kind_group("call", "call")
    kind_group("literal", "string integer float true false none concatenated_string")
    kind_group("interpolation", "interpolation")
    kind_group("container", "list tuple set dictionary")
    kind_group("pair", "pair")
    kind_group("class", "class_definition")
    kind_group("import", "import_statement import_from_statement")
    kind_group("sugar", "list_splat dictionary_splat list_splat_pattern dictionary_splat_pattern list_comprehension dictionary_comprehension set_comprehension generator_expression yield await with_statement try_statement interpolation decorator")
    kind_group("name_declaration", "function_definition class_definition assignment")
    kind_group("params", "parameters lambda_parameters")
    kind_group("this", "")
    NETWORK = "(^|[^A-Za-z0-9_.])(requests|httpx|aiohttp|urllib3)\\.|urllib\\.request|urlopen\\("
  } else if (language == "go") {
    kind_group("function", "function_declaration method_declaration func_literal")
    kind_group("block", "if_statement for_statement expression_switch_statement type_switch_statement select_statement")
    kind_group("nest", "if_statement for_statement expression_switch_statement type_switch_statement select_statement")
    kind_group("call", "call_expression")
    kind_group("literal", "int_literal float_literal imaginary_literal rune_literal interpreted_string_literal raw_string_literal true false nil iota")
    kind_group("container", "literal_value")
    kind_group("pair", "keyed_element literal_element")
    kind_group("class", "")
    kind_group("import", "import_declaration")
    kind_group("sugar", "go_statement defer_statement func_literal variadic_argument")
    kind_group("name_declaration", "function_declaration method_declaration type_spec const_spec var_spec short_var_declaration")
    kind_group("params", "parameter_list")
    NETWORK = "(^|[^A-Za-z0-9_])http\\.(Get|Post|PostForm|Head|NewRequest|NewRequestWithContext|DefaultClient)([^A-Za-z0-9_]|$)"
  } else if (language == "rust") {
    kind_group("function", "function_item closure_expression")
    kind_group("block", "if_expression for_expression while_expression loop_expression match_expression")
    kind_group("nest", "if_expression for_expression while_expression loop_expression match_expression")
    kind_group("else", "else_clause")
    kind_group("call", "call_expression")
    kind_group("literal", "integer_literal float_literal string_literal raw_string_literal char_literal boolean_literal")
    kind_group("container", "array_expression tuple_expression")
    kind_group("class", "impl_item")
    kind_group("import", "use_declaration extern_crate_declaration")
    kind_group("sugar", "try_expression await_expression closure_expression macro_invocation reference_expression")
    kind_group("name_declaration", "function_item struct_item enum_item trait_item type_item const_item static_item let_declaration mod_item union_item")
    kind_group("params", "parameters closure_parameters")
    kind_group("this", "self self_parameter")
    NETWORK = "(reqwest|hyper|ureq|surf|isahc)::|(^|[^A-Za-z0-9_])(reqwest|ureq)::(get|post|Client)"
  } else if (language == "java") {
    kind_group("function", "method_declaration constructor_declaration lambda_expression compact_constructor_declaration")
    kind_group("block", "if_statement for_statement enhanced_for_statement while_statement do_statement switch_expression switch_statement try_statement try_with_resources_statement")
    kind_group("nest", "if_statement ternary_expression switch_expression switch_statement for_statement enhanced_for_statement while_statement do_statement catch_clause")
    kind_group("call", "method_invocation")
    kind_group("literal", "decimal_integer_literal hex_integer_literal octal_integer_literal binary_integer_literal decimal_floating_point_literal hex_floating_point_literal string_literal character_literal true false null_literal text_block")
    kind_group("container", "array_initializer")
    kind_group("class", "class_declaration")
    kind_group("import", "import_declaration")
    kind_group("sugar", "lambda_expression method_reference enhanced_for_statement try_with_resources_statement switch_expression")
    kind_group("name_declaration", "class_declaration interface_declaration enum_declaration record_declaration method_declaration variable_declarator annotation_type_declaration")
    kind_group("params", "formal_parameters")
    kind_group("this", "this")
    NETWORK = "(^|[^A-Za-z0-9_])(HttpClient|HttpURLConnection|RestTemplate|WebClient|OkHttpClient|HttpRequest)([^A-Za-z0-9_]|$)"
  } else if (language == "kotlin") {
    kind_group("function", "function_declaration lambda_literal anonymous_function secondary_constructor")
    kind_group("block", "if_expression for_statement while_statement do_while_statement when_expression try_expression")
    kind_group("nest", "if_expression when_expression for_statement while_statement do_while_statement catch_block")
    kind_group("call", "call_expression")
    kind_group("literal", "integer_literal long_literal real_literal hex_literal bin_literal unsigned_literal string_literal character_literal boolean_literal null_literal")
    kind_group("interpolation", "interpolated_expression interpolated_identifier")
    kind_group("container", "collection_literal")
    kind_group("class", "class_declaration")
    kind_group("import", "import_header")
    kind_group("sugar", "lambda_literal anonymous_function spread_operator elvis_expression safe_navigation interpolated_expression")
    kind_group("name_declaration", "function_declaration class_declaration object_declaration property_declaration")
    kind_group("params", "function_value_parameters lambda_parameters")
    kind_group("this", "this_expression")
    NETWORK = "(^|[^A-Za-z0-9_])(HttpClient|HttpURLConnection|OkHttpClient|RestTemplate|WebClient)([^A-Za-z0-9_]|$)"
  } else if (language == "csharp") {
    kind_group("function", "method_declaration constructor_declaration local_function_statement lambda_expression anonymous_method_expression")
    kind_group("block", "if_statement for_statement foreach_statement while_statement do_statement switch_statement switch_expression try_statement")
    kind_group("nest", "if_statement conditional_expression switch_statement switch_expression for_statement foreach_statement while_statement do_statement catch_clause")
    kind_group("call", "invocation_expression")
    kind_group("literal", "integer_literal real_literal string_literal verbatim_string_literal raw_string_literal character_literal boolean_literal null_literal")
    kind_group("interpolation", "interpolation")
    kind_group("container", "initializer_expression")
    kind_group("class", "class_declaration")
    kind_group("import", "using_directive")
    kind_group("sugar", "lambda_expression await_expression yield_statement interpolated_string_expression conditional_access_expression using_statement")
    kind_group("name_declaration", "class_declaration interface_declaration struct_declaration enum_declaration record_declaration method_declaration variable_declarator local_function_statement property_declaration")
    kind_group("params", "parameter_list")
    kind_group("this", "this_expression this")
    NETWORK = "(^|[^A-Za-z0-9_])(HttpClient|WebClient|HttpWebRequest)([^A-Za-z0-9_]|$)"
  } else if (language == "php") {
    kind_group("function", "function_definition method_declaration anonymous_function anonymous_function_creation_expression arrow_function")
    kind_group("block", "if_statement for_statement foreach_statement while_statement do_statement switch_statement try_statement match_expression")
    kind_group("nest", "if_statement conditional_expression switch_statement match_expression for_statement foreach_statement while_statement do_statement catch_clause")
    kind_group("else", "else_clause")
    kind_group("elseif", "else_if_clause")
    kind_group("call", "function_call_expression member_call_expression scoped_call_expression nullsafe_member_call_expression")
    kind_group("literal", "integer float string encapsed_string boolean null heredoc nowdoc")
    kind_group("interpolation", "variable_name dynamic_variable_name")
    kind_group("container", "array_creation_expression")
    kind_group("pair", "array_element_initializer")
    kind_group("class", "class_declaration trait_declaration")
    kind_group("import", "namespace_use_declaration")
    kind_group("sugar", "anonymous_function arrow_function variadic_unpacking yield_expression match_expression nullsafe_member_access_expression")
    kind_group("name_declaration", "function_definition method_declaration class_declaration interface_declaration trait_declaration enum_declaration assignment_expression")
    kind_group("params", "formal_parameters")
    kind_group("this", "")
    NETWORK = "curl_exec\\(|(^|[^A-Za-z0-9_])(GuzzleHttp|Http::(get|post|put|delete))|file_get_contents\\(['\"]https?:"
  } else if (language == "ruby") {
    kind_group("function", "method singleton_method lambda block do_block")
    kind_group("block", "if unless while until for case case_match begin")
    kind_group("nest", "if unless while until for case case_match conditional rescue")
    kind_group("else", "else")
    kind_group("elseif", "elsif")
    kind_group("call", "call")
    kind_group("literal", "integer float string simple_symbol symbol true false nil rational complex")
    kind_group("interpolation", "interpolation")
    kind_group("container", "array hash")
    kind_group("pair", "pair")
    kind_group("class", "class")
    kind_group("import", "")
    kind_group("sugar", "block do_block lambda splat_argument hash_splat_argument yield interpolation safe_navigation")
    kind_group("name_declaration", "method singleton_method class module assignment")
    kind_group("params", "method_parameters lambda_parameters block_parameters")
    kind_group("this", "self")
    NETWORK = "Net::HTTP|(^|[^A-Za-z0-9_])(Faraday|HTTParty|RestClient|HTTP)\\.(get|post|put|delete|new)"
  } else {
    kind_group("function", language == "cpp" ? "function_definition lambda_expression" : "function_definition")
    kind_group("block", "if_statement for_statement while_statement do_statement switch_statement for_range_loop try_statement")
    kind_group("nest", "if_statement conditional_expression switch_statement for_statement while_statement do_statement for_range_loop catch_clause")
    kind_group("else", "else_clause")
    kind_group("call", "call_expression")
    kind_group("literal", "number_literal string_literal char_literal true false null nullptr concatenated_string raw_string_literal")
    kind_group("container", "initializer_list")
    kind_group("pair", "initializer_pair")
    kind_group("class", "class_specifier")
    kind_group("import", "preproc_include")
    kind_group("sugar", "lambda_expression template_function co_await_expression co_yield_statement for_range_loop")
    kind_group("name_declaration", "function_definition declaration struct_specifier enum_specifier union_specifier type_definition class_specifier preproc_def preproc_function_def alias_declaration")
    kind_group("params", "parameter_list")
    kind_group("this", "this")
    NETWORK = "curl_easy_perform|cpr::(Get|Post)|httplib::Client"
  }
}
