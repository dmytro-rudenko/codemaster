# Applies rule settings to findings and prints them. The first input file is the flat config;
# then findings "file<TAB>line<TAB>severity<TAB>rule<TAB>message", already sorted.
# -v format=text|json|hook -v files=<number of checked files>
# POSIX awk, with util.awk and cfg.awk.

BEGIN {
  FS = "\t"
}

FNR == NR {
  cfg_store()
  next
}

{
  rule_setting($4)
  if (!rule_enabled) {
    next
  }
  severity = rule_explicit ? rule_severity : $3
  if (severity == "error") {
    errors++
  } else {
    warnings++
  }
  total++
  if (format == "json") {
    item = "{\"severity\":" json_quote(severity) ",\"ruleId\":" json_quote($4) ",\"file\":" json_quote($1) ",\"line\":" ($2 + 0) ",\"message\":" json_quote($5)
    if (rule_reason != "") {
      item = item ",\"reason\":" json_quote(rule_reason)
    }
    items = items (total > 1 ? "," : "") item "}"
  } else {
    printf "%s %s %s:%d %s\n", severity, $4, $1, $2, $5
  }
}

END {
  if (format == "json") {
    printf "{\"findings\":[%s],\"summary\":{\"errors\":%d,\"warnings\":%d,\"files\":%d}}\n", items, errors, warnings, files
  } else if (format == "text") {
    printf "codemaster: %d errors, %d warnings in %d files\n", errors, warnings, files
  } else {
    printf "@@summary\t%d\t%d\n", errors, warnings
  }
}
