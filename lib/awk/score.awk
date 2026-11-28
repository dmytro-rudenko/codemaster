# Scores tournament variants, writes result.json and prints the table.
# Input: the flat config, then lines "variant<TAB>passed<TAB>failure<TAB>readability<TAB>length<TAB>bytecode<TAB>speed<TAB>bytecodePerToken<TAB>desugared"
# ("-" for a metric that was not measured). -v file, name: the target; -v result: the result.json path.
# Exit status 1 when no variant passed. POSIX awk, with util.awk and cfg.awk.

FNR == NR {
  cfg_store()
  next
}

{
  count++
  variant[count] = $1
  passed[count] = $2 == "true"
  failure[count] = $3
  for (field = 4; field <= 9; field++) {
    value[count, field] = $field == "" ? "-" : $field
  }
}

function relative_score(minimum, current) {
  return (minimum + 1) / (current + 1)
}

function ratio_score(minimum, current) {
  return current == 0 ? 1 : minimum / current
}

function number_text(number) {
  if (number == int(number)) {
    return sprintf("%d", number)
  }
  return sprintf("%.6g", number)
}

function json_metric(item, field) {
  return value[item, field] == "-" ? "null" : value[item, field]
}

END {
  split("readability length bytecode speed closeness", weight_names, " ")
  for (position = 1; position <= 5; position++) {
    weight[weight_names[position]] = cfg_get("tournament/weights/" weight_names[position]) + 0
  }
  for (field = 4; field <= 9; field++) {
    available[field] = 0
    minimum[field] = ""
  }
  measured = 0
  for (item = 1; item <= count; item++) {
    if (!passed[item]) {
      continue
    }
    measured++
    for (field = 4; field <= 9; field++) {
      if (value[item, field] == "-") {
        missing[field] = 1
        continue
      }
      if (minimum[field] == "" || value[item, field] + 0 < minimum[field] + 0) {
        minimum[field] = value[item, field] + 0
      }
    }
  }
  for (field = 4; field <= 9; field++) {
    available[field] = measured > 0 && !(field in missing)
  }
  dropped = 0
  if (!available[6]) {
    dropped += weight["bytecode"]
    weight["bytecode"] = 0
  }
  if (!available[7]) {
    dropped += weight["speed"]
    weight["speed"] = 0
  }
  kept = 0
  for (position = 1; position <= 5; position++) {
    if (weight_names[position] == "readability" || weight_names[position] == "length" || weight_names[position] == "closeness" || weight[weight_names[position]] > 0) {
      kept++
    }
  }
  for (position = 1; position <= 5; position++) {
    key = weight_names[position]
    if (key == "readability" || key == "length" || key == "closeness" || weight[key] > 0) {
      weight[key] += dropped / kept
    }
  }
  best = 0
  for (item = 1; item <= count; item++) {
    score[item] = ""
    if (!passed[item]) {
      continue
    }
    closeness = relative_score(minimum[9], value[item, 9])
    if (available[8]) {
      closeness = (ratio_score(minimum[8], value[item, 8]) + closeness) / 2
    }
    total = relative_score(minimum[4], value[item, 4]) * weight["readability"] + relative_score(minimum[5], value[item, 5]) * weight["length"] + closeness * weight["closeness"]
    if (available[6]) {
      total += relative_score(minimum[6], value[item, 6]) * weight["bytecode"]
    }
    if (available[7]) {
      total += relative_score(minimum[7], value[item, 7]) * weight["speed"]
    }
    score[item] = total
    if (best == 0 || total > score[best] + 1e-12) {
      best = item
    }
  }
  winner = best == 0 ? "none" : variant[best]
  printf "{\n  \"target\": {\n    \"file\": %s,\n    \"functionName\": %s\n  },\n  \"variants\": [", json_quote(file), json_quote(name) > result
  for (item = 1; item <= count; item++) {
    printf "%s\n    {\n      \"variant\": %s,\n      \"passed\": %s,\n      \"failure\": %s,\n", (item > 1 ? "," : ""), json_quote(variant[item]), (passed[item] ? "true" : "false"), (passed[item] ? "null" : json_quote(failure[item])) > result
    if (passed[item]) {
      printf "      \"metrics\": {\n        \"readability\": %s,\n        \"length\": %s,\n        \"bytecode\": %s,\n        \"speed\": %s,\n        \"bytecodePerToken\": %s,\n        \"desugared\": %s\n      },\n", json_metric(item, 4), json_metric(item, 5), json_metric(item, 6), json_metric(item, 7), json_metric(item, 8), json_metric(item, 9) > result
      printf "      \"score\": %s\n    }", number_text(score[item]) > result
    } else {
      printf "      \"metrics\": null,\n      \"score\": null\n    }" > result
    }
  }
  printf "\n  ],\n  \"winner\": %s\n}\n", json_quote(winner) > result
  close(result)
  print "variant | passed | readability | length | bytecode | speed | bytecodePerToken | desugared | score"
  for (item = 1; item <= count; item++) {
    line = variant[item] " | " (passed[item] ? "true" : "false")
    for (field = 4; field <= 9; field++) {
      line = line " | " (passed[item] ? value[item, field] : "-")
    }
    line = line " | " (passed[item] ? number_text(score[item]) : "-")
    if (!passed[item] && failure[item] != "") {
      line = line "  (" failure[item] ")"
    }
    print line
  }
  print "winner: " winner
  exit (best == 0 ? 1 : 0)
}
