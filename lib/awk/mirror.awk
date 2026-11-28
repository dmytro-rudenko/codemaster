# Test files that count as the mirror of a source file.
# The first input file is the flat config; then role lines "path<TAB>role<TAB>entity<TAB>global<TAB>language".
# -v location=<tests folder>. Prints "path<TAB>severity<TAB>expected<TAB>paths<TAB>names":
# paths are exact candidates ("|"-separated); names are file names accepted anywhere in the project.
# POSIX awk, with util.awk, cfg.awk and lang.awk.

FNR == NR {
  cfg_store()
  next
}

!started {
  started = 1
  load_table(default_template, "python:test_{stem}.py go:{stem}_test.go rust:{stem}.rs java:{stem}Test.{ext} kotlin:{stem}Test.{ext} php:{stem}Test.{ext} csharp:{stem}Tests.cs ruby:{stem}_spec.rb", " ")
  jvm_names = "{stem}Test.java|{stem}Tests.java|{stem}Test.kt|{stem}Tests.kt|{stem}IT.java|{stem}Spec.kt"
  load_table(names_template, "python:test_{stem}.py|{stem}_test.py go: rust: java:" jvm_names " kotlin:" jvm_names " csharp:{stem}Tests.cs|{stem}Test.cs php:{stem}Test.php ruby:{stem}_spec.rb|{stem}_test.rb|test_{stem}.rb", " ")
  suffix = cfg_get("testSuffix")
  other_suffix = suffix == "test" ? "spec" : "test"
  root_count = cfg_list("sourceRoot", roots)
  for (position = 1; position <= root_count; position++) {
    gsub(/\\/, "/", roots[position])
    sub(/^\.(\/|$)/, "", roots[position])
    sub(/\/+$/, "", roots[position])
  }
}

{
  path = $1
  role = $2
  language = $5
  strict = role == "module" || role == "single-file-module"
  lenient = role == "helper" || role == "util"
  if (!strict && !lenient) {
    next
  }
  name = path_basename(path)
  extension = extension_of(name)
  stem = substr(name, 1, length(name) - length(extension) - 1)
  directory = mirror_directory(path)
  paths = ""
  names = ""
  if (is_script_language(language)) {
    expected = join_path(directory, stem "." suffix "." extension)
    count = split(language_extensions(language), extensions, " ")
    for (position = 1; position <= count; position++) {
      paths = paths "|" join_path(directory, stem "." suffix "." extensions[position]) "|" join_path(directory, stem "." other_suffix "." extensions[position])
    }
  } else {
    expected = join_path(directory, default_test_name(language, stem, extension))
    names = test_names(language, stem, extension)
    paths = "|" expected
  }
  printf "%s\t%s\t%s\t%s\t%s\n", path, strict ? "error" : "warning", expected, substr(paths, 2), names
}

function join_path(directory, name) {
  return directory == "" || directory == "." ? name : directory "/" name
}

function mirror_directory(path,    directory, position, best, relative) {
  directory = path_dirname(path)
  if (language == "go") {
    return directory
  }
  if (directory ~ /(^|\/)src\/main\//) {
    sub(/src\/main\//, "src/test/", directory)
    return directory
  }
  best = ""
  found = 0
  for (position = 1; position <= root_count; position++) {
    if (roots[position] == "" || directory == roots[position] || substr(directory, 1, length(roots[position]) + 1) == roots[position] "/") {
      if (!found || length(roots[position]) > length(best)) {
        best = roots[position]
        found = 1
      }
    }
  }
  relative = directory
  if (found && best != "") {
    relative = directory == best ? "." : substr(directory, length(best) + 2)
  }
  if (directory == ".") {
    relative = "."
  }
  return relative == "." ? location : location "/" relative
}

# Expands {stem} and {ext} in one pass, so a file name containing either word or "&" comes out as written.
function fill_template(template, stem, extension,    out, at) {
  out = ""
  while ((at = index(template, "{")) > 0) {
    out = out substr(template, 1, at - 1)
    if (substr(template, at, 6) == "{stem}") {
      out = out stem
      template = substr(template, at + 6)
    } else if (substr(template, at, 5) == "{ext}") {
      out = out extension
      template = substr(template, at + 5)
    } else {
      out = out "{"
      template = substr(template, at + 1)
    }
  }
  return out template
}

function default_test_name(language, stem, extension) {
  return fill_template(language in default_template ? default_template[language] : "{stem}_test.{ext}", stem, extension)
}

function test_names(language, stem, extension,    out, count, position, extensions) {
  if (language in names_template) {
    return fill_template(names_template[language], stem, extension)
  }
  out = ""
  count = split(language_extensions(language), extensions, " ")
  for (position = 1; position <= count; position++) {
    out = out "|" stem "_test." extensions[position] "|test_" stem "." extensions[position] "|" stem "_tests." extensions[position]
  }
  return substr(out, 2)
}
