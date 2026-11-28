# file-name-suffix. First input file: the flat config; then role lines (style files carry role "style").
# Prints raw findings "path<TAB>1<TAB>warning<TAB>file-name-suffix<TAB>rename to <path>". POSIX awk, with util, cfg, lang, roles.
BEGIN { FS = "\t" }
FNR == NR { cfg_store(); next }
!started { started = 1; roles_init() }
{
  path = $1; role = $2
  name = path_basename(path); directory = path_dirname(path)
  extension = extension_of(name)
  stem = substr(name, 1, length(name) - length(extension) - 1)
  if (index(stem, ".") == 0) { next }
  head = stem; sub(/\.[^.]*$/, "", head)
  word = stem; sub(/^.*\./, "", word)
  if (role == "style" && word ~ /^(styles|style|module|component|css)$/) {
    suggest(directory, head "." extension)
  } else if ((role == "consts" || role == "interfaces") && name_role(word) == role) {
    suggest(directory, (alias_role(path_basename(directory)) == role ? head : word) "." extension)
  }
}
function suggest(directory, file) {
  printf "%s\t1\twarning\tfile-name-suffix\trename to %s\n", $1, (directory == "" || directory == "." ? file : directory "/" file)
}
