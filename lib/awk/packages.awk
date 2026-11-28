# simple-package: packages from simplePackages in a package.json. The first input file is the flat config,
# the second the manifest text; -v flat=<its flat JSON> -v manifest=<project path>. POSIX awk, with util.awk and cfg.awk.


FNR == NR { cfg_store(); next }
{ text[FNR] = $0; total = FNR }
END {
  while ((getline line < flat) > 0) {
    split(line, parts, "\t")
    declared[parts[1]] = 1
  }
  count = cfg_list("simplePackages", packages)
  for (position = 1; position <= count; position++) {
    name = packages[position]
    key = name
    gsub(/%/, "%25", key)
    gsub(/\//, "%2F", key)
    section = ""
    if (("dependencies/" key) in declared) {
      section = "dependencies"
    } else if (("devDependencies/" key) in declared) {
      section = "devDependencies"
    }
    if (section == "") {
      continue
    }
    section_line = 0
    key_line = 0
    for (line_number = 1; line_number <= total; line_number++) {
      stripped = text[line_number]
      sub(/^[ \t]+/, "", stripped)
      if (section_line == 0 && index(stripped, "\"" section "\"") == 1) {
        section_line = line_number
      } else if (section_line > 0 && key_line == 0 && index(stripped, "\"" name "\"") == 1) {
        key_line = line_number
      }
    }
    printf "%s\t%d\twarning\tsimple-package\t%s: write simple HTTP code yourself (fetch)\n", manifest, (key_line > 0 ? key_line : (section_line > 0 ? section_line : 1)), name
  }
}
