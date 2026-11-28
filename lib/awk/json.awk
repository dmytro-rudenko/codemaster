# Flattens one JSON document into lines "path<TAB>type<TAB>value".
# path: keys and array indices joined by "/", with "%", "/" and tabs escaped as %25, %2F, %09; the root is "".
# type: "{" object, "[" array, "s" string (value still JSON-escaped), "n" number, "b" boolean, "z" null.
# Containers are printed before their members, so empty containers survive and the order is kept.
# On invalid input it prints "!<TAB>error<TAB><reason>" and exits with status 1.
# POSIX awk; run with LC_ALL=C.

BEGIN {
  source = ""
}

{
  source = source $0 "\n"
}

END {
  total = length(source)
  position = 1
  failed = 0
  skip_space()
  if (position > total) {
    fail("empty input")
  }
  parse_value("")
  skip_space()
  if (!failed && position <= total) {
    fail("trailing characters")
  }
  if (failed) {
    exit 1
  }
}

function fail(reason) {
  if (!failed) {
    printf "!\terror\t%s at %d\n", reason, position
  }
  failed = 1
  position = total + 1
}

function skip_space(    character) {
  while (position <= total) {
    character = substr(source, position, 1)
    if (character != " " && character != "\t" && character != "\n" && character != "\r") {
      return
    }
    position++
  }
}

function escape_key(key) {
  gsub(/%/, "%25", key)
  gsub(/\//, "%2F", key)
  gsub(/\t/, "%09", key)
  return key
}

function join_path(base, key) {
  return base == "" ? escape_key(key) : base "/" escape_key(key)
}

function emit(path, type, value) {
  if (!failed) {
    printf "%s\t%s\t%s\n", path, type, value
  }
}

function parse_value(path,    character) {
  if (failed) {
    return
  }
  skip_space()
  character = substr(source, position, 1)
  if (character == "{") {
    parse_object(path)
  } else if (character == "[") {
    parse_array(path)
  } else if (character == "\"") {
    emit(path, "s", read_string())
  } else if (substr(source, position, 4) == "true") {
    position += 4
    emit(path, "b", "true")
  } else if (substr(source, position, 5) == "false") {
    position += 5
    emit(path, "b", "false")
  } else if (substr(source, position, 4) == "null") {
    position += 4
    emit(path, "z", "null")
  } else if (character ~ /[-0-9]/) {
    emit(path, "n", read_number())
  } else {
    fail("unexpected character")
  }
}

function parse_object(path,    key, character) {
  emit(path, "{", "")
  position++
  skip_space()
  if (substr(source, position, 1) == "}") {
    position++
    return
  }
  while (!failed) {
    skip_space()
    if (substr(source, position, 1) != "\"") {
      fail("expected a key")
      return
    }
    key = decode_key(read_string())
    skip_space()
    if (substr(source, position, 1) != ":") {
      fail("expected :")
      return
    }
    position++
    parse_value(join_path(path, key))
    skip_space()
    character = substr(source, position, 1)
    position++
    if (character == "}") {
      return
    }
    if (character != ",") {
      fail("expected , or }")
      return
    }
  }
}

function parse_array(path,    index_number, character) {
  emit(path, "[", "")
  position++
  skip_space()
  if (substr(source, position, 1) == "]") {
    position++
    return
  }
  index_number = 0
  while (!failed) {
    parse_value(join_path(path, index_number))
    index_number++
    skip_space()
    character = substr(source, position, 1)
    position++
    if (character == "]") {
      return
    }
    if (character != ",") {
      fail("expected , or ]")
      return
    }
  }
}

# Returns the string content between the quotes, escapes untouched.
function read_string(    start, character) {
  position++
  start = position
  while (position <= total) {
    character = substr(source, position, 1)
    if (character == "\\") {
      position += 2
      continue
    }
    if (character == "\"") {
      position++
      return substr(source, start, position - start - 1)
    }
    if (character == "\n") {
      break
    }
    position++
  }
  fail("unterminated string")
  return ""
}

function decode_key(raw) {
  gsub(/\\"/, "\"", raw)
  gsub(/\\\//, "/", raw)
  gsub(/\\\\/, "\\", raw)
  return raw
}

function read_number(    start) {
  start = position
  while (position <= total && substr(source, position, 1) ~ /[-+0-9.eE]/) {
    position++
  }
  return substr(source, start, position - start)
}
