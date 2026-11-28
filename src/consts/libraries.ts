export const LIBRARIES_SKILL_DIRECTORY = ".claude/skills/codemaster-libraries";
export const LIBRARIES_INDEX_FILE = "SKILL.md";
export const LIBRARIES_GUARDED_PATHS = [
  ".claude",
  ".claude/skills",
  LIBRARIES_SKILL_DIRECTORY,
  `${LIBRARIES_SKILL_DIRECTORY}/${LIBRARIES_INDEX_FILE}`,
];
export const LIBRARIES_INDEX_HEADER = `---
name: codemaster-libraries
description: Summaries of this project's libraries: key APIs, pitfalls and documentation links. Use before implementing something a dependency may already do.
---
`;
export const LIBRARIES_MANIFEST_MISSING = "missing";
export const LIBRARIES_MANIFEST_INVALID = "invalid JSON";
export const LIBRARIES_TYPES_PREFIX = "@types/";
export const LIBRARIES_NAME_PATTERN = /^(@[A-Za-z0-9~-][A-Za-z0-9._~-]*\/)?[A-Za-z0-9~-][A-Za-z0-9._~-]*$/;
export const LIBRARIES_README_NAMES = ["README.md", "readme.md", "Readme.md", "README"];
