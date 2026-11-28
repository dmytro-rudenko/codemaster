# File roles and layout detection.

# role_of <project dir> <layout> <path>: "role entity global"
role_of() {
  (
    CM_ROOT="$PLUGIN_ROOT"
    . "$PLUGIN_ROOT/lib/common.sh"
    . "$PLUGIN_ROOT/lib/config.sh"
    . "$PLUGIN_ROOT/lib/git.sh"
    . "$PLUGIN_ROOT/lib/files.sh"
    cm_temp_init
    CM_PROJECT_ROOT="$1"
    cm_config_load "$1"
    CM_LAYOUT="$2"
    printf '%s\n' "$3" | cm_roles | awk -F '\t' '{ print $2, $3, $4 }'
  )
}

layout_of() {
  (
    CM_ROOT="$PLUGIN_ROOT"
    . "$PLUGIN_ROOT/lib/common.sh"
    . "$PLUGIN_ROOT/lib/config.sh"
    . "$PLUGIN_ROOT/lib/git.sh"
    . "$PLUGIN_ROOT/lib/files.sh"
    cm_temp_init
    CM_PROJECT_ROOT="$1"
    cm_config_load "$1"
    cm_detect_layout
  )
}

test_modular_roles() {
  local root
  root=$(mktemp -d "$TEST_TMP/root.XXXXXX")
  assert_equal "interfaces user 0" "$(role_of "$root" modular src/user/user.interfaces.ts)"
  assert_equal "interfaces user 0" "$(role_of "$root" modular src/user/types.ts)"
  assert_equal "module user 0" "$(role_of "$root" modular src/user/user.service.ts)"
  assert_equal "single-file-module report 0" "$(role_of "$root" modular src/report.ts)"
  assert_equal "consts global 1" "$(role_of "$root" modular src/global/consts.ts)"
  assert_equal "util - 0" "$(role_of "$root" modular src/utils/format.ts)"
  assert_equal "other - 0" "$(role_of "$root" modular scripts/run.ts)"
  assert_equal "helper billing 0" "$(role_of "$root" modular src/billing/helpers.py)"
  assert_equal "test - 0" "$(role_of "$root" modular src/user/__tests__/fixture.ts)"
}

test_layered_roles() {
  local root
  root=$(mktemp -d "$TEST_TMP/root.XXXXXX")
  assert_equal "single-file-module user 0" "$(role_of "$root" layered src/modules/user.ts)"
  assert_equal "module order 0" "$(role_of "$root" layered src/modules/order/order.ts)"
  assert_equal "consts - 1" "$(role_of "$root" layered src/consts/global.ts)"
  assert_equal "helper fetch-user 0" "$(role_of "$root" layered src/helpers/fetch-user.ts)"
  assert_equal "test - 0" "$(role_of "$root" layered tests/modules/user.test.ts)"
}

test_test_files_of_every_language() {
  local root path
  root=$(mktemp -d "$TEST_TMP/root.XXXXXX")
  for path in src/user/test_user.py src/user/user_test.go src/User/UserTest.java src/User/UserTests.cs src/user/user_spec.rb src/User/UserTest.php src/user/user_test.c spec/user.rb src/test/java/com/x/User.java; do
    assert_equal "test - 0" "$(role_of "$root" modular "$path")" "$path"
  done
}

test_entrypoints() {
  local root
  root=$(mktemp -d "$TEST_TMP/root.XXXXXX")
  assert_equal "entrypoint - 0" "$(role_of "$root" layered bin/codemaster.ts)"
  assert_equal "entrypoint - 0" "$(role_of "$root" layered main.go)"
  assert_equal "entrypoint - 0" "$(role_of "$root" layered src/main.rs)"
}

test_layout_detection() {
  assert_equal "layered" "$(layout_of "$(copy_fixture layered)")"
  assert_equal "modular" "$(layout_of "$(copy_fixture modular)")"
  assert_equal "off" "$(layout_of "$(copy_fixture off)")"
  assert_equal "layered" "$(layout_of "$(copy_fixture polyglot)")"
}
