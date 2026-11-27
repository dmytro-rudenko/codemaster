import { before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CONFIG_DEFAULTS, CONFIG_FILE_NAME } from "../../src/consts/config.ts";
import { ROLES_ALIASES } from "../../src/consts/roles.ts";
import type { ConfigProject } from "../../src/interfaces/config.ts";
import { ensureInstalled } from "../../src/modules/install.ts";
import { formatProfile, runCommand, scanConventions, writeProfile } from "../../src/modules/conventions.ts";

before(() => {
  ensureInstalled();
});

async function withProject(files: Record<string, string>, body: (directory: string) => Promise<void> | void): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "codemaster-conventions-"));
  try {
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(dirname(join(directory, name)), { recursive: true });
      writeFileSync(join(directory, name), text);
    }
    await body(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function scan(directory: string, raw: Record<string, unknown> = {}) {
  const config = { ...structuredClone(CONFIG_DEFAULTS), ...raw } as ConfigProject;
  return scanConventions(directory, { config, raw });
}

function writeFakeEslint(directory: string, script: string): void {
  const binary = join(directory, "node_modules", ".bin", "eslint");
  mkdirSync(dirname(binary), { recursive: true });
  writeFileSync(binary, `#!/bin/sh\nprintf '%s\\n' "$@" > "$(dirname "$0")/received"\n${script}\n`);
  chmodSync(binary, 0o755);
}

function printConfigScript(rules: Record<string, unknown>): string {
  return `cat <<'JSON'\n${JSON.stringify({ rules })}\nJSON`;
}

function upperConstants(count: number): string {
  return Array.from({ length: count }, (_, position) => `export const LIMIT_${position} = ${position};\n`).join("");
}

function camelConstants(count: number): string {
  return Array.from({ length: count }, (_, position) => `export const limit${position} = ${position};\n`).join("");
}

function numberedFiles(prefix: string, suffix: string, count: number): Record<string, string> {
  return Object.fromEntries(Array.from({ length: count }, (_, position) => [`${prefix}${position}${suffix}`, "export {};\n"]));
}

test("types folder and five UPPER constants give interfaces types and dominant upper-snake", async () => {
  await withProject(
    {
      "src/types/a.ts": "export interface Thing { name: string }\n",
      "src/constants/a.ts": upperConstants(5),
    },
    async (directory) => {
      const { profile, sources } = await scan(directory);
      assert.deepEqual(profile.roles?.interfaces, ["types"]);
      assert.deepEqual(profile.roles?.consts, ["constants"]);
      assert.equal(profile.constantCase, "upper-snake");
      assert.equal(sources.constantCase, "dominant 100% (5/5)");
    },
  );
});

test("camel constants at the dominance threshold give camel", async () => {
  await withProject(
    {
      "src/types/a.ts": "export interface Thing { name: string }\n",
      "src/constants/a.ts": camelConstants(6) + upperConstants(4),
    },
    async (directory) => {
      const { profile, sources } = await scan(directory);
      assert.equal(profile.constantCase, "camel");
      assert.equal(sources.constantCase, "dominant 60% (6/10)");
    },
  );
});

test("a role with no alias found keeps the full alias list and found roles carry a found source", async () => {
  await withProject({ "src/types/a.ts": "export interface Thing { name: string }\n" }, async (directory) => {
    const { profile, sources } = await scan(directory);
    assert.deepEqual(profile.roles?.module, ROLES_ALIASES.module);
    assert.deepEqual(profile.roles?.helper, ROLES_ALIASES.helper);
    assert.ok(
      Object.values(sources).some((source) => /^found: .*\btypes\b/.test(source)),
      JSON.stringify(sources),
    );
  });
});

test("role aliases nested under entity folders are found", async () => {
  await withProject({ "src/user/services/user.ts": "export {};\n" }, async (directory) => {
    const { profile } = await scan(directory);
    assert.deepEqual(profile.roles?.module, ["services"]);
  });
});

test("sourceRoot picks the first existing of src, app, server, lib", async () => {
  await withProject({ "lib/a.ts": "export {};\n", "server/a.ts": "export {};\n" }, async (directory) => {
    const { profile } = await scan(directory);
    assert.equal(profile.sourceRoot, "server");
  });
  await withProject({ "lib/a.ts": "export {};\n", "app/a.ts": "export {};\n" }, async (directory) => {
    const { profile } = await scan(directory);
    assert.equal(profile.sourceRoot, "app");
  });
});

test("sourceRoot falls back to the project root without any source folder", async () => {
  await withProject({ "index.ts": "export {};\n" }, async (directory) => {
    const { profile } = await scan(directory);
    assert.equal(profile.sourceRoot, ".");
  });
});

test("five spec files under test/ give testsLocation test and testSuffix spec", async () => {
  await withProject({ "src/main.ts": "export {};\n", ...numberedFiles("test/case", ".spec.ts", 5) }, async (directory) => {
    const { profile, sources } = await scan(directory);
    assert.equal(profile.testsLocation, "test");
    assert.equal(profile.testSuffix, "spec");
    assert.equal(sources.testsLocation, "dominant 100% (5/5)");
    assert.equal(sources.testSuffix, "dominant 100% (5/5)");
  });
});

test("tests split below the dominance share keep the default suffix", async () => {
  await withProject(
    {
      "src/main.ts": "export {};\n",
      ...numberedFiles("tests/spec", ".spec.ts", 5),
      ...numberedFiles("tests/check", ".test.ts", 5),
    },
    async (directory) => {
      const { profile, sources } = await scan(directory);
      assert.equal(profile.testsLocation, "tests");
      assert.equal(profile.testSuffix, CONFIG_DEFAULTS.testSuffix);
      assert.equal(sources.testSuffix, "default");
    },
  );
});

test("fewer than five cases keep the defaults with source default", async () => {
  await withProject(
    {
      "src/types/a.ts": "export interface Thing { name: string }\n",
      "src/constants/a.ts": camelConstants(4),
      ...numberedFiles("test/case", ".spec.ts", 4),
    },
    async (directory) => {
      const { profile, sources } = await scan(directory);
      assert.equal(profile.constantCase, CONFIG_DEFAULTS.constantCase);
      assert.equal(sources.constantCase, "default");
      assert.equal(profile.testsLocation, CONFIG_DEFAULTS.testsLocation);
      assert.equal(sources.testsLocation, "default");
      assert.equal(profile.testSuffix, CONFIG_DEFAULTS.testSuffix);
      assert.equal(sources.testSuffix, "default");
    },
  );
});

test("five IThing interfaces give interfacePrefix I", async () => {
  const interfaces = Array.from({ length: 5 }, (_, position) => `export interface IThing${position} { name: string }\n`).join("");
  await withProject({ "src/types/thing.ts": interfaces, "src/constants/a.ts": upperConstants(1) }, async (directory) => {
    const { profile, sources } = await scan(directory);
    assert.equal(profile.interfacePrefix, "I");
    assert.equal(sources.interfacePrefix, "dominant 100% (5/5)");
  });
});

test("interfaces without the I prefix keep an empty interfacePrefix", async () => {
  const interfaces = Array.from({ length: 5 }, (_, position) => `export interface Thing${position} { name: string }\n`).join("");
  await withProject({ "src/types/thing.ts": interfaces, "src/constants/a.ts": upperConstants(1) }, async (directory) => {
    const { profile } = await scan(directory);
    assert.equal(profile.interfacePrefix, "");
  });
});

test("a field the user wrote without a sources entry is never overwritten", async () => {
  await withProject(
    {
      "src/types/a.ts": "export interface Thing { name: string }\n",
      "src/constants/a.ts": upperConstants(5),
    },
    async (directory) => {
      const { profile } = await scan(directory, { constantCase: "camel" });
      assert.ok(profile.constantCase === undefined || profile.constantCase === "camel", String(profile.constantCase));
    },
  );
});

test("a field with a sources entry is rescanned", async () => {
  await withProject(
    {
      "src/types/a.ts": "export interface Thing { name: string }\n",
      "src/constants/a.ts": upperConstants(5),
    },
    async (directory) => {
      const { profile, sources } = await scan(directory, {
        constantCase: "camel",
        sources: { constantCase: "default" },
      });
      assert.equal(profile.constantCase, "upper-snake");
      assert.equal(sources.constantCase, "dominant 100% (5/5)");
    },
  );
});

test("ESLint max-params, max-depth and prefer-destructuring map into rules", async () => {
  await withProject({ "src/modules/user.ts": "export {};\n" }, async (directory) => {
    writeFakeEslint(
      directory,
      printConfigScript({ "max-params": ["error", 3], "max-depth": ["warn", 2], "prefer-destructuring": "off" }),
    );
    const { profile, sources, warnings } = await scan(directory);
    assert.deepEqual(profile.rules?.["max-params"], { max: 3 });
    const nesting = profile.rules?.["max-nesting"];
    assert.equal(typeof nesting === "object" ? nesting.max : nesting, 2);
    assert.equal(profile.rules?.["prefer-destructuring"], "off");
    assert.ok(Object.values(sources).includes("eslint --print-config"), JSON.stringify(sources));
    assert.deepEqual(warnings, []);
    const received = readFileSync(join(directory, "node_modules", ".bin", "received"), "utf8").trim().split("\n");
    assert.equal(received[0], "--print-config");
    assert.ok(received[1]?.endsWith("src/modules/user.ts"), received.join(" "));
  });
});

test("ESLint max-params severity off or 0 maps to off", async () => {
  for (const setting of ["off", 0, ["off", 4], [0, 4]]) {
    await withProject({ "src/modules/user.ts": "export {};\n" }, async (directory) => {
      writeFakeEslint(directory, printConfigScript({ "max-params": setting }));
      const { profile } = await scan(directory);
      assert.equal(profile.rules?.["max-params"], "off", JSON.stringify(setting));
    });
  }
});

test("ESLint naming-convention UPPER_CASE variables give upper-snake", async () => {
  await withProject({ "src/modules/user.ts": "export {};\n" }, async (directory) => {
    writeFakeEslint(
      directory,
      printConfigScript({
        "@typescript-eslint/naming-convention": [
          "error",
          { selector: "variable", modifiers: ["const", "global"], format: ["UPPER_CASE"] },
        ],
      }),
    );
    const { profile, sources } = await scan(directory);
    assert.equal(profile.constantCase, "upper-snake");
    assert.equal(sources.constantCase, "eslint --print-config");
  });
});

test("ESLint naming-convention camelCase variables and I interface prefix map", async () => {
  await withProject({ "src/modules/user.ts": "export {};\n" }, async (directory) => {
    writeFakeEslint(
      directory,
      printConfigScript({
        "@typescript-eslint/naming-convention": [
          "error",
          { selector: "variable", modifiers: ["const", "global"], format: ["camelCase"] },
          { selector: "interface", format: ["PascalCase"], prefix: ["I"] },
        ],
      }),
    );
    const { profile, sources } = await scan(directory);
    assert.equal(profile.constantCase, "camel");
    assert.equal(profile.interfacePrefix, "I");
    assert.equal(sources.constantCase, "eslint --print-config");
    assert.equal(sources.interfacePrefix, "eslint --print-config");
  });
});

test("a failing ESLint gives a warning with its first stderr line and the profile is still produced", async () => {
  await withProject(
    {
      "src/types/a.ts": "export interface Thing { name: string }\n",
      "src/constants/a.ts": upperConstants(5),
    },
    async (directory) => {
      writeFakeEslint(directory, "echo 'Oops: config broken' >&2\necho 'second line' >&2\nexit 2");
      const { profile, sources, warnings } = await scan(directory);
      assert.deepEqual(warnings, ["warning conventions eslint: Oops: config broken"]);
      assert.equal(profile.sourceRoot, "src");
      assert.deepEqual(profile.roles?.interfaces, ["types"]);
      assert.equal(profile.constantCase, "upper-snake");
      assert.equal(sources.constantCase, "dominant 100% (5/5)");
    },
  );
});

test("Biome useMaxParams max maps into rules when no ESLint exists", async () => {
  await withProject(
    {
      "src/modules/user.ts": "export {};\n",
      "biome.json": JSON.stringify({
        linter: { rules: { complexity: { useMaxParams: { level: "error", options: { max: 4 } } } } },
      }),
    },
    async (directory) => {
      const { profile } = await scan(directory);
      const setting = profile.rules?.["max-params"];
      assert.equal(typeof setting === "object" ? setting.max : setting, 4);
    },
  );
});

test("formatProfile prints a header and one field line with its source", () => {
  const text = formatProfile(
    { layout: "layered", sourceRoot: "src", constantCase: "camel" },
    { layout: "detectLayout", sourceRoot: "found: src", constantCase: "dominant 80% (4/5)" },
  );
  const lines = text.split("\n");
  assert.equal(lines[0], "codemaster profile:");
  assert.ok(lines.includes('  layout = "layered"  (detectLayout)'), text);
  assert.ok(lines.includes('  sourceRoot = "src"  (found: src)'), text);
  assert.ok(lines.includes('  constantCase = "camel"  (dominant 80% (4/5))'), text);
});

test("writeProfile writes two-space JSON with a trailing newline", async () => {
  await withProject({}, (directory) => {
    const merged = { sourceRoot: "src", constantCase: "camel", sources: { constantCase: "dominant 100% (5/5)" } };
    writeProfile(directory, merged);
    assert.equal(readFileSync(join(directory, CONFIG_FILE_NAME), "utf8"), `${JSON.stringify(merged, null, 2)}\n`);
  });
});

test("colocated tests next to modules give testsLocation colocated", async () => {
  const modules = Object.fromEntries(
    Array.from({ length: 6 }, (_, position) => [
      [`src/modules/thing${position}.ts`, "export {};\n"],
      [`src/modules/thing${position}.test.ts`, "export {};\n"],
    ]).flat(),
  );
  await withProject({ "src/types/a.ts": "export interface Thing { name: string }\n", ...modules }, async (directory) => {
    const { profile, sources } = await scan(directory);
    assert.equal(profile.testsLocation, "colocated");
    assert.match(sources.testsLocation, /^dominant/);
  });
});

test("runCommand leaves an invalid .codemaster.json untouched and returns 1", async () => {
  const invalid = "{ not json";
  await withProject(
    { "src/constants/a.ts": upperConstants(5), "src/types/a.ts": "export interface Thing { name: string }\n", [CONFIG_FILE_NAME]: invalid },
    async (directory) => {
      const written: string[] = [];
      const originalStderr = process.stderr.write;
      const originalStdout = process.stdout.write;
      process.stderr.write = ((chunk: string | Uint8Array) => written.push(String(chunk)) > 0) as typeof process.stderr.write;
      process.stdout.write = (() => true) as typeof process.stdout.write;
      let status: number;
      try {
        status = await runCommand({
          argumentsList: ["--refresh"],
          projectRoot: directory,
          config: structuredClone(CONFIG_DEFAULTS),
          configWarnings: [],
          input: "",
          pluginRoot: process.cwd(),
        });
      } finally {
        process.stderr.write = originalStderr;
        process.stdout.write = originalStdout;
      }
      assert.equal(status, 1);
      assert.equal(readFileSync(join(directory, CONFIG_FILE_NAME), "utf8"), invalid);
      assert.ok(
        written.join("").split("\n").includes("warning config .codemaster.json: invalid JSON; profile not written"),
        written.join(""),
      );
    },
  );
});

test("ESLint naming-convention with formats and a global modifier gives upper-snake", async () => {
  await withProject({ "src/modules/user.ts": "export {};\n" }, async (directory) => {
    writeFakeEslint(
      directory,
      printConfigScript({
        "@typescript-eslint/naming-convention": ["error", { selector: ["variable"], modifiers: "global", formats: ["CONSTANT_CASE"] }],
      }),
    );
    const { profile, sources } = await scan(directory);
    assert.equal(profile.constantCase, "upper-snake");
    assert.equal(sources.constantCase, "eslint --print-config");
  });
});

test("ESLint naming-conventions without one format, a const modifier or an I prefix map nothing", async () => {
  const conventions = [
    { selector: "variable", modifiers: ["const"], format: ["camelCase", "UPPER_CASE"] },
    { selector: "variable", format: ["camelCase"] },
    { selector: "variable", modifiers: ["const"] },
    { selector: "variable", modifiers: ["const"], format: ["PascalCase"] },
    { selector: "interface", format: ["PascalCase"] },
    { selector: "interface", prefix: ["T"] },
  ];
  for (const convention of conventions) {
    await withProject({ "src/modules/user.ts": "export {};\n" }, async (directory) => {
      writeFakeEslint(directory, printConfigScript({ "@typescript-eslint/naming-convention": ["error", convention] }));
      const { sources } = await scan(directory);
      assert.equal(sources.constantCase, "default", JSON.stringify(convention));
      assert.equal(sources.interfacePrefix, "default", JSON.stringify(convention));
    });
  }
});

test("Biome useNamingConvention CONSTANT_CASE for const maps to upper-snake", async () => {
  await withProject(
    {
      "src/modules/user.ts": "export {};\n",
      "biome.json": JSON.stringify({
        linter: {
          rules: {
            style: {
              useNamingConvention: { options: { conventions: [{ selector: { kind: "const" }, formats: ["CONSTANT_CASE"] }] } },
            },
          },
        },
      }),
    },
    async (directory) => {
      const { profile, sources } = await scan(directory);
      assert.equal(profile.constantCase, "upper-snake");
      assert.equal(sources.constantCase, "biome.json");
    },
  );
});

test("constants in neither upper-snake nor camel case keep the default constantCase", async () => {
  const mixed = Array.from({ length: 5 }, (_, position) => `export const Limit_${position} = ${position};\n`).join("");
  await withProject({ "src/types/a.ts": "export interface Thing { name: string }\n", "src/constants/a.ts": mixed }, async (directory) => {
    const { profile, sources } = await scan(directory);
    assert.equal(profile.constantCase, CONFIG_DEFAULTS.constantCase);
    assert.equal(sources.constantCase, "default");
  });
});

test("a user-owned sourceRoot drives the declaration scan and is left out of the profile", async () => {
  await withProject({ "src/modules/user.ts": "export {};\n", "lib/types/a.ts": "export interface Thing { name: string }\n", "lib/constants/a.ts": camelConstants(5) }, async (directory) => {
    const { profile, sources } = await scan(directory, { sourceRoot: "lib" });
    assert.equal(Object.hasOwn(profile, "sourceRoot"), false);
    assert.equal(profile.constantCase, "camel");
    assert.equal(sources.constantCase, "dominant 100% (5/5)");
  });
});

test("test files in a tests folder without a suffix set the location and keep the default suffix", async () => {
  await withProject({ "src/main.ts": "export {};\n", ...numberedFiles("tests/case", ".ts", 5) }, async (directory) => {
    const { profile, sources } = await scan(directory);
    assert.equal(profile.testsLocation, "tests");
    assert.equal(profile.testSuffix, CONFIG_DEFAULTS.testSuffix);
    assert.equal(sources.testSuffix, "default");
  });
});

test("ESLint reads the first file when every file is a test", async () => {
  await withProject({ "tests/a.test.ts": "export {};\n", "tests/b.test.ts": "export {};\n" }, async (directory) => {
    writeFakeEslint(directory, printConfigScript({}));
    await scan(directory);
    const received = readFileSync(join(directory, "node_modules", ".bin", "received"), "utf8").trim().split("\n");
    assert.ok(received[1]?.endsWith("tests/a.test.ts"), received.join(" "));
  });
});

test("inside a repository the ignored files are left out of the scan", async () => {
  await withProject(
    {
      ".gitignore": "src/constants/generated.ts\n",
      "src/types/a.ts": "export interface Thing { name: string }\n",
      "src/constants/a.ts": camelConstants(5),
      "src/constants/generated.ts": upperConstants(20),
    },
    async (directory) => {
      execFileSync("git", ["init", "-q"], { cwd: directory });
      const { profile, sources } = await scan(directory);
      assert.equal(profile.constantCase, "camel");
      assert.equal(sources.constantCase, "dominant 100% (5/5)");
    },
  );
});

test("scanConventions with the linter off never runs the project's eslint", async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "codemaster-conventions-"));
  try {
    mkdirSync(join(projectRoot, "src/modules"), { recursive: true });
    writeFileSync(join(projectRoot, "src/modules/user.ts"), "export function loadUser() { return 1; }\n");
    mkdirSync(join(projectRoot, "node_modules/.bin"), { recursive: true });
    const marker = join(projectRoot, "eslint-ran");
    writeFileSync(join(projectRoot, "node_modules/.bin/eslint"), `#!/bin/sh\ntouch ${marker}\necho '{"rules":{}}'\n`);
    chmodSync(join(projectRoot, "node_modules/.bin/eslint"), 0o755);
    const { warnings } = await scanConventions(projectRoot, { config: structuredClone(CONFIG_DEFAULTS), raw: {}, linter: false });
    assert.equal(existsSync(marker), false);
    assert.ok(warnings.includes("warning conventions eslint: skipped; run conventions --refresh to read it"), warnings.join("\n"));
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
