# Drops input paths that match "exclude". The first input file is the flat config. POSIX awk, with util.awk and cfg.awk.

FNR == NR {
  cfg_store()
  next
}

!started {
  started = 1
  count = cfg_list("exclude", patterns)
}

{
  for (position = 1; position <= count; position++) {
    if (glob_match($0, patterns[position])) {
      next
    }
  }
  print
}
