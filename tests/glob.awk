# Test helper: prints "path pattern" for each input path and each matching pattern.
{
  split("src/*.ts|src/**/*.ts|tests/fixtures/**|**/*.{ts,py}", patterns, "|")
  for (position = 1; position <= 4; position++) {
    if (glob_match($0, patterns[position])) {
      matched[++count] = $0 " " patterns[position]
      order[count] = position
    }
  }
}
END {
  for (pattern = 1; pattern <= 4; pattern++) {
    for (position = 1; position <= count; position++) {
      if (order[position] == pattern) {
        print matched[position]
      }
    }
  }
}
