# Project conventions from the file list. The first input file is the flat config, then project paths.
# -v roots="<root>|<root>" (the effective source roots, "." for the project root)
# Prints flat profile lines for roles, testsLocation (the dominant root test folder; tests next to the code
# never count) and testSuffix, and "@source<TAB>key<TAB>text" lines.
# POSIX awk, with util.awk, cfg.awk, lang.awk and roles.awk.

FNR == NR {
  cfg_store()
  next
}

!started {
  started = 1
  root_count = split(roots, root_list, "|")
  for (position = 1; position <= root_count; position++) {
    if (root_list[position] == ".") {
      root_list[position] = ""
    }
  }
  split("module interfaces consts helper util", role_names, " ")
  split("modules services controllers features domains handlers", alias_module, " ")
  split("interfaces types typings contracts dto", alias_interfaces, " ")
  split("consts constants enums", alias_consts, " ")
  split("helpers", alias_helper, " ")
  split("utils util shared common lib", alias_util, " ")
}

{
  path = $0
  inner = inside_roots(path)
  if (inner != "") {
    count = split(inner, segments, "/")
    for (position = 1; position < count && position <= 3; position++) {
      folders[segments[position]] = 1
    }
  }
  count = split(path, segments, "/")
  name = segments[count]
  in_folder = segments[1] == "tests" || segments[1] == "test" || segments[1] == "__tests__" || segments[1] == "spec"
  suffix = ""
  if (match(name, /\.(test|spec)\./)) {
    suffix = substr(name, RSTART + 1, RLENGTH - 2)
  }
  if (suffix == "" && !in_folder && !is_test_name(name)) {
    next
  }
  if (in_folder) {
    location_total++
    location_count[segments[1]]++
  }
  if (suffix != "") {
    suffix_total++
    suffix_count[suffix]++
  }
}

function inside_roots(path,    position, prefix, best, best_length) {
  best = ""
  best_length = -1
  for (position = 1; position <= root_count; position++) {
    prefix = root_list[position] == "" ? "" : root_list[position] "/"
    if (substr(path, 1, length(prefix)) == prefix && length(prefix) > best_length) {
      best = substr(path, length(prefix) + 1)
      best_length = length(prefix)
    }
  }
  return best
}

function emit_role(role, aliases,    count, position, present, found) {
  count = 0
  for (position = 1; position in aliases; position++) {
    if (aliases[position] in folders) {
      present[++count] = aliases[position]
    }
  }
  printf "roles/%s\t[\t\n", role
  if (count == 0) {
    for (position = 1; position in aliases; position++) {
      printf "roles/%s/%d\ts\t%s\n", role, position - 1, aliases[position]
    }
    return
  }
  for (position = 1; position <= count; position++) {
    printf "roles/%s/%d\ts\t%s\n", role, position - 1, present[position]
    found_names = found_names (found_names == "" ? "" : ", ") present[position]
  }
}

function dominant(key, counts, total, fallback,    best, best_count, item, share) {
  best = ""
  best_count = 0
  for (item in counts) {
    if (counts[item] > best_count || (counts[item] == best_count && item < best)) {
      best = item
      best_count = counts[item]
    }
  }
  if (best_count < 5 || best_count / total < 0.6) {
    printf "%s\ts\t%s\n", key, fallback
    printf "@source\t%s\tdefault\n", key
    return
  }
  share = int(best_count / total * 100 + 0.5)
  printf "%s\ts\t%s\n", key, best
  printf "@source\t%s\tdominant %d%% (%d/%d)\n", key, share, best_count, total
}

END {
  found_names = ""
  printf "roles\t{\t\n"
  emit_role("module", alias_module)
  emit_role("interfaces", alias_interfaces)
  emit_role("consts", alias_consts)
  emit_role("helper", alias_helper)
  emit_role("util", alias_util)
  printf "@source\troles\t%s\n", (found_names == "" ? "default" : "found: " found_names)
  dominant("testsLocation", location_count, location_total, "tests")
  dominant("testSuffix", suffix_count, suffix_total, "test")
}
