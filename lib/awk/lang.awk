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

# ast-grep language name of a path, or "" when codemaster does not read it.
function language_of(path,    extension, name) {
  name = path
  sub(/^.*\//, "", name)
  if (name ~ /\.d\.[mc]?ts$/ || name ~ /\.min\.js$/ || name ~ /\.pb\.go$/ || name ~ /_pb2\.py$/) {
    return ""
  }
  extension = extension_of(path)
  if (extension == "ts" || extension == "mts" || extension == "cts") {
    return "typescript"
  }
  if (extension == "tsx") {
    return "tsx"
  }
  if (extension == "js" || extension == "mjs" || extension == "cjs" || extension == "jsx") {
    return "javascript"
  }
  if (extension == "py") {
    return "python"
  }
  if (extension == "go") {
    return "go"
  }
  if (extension == "rs") {
    return "rust"
  }
  if (extension == "java") {
    return "java"
  }
  if (extension == "kt" || extension == "kts") {
    return "kotlin"
  }
  if (extension == "cs") {
    return "csharp"
  }
  if (extension == "php") {
    return "php"
  }
  if (extension == "rb") {
    return "ruby"
  }
  if (extension == "c" || extension == "h") {
    return "c"
  }
  if (extension == "cc" || extension == "cpp" || extension == "cxx" || extension == "hpp" || extension == "hh" || extension == "hxx") {
    return "cpp"
  }
  return ""
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
  if (language == "typescript" || language == "tsx" || language == "javascript") {
    return "ts tsx mts cts js jsx mjs cjs"
  }
  if (language == "python") {
    return "py"
  }
  if (language == "go") {
    return "go"
  }
  if (language == "rust") {
    return "rs"
  }
  if (language == "java") {
    return "java kt"
  }
  if (language == "kotlin") {
    return "kt kts java"
  }
  if (language == "csharp") {
    return "cs"
  }
  if (language == "php") {
    return "php"
  }
  if (language == "ruby") {
    return "rb"
  }
  if (language == "c") {
    return "c cc cpp"
  }
  return "cpp cc cxx c"
}
