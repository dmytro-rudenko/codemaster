export const HOOK_REASON_HEADER = "Run the codemaster skill (codemaster:codemaster) for this branch.";

export const HOOK_FINDINGS_LIMIT = 30;

export const HOOK_CANDIDATES_LIMIT = 30;

export const HOOK_LIBRARIES_LIMIT = 10;

export const HOOK_FILES_LIMIT = 200;

export const HOOK_LINE_LIMIT = 300;

export const HOOK_UNSAFE_CHARACTERS = /[\u0000-\u001f\u007f\u0085\u2028\u2029\u202a-\u202e\u2066-\u2069\u{e0000}-\u{e007f}]/gu;

export const HOOK_STATE_FILE = "checked-files.json";

export const HOOK_MANIFEST_FILE = "package.json";

export const HOOK_DEFERRED_FILE = "deferred-files.json";
