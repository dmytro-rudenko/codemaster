# File extension to language. POSIX awk.

function extension_of(path,    name) {
  name = path
  sub(/^.*\//, "", name)
  if (index(name, ".") == 0) {
    return ""
  }
  sub(/^.*\./, "", name)
  return tolower(name)
}

# Fills table from "key:value" entries joined by separator.
function load_table(table, entries, separator,    count, position, pairs, colon) {
  count = split(entries, pairs, separator)
  for (position = 1; position <= count; position++) {
    colon = index(pairs[position], ":")
    table[substr(pairs[position], 1, colon - 1)] = substr(pairs[position], colon + 1)
  }
}

# Fills the extension tables on first use, so every program that includes this file can call them.
function lang_tables(    script) {
  if (lang_ready) {
    return
  }
  lang_ready = 1
  load_table(extension_language, "ts:typescript mts:typescript cts:typescript tsx:tsx js:javascript mjs:javascript cjs:javascript jsx:javascript py:python go:go rs:rust java:java kt:kotlin kts:kotlin cs:csharp php:php rb:ruby c:c h:c cc:cpp cpp:cpp cxx:cpp hpp:cpp hh:cpp hxx:cpp", " ")
  script = "ts tsx mts cts js jsx mjs cjs"
  load_table(language_extension_list, "typescript:" script "|tsx:" script "|javascript:" script "|python:py|go:go|rust:rs|java:java kt|kotlin:kt kts java|csharp:cs|php:php|ruby:rb|c:c cc cpp|cpp:cpp cc cxx c", "|")
  load_table(style_extension, "css:1 scss:1 sass:1 less:1", " ")
}

function is_style_file(path) {
  lang_tables()
  return extension_of(path) in style_extension
}

# ast-grep language name of a path, or "" when codemaster does not read it.
function language_of(path,    extension, name) {
  name = path
  sub(/^.*\//, "", name)
  if (name ~ /\.d\.[mc]?ts$/ || name ~ /\.min\.js$/ || name ~ /\.pb\.go$/ || name ~ /_pb2\.py$/) {
    return ""
  }
  lang_tables()
  extension = extension_of(path)
  return (extension in extension_language) ? extension_language[extension] : ""
}

# The name used in the "languages" config field.
function language_family(language) {
  return language == "tsx" ? "typescript" : language
}

function is_script_language(language) {
  return language == "typescript" || language == "tsx" || language == "javascript"
}

function ignored_directory(name) {
  return name == "node_modules" || name == "dist" || name == "build" || name == "coverage" || name == "vendor" || name == "target" || name == "__pycache__" || name == ".venv" || name == "venv" || name == ".tox" || name == ".gradle" || name == "obj" || name == "Pods" || name == ".git"
}

function in_ignored_directory(path,    parts, count, position) {
  count = split(path, parts, "/")
  for (position = 1; position < count; position++) {
    if (ignored_directory(parts[position])) {
      return 1
    }
  }
  return 0
}

# The usual extensions of a language, for looking up test files.
function language_extensions(language) {
  lang_tables()
  return (language in language_extension_list) ? language_extension_list[language] : language_extension_list["cpp"]
}
