import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CONFIG_DEFAULTS } from "../../src/consts/config.ts";
import type { ConfigProject } from "../../src/interfaces/config.ts";
import type { LibraryDiff } from "../../src/interfaces/library.ts";
import { diffLibraries, formatLibraryDiff, rebuildIndex } from "../../src/modules/libraries.ts";

const summaryDirectory = ".claude/skills/codemaster-libraries";

interface ProjectSpec {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  installed?: Record<string, Record<string, string>>;
  readmes?: string[];
  summaries?: Record<string, string>;
}

function writeProjectFile(directory: string, path: string, text: string): void {
  const target = join(directory, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
}

function createProject(spec: ProjectSpec): string {
  const directory = mkdtempSync(join(tmpdir(), "codemaster-libraries-"));
  writeProjectFile(
    directory,
    "package.json",
    JSON.stringify({ dependencies: spec.dependencies ?? {}, devDependencies: spec.devDependencies ?? {} }),
  );
  for (const [name, manifest] of Object.entries(spec.installed ?? {})) {
    writeProjectFile(directory, `node_modules/${name}/package.json`, JSON.stringify({ name, ...manifest }));
  }
  for (const name of spec.readmes ?? []) {
    writeProjectFile(directory, `node_modules/${name}/README.md`, `# ${name}\n`);
  }
  for (const [fileName, text] of Object.entries(spec.summaries ?? {})) {
    writeProjectFile(directory, `${summaryDirectory}/${fileName}`, text);
  }
  return directory;
}

function summaryText(name: string, version: string, purpose = `${name} does things.`): string {
  return `---\nname: ${name}\nversion: ${version}\n---\n\n## Purpose\n${purpose}\n\n## Key APIs\n- call()\n`;
}

function settingsWith(overrides: Partial<ConfigProject>): ConfigProject {
  return { ...CONFIG_DEFAULTS, ...overrides };
}

function runDiff(spec: ProjectSpec, overrides: Partial<ConfigProject> = {}): LibraryDiff {
  const directory = createProject(spec);
  try {
    return diffLibraries({ projectRoot: directory, config: settingsWith(overrides) });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("a scoped package is added by its name", () => {
  const diff = runDiff({
    dependencies: { "@scope/pkg": "^1.0.0" },
    installed: { "@scope/pkg": { version: "1.4.0" } },
  });
  assert.equal(diff.add.length, 1);
  assert.equal(diff.add[0].name, "@scope/pkg");
  assert.equal(diff.add[0].version, "1.4.0");
});

test("scope__pkg.md is recognised as the summary of @scope/pkg", () => {
  const present = runDiff({
    dependencies: { "@scope/pkg": "^1.0.0" },
    installed: { "@scope/pkg": { version: "1.4.0" } },
    summaries: { "scope__pkg.md": summaryText("@scope/pkg", "1.4.0") },
  });
  assert.deepEqual(present.add, []);
  assert.deepEqual(present.remove, []);
  const orphaned = runDiff({ summaries: { "scope__pkg.md": summaryText("@scope/pkg", "1.4.0") } });
  assert.deepEqual(orphaned.remove, ["@scope/pkg"]);
});

test("a summary of a package that is no longer declared is listed for removal", () => {
  const diff = runDiff({
    dependencies: { alpha: "^1.0.0" },
    installed: { alpha: { version: "1.0.0" } },
    summaries: {
      "alpha.md": summaryText("alpha", "1.0.0"),
      "zeta.md": summaryText("zeta", "3.0.0"),
    },
  });
  assert.deepEqual(diff.remove, ["zeta"]);
  assert.deepEqual(diff.add, []);
});

test("add carries the installed version, the readme path and the homepage", () => {
  const diff = runDiff({
    dependencies: { alpha: "^1.0.0", bare: "^1.0.0" },
    installed: {
      alpha: { version: "1.2.0", homepage: "https://alpha.dev" },
      bare: { version: "0.3.0" },
    },
    readmes: ["alpha"],
  });
  assert.deepEqual(diff.add, [
    { name: "alpha", version: "1.2.0", readme: "node_modules/alpha/README.md", homepage: "https://alpha.dev" },
    { name: "bare", version: "0.3.0", readme: null, homepage: null },
  ]);
});

test("@types packages are skipped", () => {
  const diff = runDiff(
    {
      dependencies: { "@types/node": "^20.0.0", alpha: "^1.0.0" },
      devDependencies: { "@types/react": "^18.0.0" },
      installed: {
        "@types/node": { version: "20.1.0" },
        "@types/react": { version: "18.2.0" },
        alpha: { version: "1.0.0" },
      },
    },
    { libraryDigestDev: true },
  );
  assert.deepEqual(diff.add.map((entry) => entry.name), ["alpha"]);
  assert.deepEqual(diff.missing, []);
});

test("devDependencies are read only with libraryDigestDev", () => {
  const spec: ProjectSpec = {
    dependencies: { alpha: "^1.0.0" },
    devDependencies: { gamma: "^1.0.0" },
    installed: { alpha: { version: "1.0.0" }, gamma: { version: "1.0.0" } },
  };
  assert.deepEqual(runDiff(spec).add.map((entry) => entry.name), ["alpha"]);
  assert.deepEqual(runDiff(spec, { libraryDigestDev: false }).add.map((entry) => entry.name), ["alpha"]);
  assert.deepEqual(runDiff(spec, { libraryDigestDev: true }).add.map((entry) => entry.name), ["alpha", "gamma"]);
});

test("a declared package without a node_modules entry is missing", () => {
  const diff = runDiff({
    dependencies: { alpha: "^1.0.0", ghost: "^2.0.0" },
    installed: { alpha: { version: "1.0.0" } },
  });
  assert.deepEqual(diff.missing, ["ghost"]);
  assert.deepEqual(diff.add.map((entry) => entry.name), ["alpha"]);
});

test("a package is stale when the major version differs", () => {
  const diff = runDiff({
    dependencies: { beta: "^2.0.0" },
    installed: { beta: { version: "2.1.0" } },
    summaries: { "beta.md": summaryText("beta", "1.0.0") },
  });
  assert.deepEqual(diff.stale, [{ name: "beta", previous: "1.0.0", current: "2.1.0" }]);
  assert.deepEqual(diff.add, []);
});

test("a minor or patch bump is not stale", () => {
  const diff = runDiff({
    dependencies: { beta: "^1.0.0" },
    installed: { beta: { version: "1.9.0" } },
    summaries: { "beta.md": summaryText("beta", "1.0.0") },
  });
  assert.deepEqual(diff.stale, []);
  assert.deepEqual(diff.add, []);
  assert.deepEqual(diff.remove, []);
});

test("seven additions with a cap of five list five and report two more", () => {
  const names = ["g1", "g2", "g3", "g4", "g5", "g6", "g7"];
  const diff = runDiff(
    {
      dependencies: Object.fromEntries(names.map((name) => [name, "^1.0.0"])),
      installed: Object.fromEntries(names.map((name) => [name, { version: "1.0.0" }])),
    },
    { libraryDigestPerRun: 5 },
  );
  assert.deepEqual(diff.add.map((entry) => entry.name), ["g1", "g2", "g3", "g4", "g5"]);
  assert.equal(diff.more, 2);
});

test("add and stale share the cap in name order", () => {
  const diff = runDiff(
    {
      dependencies: { b: "^1.0.0", d: "^1.0.0", f: "^1.0.0", a: "^2.0.0", c: "^2.0.0", e: "^2.0.0" },
      installed: {
        a: { version: "2.0.0" },
        b: { version: "1.0.0" },
        c: { version: "2.0.0" },
        d: { version: "1.0.0" },
        e: { version: "2.0.0" },
        f: { version: "1.0.0" },
      },
      summaries: {
        "a.md": summaryText("a", "1.0.0"),
        "c.md": summaryText("c", "1.0.0"),
        "e.md": summaryText("e", "1.0.0"),
      },
    },
    { libraryDigestPerRun: 4 },
  );
  assert.deepEqual(diff.stale.map((entry) => entry.name), ["a", "c"]);
  assert.deepEqual(diff.add.map((entry) => entry.name), ["b", "d"]);
  assert.equal(diff.more, 2);
});

test("under the cap more is zero", () => {
  const diff = runDiff({
    dependencies: { alpha: "^1.0.0" },
    installed: { alpha: { version: "1.0.0" } },
  });
  assert.equal(diff.more, 0);
});

test("formatLibraryDiff prints one exact line per change", () => {
  const diff: LibraryDiff = {
    add: [
      { name: "alpha", version: "1.2.0", readme: "node_modules/alpha/README.md", homepage: "https://alpha.dev" },
      { name: "bare", version: "0.3.0", readme: null, homepage: null },
    ],
    remove: ["zeta"],
    stale: [{ name: "beta", previous: "1.0.0", current: "2.1.0" }],
    missing: ["ghost"],
    more: 2,
  };
  assert.deepEqual(formatLibraryDiff(diff), [
    "add alpha 1.2.0 readme=node_modules/alpha/README.md homepage=https://alpha.dev",
    "add bare 0.3.0 readme=- homepage=-",
    "stale beta 1.0.0 -> 2.1.0",
    "remove zeta",
    "missing ghost (not installed)",
    "… and 2 more",
  ]);
});

test("formatLibraryDiff of an empty diff prints nothing", () => {
  assert.deepEqual(formatLibraryDiff({ add: [], remove: [], stale: [], missing: [], more: 0 }), []);
});

test("rebuildIndex writes the skill frontmatter and one line per summary", () => {
  const directory = createProject({
    summaries: {
      "beta.md": summaryText("beta", "1.0.0", "Beta parses things. It also does more."),
      "alpha.md": summaryText("alpha", "1.2.0", "Alpha renders pages."),
      "scope__pkg.md": summaryText("@scope/pkg", "1.4.0", "Scoped helpers for pkg."),
    },
  });
  try {
    rebuildIndex(directory);
    const index = readFileSync(join(directory, summaryDirectory, "SKILL.md"), "utf8");
    const description =
      "Summaries of this project's libraries: key APIs, pitfalls and documentation links. Use before implementing something a dependency may already do.";
    assert.ok(
      index.startsWith(`---\nname: codemaster-libraries\ndescription: ${description}\n---\n`),
      index,
    );
    const lines = index.split("\n");
    assert.ok(lines.includes("- [alpha](alpha.md) — Alpha renders pages."), index);
    assert.ok(lines.includes("- [beta](beta.md) — Beta parses things."), index);
    assert.ok(lines.includes("- [@scope/pkg](scope__pkg.md) — Scoped helpers for pkg."), index);
    assert.equal(lines.filter((line) => line.startsWith("- [")).length, 3);
    assert.doesNotMatch(index, /It also does more/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rebuildIndex does not list SKILL.md itself on a second run", () => {
  const directory = createProject({ summaries: { "alpha.md": summaryText("alpha", "1.2.0", "Alpha renders pages.") } });
  try {
    rebuildIndex(directory);
    rebuildIndex(directory);
    const index = readFileSync(join(directory, summaryDirectory, "SKILL.md"), "utf8");
    assert.equal(index.split("\n").filter((line) => line.startsWith("- [")).length, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
