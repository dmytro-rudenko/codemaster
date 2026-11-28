# Queries flat JSON lines (json.awk) on stdin. -v query=<path> -v mode=value|list|keys|type
# value: the unescaped scalar; list: array items (or object values) in order, one per line;
# keys: the member keys of an object in order; type: the type marker.
# POSIX awk; run with LC_ALL=C, together with util.awk.

BEGIN {
  FS = "\t"
  count = 0
  prefix = query == "" ? "" : query "/"
}

{
  value = $0
  sub(/^[^\t]*\t[^\t]*\t?/, "", value)
  if ($1 == query) {
    found_type = $2
    found_value = value
    next
  }
  if (prefix != "" && substr($1, 1, length(prefix)) != prefix) {
    next
  }
  rest = substr($1, length(prefix) + 1)
  if (rest == "" || index(rest, "/") > 0) {
    next
  }
  count++
  member_key[count] = rest
  member_type[count] = $2
  member_value[count] = value
}

END {
  if (mode == "type") {
    if (found_type != "") {
      print found_type
    }
    exit
  }
  if (mode == "value") {
    if (found_type == "s") {
      print json_unescape(found_value)
    } else if (found_type != "" && found_type != "{" && found_type != "[") {
      print found_value
    }
    exit
  }
  if (found_type != "{" && found_type != "[") {
    exit
  }
  for (position = 1; position <= count; position++) {
    order[position] = position
  }
  if (found_type == "[") {
    for (position = 2; position <= count; position++) {
      current = order[position]
      slot = position - 1
      while (slot > 0 && member_key[order[slot]] + 0 > member_key[current] + 0) {
        order[slot + 1] = order[slot]
        slot--
      }
      order[slot + 1] = current
    }
  }
  for (position = 1; position <= count; position++) {
    item = order[position]
    if (mode == "keys") {
      key = member_key[item]
      gsub(/%2F/, "/", key)
      gsub(/%09/, "\t", key)
      gsub(/%25/, "%", key)
      print key
    } else if (member_type[item] == "s") {
      print json_unescape(member_value[item])
    } else {
      print member_value[item]
    }
  }
}
