# Test files outside the one tests folder. First input file: the flat config; then role lines
# "path<TAB>role<TAB>entity<TAB>global<TAB>language". -v location=<tests folder>.
# Prints raw findings "path<TAB>1<TAB>error<TAB>test-placement<TAB>message". POSIX awk, with util, cfg, lang, roles.
FNR == NR { cfg_store(); next }
!started { started = 1; roles_init() }
$2 != "test" || $5 == "go" { next }
{
  path = $1
  if (path == location || substr(path, 1, length(location) + 1) == location "/" || path ~ /(^|\/)src\/test\//) {
    next
  }
  folder = test_folder_of(path)
  if (folder != "") {
    printf "%s\t1\terror\ttest-placement\tsecond test folder %s; keep all tests in %s/\n", path, folder, location
    next
  }
  count = relative_segments(path, relative)
  if (count > 0) {
    printf "%s\t1\terror\ttest-placement\ttest file %s belongs in %s\n", path, path, mirror_path(relative, count)
  }
}
function test_folder_of(path,    segments, count, position, out) {
  count = split(path, segments, "/")
  out = ""
  for (position = 1; position < count; position++) {
    out = out (position > 1 ? "/" : "") segments[position]
    if (is_test_folder(segments[position])) {
      return out
    }
  }
  return ""
}
function mirror_path(relative, count,    out, position) {
  out = location
  for (position = 1; position <= count; position++) {
    out = out "/" relative[position]
  }
  return out
}
