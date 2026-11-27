export const INSTALL_AST_GREP_VERSION = "0.51.3";

export const INSTALL_PACKAGE_NAMES = ["@ast-grep/cli", "@ast-grep/napi"];

export const INSTALL_PACKAGES = INSTALL_PACKAGE_NAMES.map((name) => `${name}@${INSTALL_AST_GREP_VERSION}`);

export const INSTALL_TIMEOUT_MILLISECONDS = 180000;

export const INSTALL_RETRY_MILLISECONDS = 3600000;

export const INSTALL_FAILED_FILE = "install-failed";
