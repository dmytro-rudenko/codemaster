# Shared awk functions. POSIX awk; run with LC_ALL=C.

function trim(text) {
  sub(/^[ \t\r\n]+/, "", text)
  sub(/[ \t\r\n]+$/, "", text)
  return text
}

function to_lower(text) {
  return tolower(text)
}

# JSON string content (without quotes) to raw text. \u escapes of the BMP become UTF-8 bytes.
function json_unescape(raw,    out, position, character, next_character, code) {
  if (index(raw, "\\") == 0) {
    return raw
  }
  out = ""
  for (position = 1; position <= length(raw); position++) {
    character = substr(raw, position, 1)
    if (character != "\\") {
      out = out character
      continue
    }
    position++
    next_character = substr(raw, position, 1)
    if (next_character == "n") {
      out = out "\n"
    } else if (next_character == "t") {
      out = out "\t"
    } else if (next_character == "r") {
      out = out "\r"
    } else if (next_character == "b") {
      out = out "\b"
    } else if (next_character == "f") {
      out = out "\f"
    } else if (next_character == "u") {
      code = hex_value(substr(raw, position + 1, 4))
      position += 4
      out = out utf8_bytes(code)
    } else {
      out = out next_character
    }
  }
  return out
}

function hex_value(text,    position, total, digit) {
  total = 0
  text = tolower(text)
  for (position = 1; position <= length(text); position++) {
    digit = index("0123456789abcdef", substr(text, position, 1)) - 1
    if (digit < 0) {
      return total
    }
    total = total * 16 + digit
  }
  return total
}

function utf8_bytes(code) {
  if (code < 128) {
    return sprintf("%c", code)
  }
  if (code < 2048) {
    return sprintf("%c%c", 192 + int(code / 64), 128 + code % 64)
  }
  return sprintf("%c%c%c", 224 + int(code / 4096), 128 + int(code / 64) % 64, 128 + code % 64)
}

# Raw text to a quoted JSON string. Control characters become escapes or spaces.
function json_quote(text) {
  gsub(/\\/, "\\\\", text)
  gsub(/"/, "\\\"", text)
  gsub(/\n/, "\\n", text)
  gsub(/\r/, "\\r", text)
  gsub(/\t/, "\\t", text)
  gsub(/[\001-\037]/, " ", text)
  return "\"" text "\""
}

# Glob (as in .gitignore and node:path.matchesGlob) to an anchored ERE: ** crosses folders, * and ? do not.
function glob_regex(pattern,    out, position, total, character, depth) {
  out = "^"
  total = length(pattern)
  depth = 0
  for (position = 1; position <= total; position++) {
    character = substr(pattern, position, 1)
    if (character == "*") {
      if (substr(pattern, position + 1, 1) == "*") {
        if (substr(pattern, position + 2, 1) == "/") {
          out = out "(.*/)?"
          position += 2
        } else {
          out = out ".*"
          position++
        }
      } else {
        out = out "[^/]*"
      }
    } else if (character == "?") {
      out = out "[^/]"
    } else if (character == "{") {
      out = out "("
      depth++
    } else if (character == "}" && depth > 0) {
      out = out ")"
      depth--
    } else if (character == "," && depth > 0) {
      out = out "|"
    } else if (character == "\\") {
      out = out "\\\\"
    } else if (character == "^") {
      out = out "\\^"
    } else if (index(".+()|$}[]", character) > 0) {
      out = out "[" character "]"
    } else {
      out = out character
    }
  }
  return out "$"
}

function glob_match(path, pattern) {
  if (!(pattern in glob_cache)) {
    glob_cache[pattern] = glob_regex(pattern)
  }
  return path ~ glob_cache[pattern]
}

function is_upper(character) {
  return character ~ /^[A-Z]$/
}

function is_lower_or_digit(character) {
  return character ~ /^[a-z0-9]$/
}

# Splits camelCase, PascalCase, snake_case and kebab-case into lower-case words. Returns the count.
function split_words(name, words,    count, position, total, character, previous, following, current) {
  count = 0
  current = ""
  total = length(name)
  for (position = 1; position <= total; position++) {
    character = substr(name, position, 1)
    if (character ~ /[ \t_$-]/) {
      if (current != "") {
        words[++count] = tolower(current)
      }
      current = ""
      continue
    }
    previous = position > 1 ? substr(name, position - 1, 1) : ""
    following = position < total ? substr(name, position + 1, 1) : ""
    if (current != "" && is_upper(character) && (is_lower_or_digit(previous) || (is_upper(previous) && following ~ /^[a-z]$/))) {
      words[++count] = tolower(current)
      current = ""
    }
    current = current character
  }
  if (current != "") {
    words[++count] = tolower(current)
  }
  return count
}

function capitalize(word) {
  return toupper(substr(word, 1, 1)) substr(word, 2)
}

# entity name in "upper-snake", "camel" or "pascal".
function entity_case(entity, style,    words, count, position, out) {
  count = split_words(entity, words)
  out = ""
  for (position = 1; position <= count; position++) {
    if (style == "upper-snake") {
      out = out (position > 1 ? "_" : "") toupper(words[position])
    } else if (style == "camel" && position == 1) {
      out = out words[position]
    } else {
      out = out capitalize(words[position])
    }
  }
  return out
}

function words_contain(list, word,    items, count, position) {
  count = split(list, items, " ")
  for (position = 1; position <= count; position++) {
    if (items[position] == word) {
      return 1
    }
  }
  return 0
}

function path_dirname(path,    position) {
  position = match(path, /\/[^\/]*$/)
  return position == 0 ? "." : (position == 1 ? "/" : substr(path, 1, position - 1))
}

function path_basename(path) {
  sub(/^.*\//, "", path)
  return path
}

function repeat_text(text, count,    out) {
  out = ""
  while (count-- > 0) {
    out = out text
  }
  return out
}
