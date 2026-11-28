# File selection, roles and layout. The first input file is the flat config.
# -v mode=filter: input paths; prints the source files of enabled languages outside ignored folders and "exclude"
#   (with -v want=styles, the style files instead).
# -v mode=roles -v layout=<layout>: input paths; prints "path<TAB>role<TAB>entity<TAB>global<TAB>language".
# -v mode=layout: input "folder<TAB>entry" lines of the folders in the source roots; prints the detected layout.
# POSIX awk, together with util.awk, cfg.awk, lang.awk and roles.awk.

FNR == NR {
  cfg_store()
  next
}

!started {
  started = 1
  exclude_count = cfg_list("exclude", exclude_glob)
  language_count = cfg_list("languages", enabled_list)
  for (position = 1; position <= language_count; position++) {
    enabled[enabled_list[position]] = 1
  }
  roles_init()
}

mode == "filter" {
  path = $0
  if (path == "") {
    next
  }
  if (want == "styles") {
    if (is_style_file(path) && !in_ignored_directory(path) && !excluded(path)) {
      print path
    }
    next
  }
  language = language_of(path)
  if (language == "" || !(language_family(language) in enabled) || in_ignored_directory(path) || excluded(path)) {
    next
  }
  print path
  next
}

mode == "roles" {
  resolve_role($0, layout)
  printf "%s\t%s\t%s\t%s\t%s\n", $0, ROLE, (ENTITY == "" ? "-" : ENTITY), GLOBAL, language_of($0)
  next
}

mode == "layout" {
  split($0, parts, "\t")
  folder = parts[1]
  entry = parts[2]
  if (!(folder in folder_seen)) {
    folder_seen[folder] = 1
    role = alias_role(folder)
    if (role != "" && !(role in roles_found)) {
      roles_found[role] = 1
      role_count++
    }
  }
  role = name_role(stem_of(entry))
  if (role == "interfaces" || role == "consts" || role == "helper") {
    holds_role_file = 1
  }
  next
}

function excluded(path,    position) {
  for (position = 1; position <= exclude_count; position++) {
    if (glob_match(path, exclude_glob[position])) {
      return 1
    }
  }
  return 0
}

END {
  if (mode == "layout") {
    print (role_count >= 2 ? "layered" : (holds_role_file ? "modular" : "off"))
  }
}
