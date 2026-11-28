# Maps linter settings to codemaster profile fields. Input: flat JSON (json.awk) of
# `eslint --print-config` (-v kind=eslint) or of biome.json (-v kind=biome).
# Prints flat profile lines (rules/max-params, rules/max-nesting, rules/prefer-destructuring, constantCase, interfacePrefix).
# POSIX awk, with util.awk.

BEGIN {
  FS = "\t"
}

{
  value = $0
  sub(/^[^\t]*\t[^\t]*\t?/, "", value)
  type[$1] = $2
  raw[$1] = value
}

function get(path) {
  return type[path] == "s" ? json_unescape(raw[path]) : raw[path]
}

function is_off(path,    level) {
  if (!(path in type)) {
    return 0
  }
  level = type[path] == "[" ? path "/0" : path
  return get(level) == "off" || (type[level] == "n" && get(level) + 0 == 0)
}

function limit_rule(path, target,    option) {
  if (!(path in type)) {
    return
  }
  if (is_off(path)) {
    printf "%s\ts\toff\n", target
    return
  }
  if (type[path] != "[") {
    return
  }
  option = path "/1"
  if (type[option] == "n") {
    printf "%s\t{\t\n%s/max\tn\t%s\n", target, target, raw[option]
  } else if (type[option "/max"] == "n") {
    printf "%s\t{\t\n%s/max\tn\t%s\n", target, target, raw[option "/max"]
  }
}

# Members of a string-or-array field, joined by spaces.
function members(path,    out, position) {
  if (type[path] == "s") {
    return get(path)
  }
  out = ""
  for (position = 0; (path "/" position) in type; position++) {
    out = out " " get(path "/" position)
  }
  return substr(out, 2)
}

function map_convention(path, selectors, modifiers,    formats, naming, count, items) {
  formats = members(path "/format")
  if (formats == "") {
    formats = members(path "/formats")
  }
  count = split(formats, items, " ")
  naming = ""
  if (count == 1) {
    if (items[1] == "UPPER_CASE" || items[1] == "CONSTANT_CASE") {
      naming = "upper-snake"
    } else if (items[1] == "camelCase") {
      naming = "camel"
    } else if (items[1] == "PascalCase") {
      naming = "pascal"
    }
  }
  if (words_contain(selectors, "variable") && (words_contain(modifiers, "const") || words_contain(modifiers, "global")) && naming != "") {
    constant_case = naming
  }
  if (words_contain(selectors, "interface") && words_contain(members(path "/prefix"), "I")) {
    interface_prefix = "I"
  }
}

END {
  if (kind == "eslint") {
    limit_rule("rules/max-params", "rules/max-params")
    limit_rule("rules/max-depth", "rules/max-nesting")
    if (is_off("rules/prefer-destructuring")) {
      printf "rules/prefer-destructuring\ts\toff\n"
    }
    path = "rules/@typescript-eslint%2Fnaming-convention"
    if (type[path] == "[" && !is_off(path)) {
      for (position = 1; (path "/" position) in type; position++) {
        map_convention(path "/" position, members(path "/" position "/selector"), members(path "/" position "/modifiers"))
      }
    }
  } else {
    path = "linter/rules/complexity/useMaxParams"
    level = type[path] == "s" ? get(path) : get(path "/level")
    if (level == "off") {
      printf "rules/max-params\ts\toff\n"
    } else if (type[path "/options/max"] == "n") {
      printf "rules/max-params\t{\t\nrules/max-params/max\tn\t%s\n", raw[path "/options/max"]
    }
    path = "linter/rules/style/useNamingConvention/options/conventions"
    for (position = 0; (path "/" position) in type; position++) {
      selector = get(path "/" position "/selector/kind")
      if (selector == "const" || selector == "variable") {
        map_convention(path "/" position, "variable", "const")
      }
    }
  }
  if (constant_case != "") {
    printf "constantCase\ts\t%s\n", constant_case
  }
  if (interface_prefix != "") {
    printf "interfacePrefix\ts\t%s\n", interface_prefix
  }
}
