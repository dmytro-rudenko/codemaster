import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CONFIG_DEFAULTS } from "../../src/consts/config.ts";
import type { CommandContext } from "../../src/interfaces/command.ts";
import type { ConfigProject } from "../../src/interfaces/config.ts";
import type { LibraryDiff } from "../../src/interfaces/library.ts";
import { diffLibraries, formatLibraryDiff, rebuildIndex, runCommand } from "../../src/modules/libraries.ts";

const summaryDirectory = ".claude/skills/codemaster-libraries";

interface ProjectSpec {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  installed?: Record<string, Record<string, string>>;
  readmes?: string[];
  files?: Record<string, string>;
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
  for (const [path, text] of Object.entries(spec.files ?? {})) {
    writeProjectFile(directory, path, text);
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

test("rebuildIndex takes the purpose's first sentence and handles missing, empty and unterminated purposes", () => {
  const frontmatter = (name: string) => `---\nname: ${name}\nversion: 1.0.0\n---\n\n`;
  const directory = createProject({
    summaries: {
      "alpha.md": summaryText("alpha", "1.0.0", "Alpha\n  renders   pages.\nIt also does more."),
      "beta.md": summaryText("beta", "1.0.0", "Beta renders pages"),
      "delta.md": `${frontmatter("delta")}## Purpose\n## Key APIs\n- call()\n`,
      "epsilon.md": summaryText("epsilon", "1.0.0", ""),
      "gamma.md": `${frontmatter("gamma")}## Key APIs\n- call()\n`,
      "kappa.md": `${frontmatter("kappa")}## Key APIs\n- call()\n\n## Purpose \t\nKappa is last! Really.`,
      "zeta.md": "## Purpose\nZeta uses e.g. caching. More.\n",
    },
  });
  try {
    rebuildIndex(directory);
    const rows = readIndex(directory).split("\n").filter((line) => line.startsWith("- ["));
    assert.deepEqual(rows, [
      "- [alpha](alpha.md) — Alpha renders pages.",
      "- [beta](beta.md) — Beta renders pages",
      "- [delta](delta.md) — ## Key APIs - call()",
      "- [epsilon](epsilon.md)",
      "- [gamma](gamma.md)",
      "- [kappa](kappa.md) — Kappa is last!",
      "- [zeta](zeta.md) — Zeta uses e.g.",
    ]);
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

function createContext(directory: string, argumentsList: string[], overrides: Partial<ConfigProject> = {}): CommandContext {
  return {
    argumentsList,
    projectRoot: directory,
    config: settingsWith(overrides),
    configWarnings: [],
    input: "",
    pluginRoot: directory,
  };
}

async function runCaptured(context: CommandContext): Promise<{ status: number; stdout: string; stderr: string }> {
  const writeOut = process.stdout.write;
  const writeErr = process.stderr.write;
  let stdout = "";
  let stderr = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += String(chunk);
    return true;
  }) as typeof process.stderr.write;
  try {
    const status = await runCommand(context);
    return { status, stdout, stderr };
  } finally {
    process.stdout.write = writeOut;
    process.stderr.write = writeErr;
  }
}

function createPruneProject(): string {
  return createProject({
    dependencies: { beta: "^2.0.0" },
    installed: { beta: { version: "2.1.0" } },
    summaries: {
      "beta.md": summaryText("beta", "1.0.0", "Beta parses things."),
      "zeta.md": summaryText("zeta", "3.0.0", "Zeta is gone."),
    },
  });
}

function readIndex(directory: string): string {
  return readFileSync(join(directory, summaryDirectory, "SKILL.md"), "utf8");
}

function refusesToWrite(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("refusing to write");
}

test("runCommand --prune deletes the remove files and rebuilds the index", async () => {
  const directory = createPruneProject();
  try {
    const result = await runCaptured(createContext(directory, ["--prune"]));
    assert.equal(result.status, 0);
    assert.equal(existsSync(join(directory, summaryDirectory, "zeta.md")), false);
    assert.equal(existsSync(join(directory, summaryDirectory, "beta.md")), true);
    assert.match(readIndex(directory), /\[beta\]\(beta\.md\)/);
    assert.doesNotMatch(readIndex(directory), /zeta/);
    const lines = result.stdout.split("\n");
    assert.ok(lines.includes("remove zeta"), result.stdout);
    assert.ok(lines.includes("stale beta 1.0.0 -> 2.1.0"), result.stdout);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("runCommand --index only rebuilds the index", async () => {
  const directory = createPruneProject();
  try {
    const result = await runCaptured(createContext(directory, ["--index"]));
    assert.equal(result.status, 0);
    assert.equal(existsSync(join(directory, summaryDirectory, "zeta.md")), true);
    assert.match(readIndex(directory), /\[beta\]\(beta\.md\)/);
    assert.match(readIndex(directory), /\[zeta\]\(zeta\.md\)/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("runCommand --prune --index does both", async () => {
  const directory = createPruneProject();
  try {
    const result = await runCaptured(createContext(directory, ["--prune", "--index"]));
    assert.equal(result.status, 0);
    assert.equal(existsSync(join(directory, summaryDirectory, "zeta.md")), false);
    assert.match(readIndex(directory), /\[beta\]\(beta\.md\)/);
    assert.doesNotMatch(readIndex(directory), /zeta/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("runCommand with libraryDigest false prints disabled and touches nothing", async () => {
  const directory = createPruneProject();
  try {
    const result = await runCaptured(createContext(directory, ["--prune", "--index"], { libraryDigest: false }));
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), "libraries: disabled");
    assert.equal(existsSync(join(directory, summaryDirectory, "zeta.md")), true);
    assert.equal(existsSync(join(directory, summaryDirectory, "SKILL.md")), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rebuildIndex refuses a symlinked skill directory and leaves the target untouched", () => {
  const directory = createProject({});
  const outside = mkdtempSync(join(tmpdir(), "codemaster-outside-"));
  try {
    mkdirSync(join(directory, ".claude/skills"), { recursive: true });
    symlinkSync(outside, join(directory, summaryDirectory));
    assert.throws(() => rebuildIndex(directory), refusesToWrite);
    assert.equal(existsSync(join(outside, "SKILL.md")), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("rebuildIndex refuses a symlinked SKILL.md and leaves the target untouched", () => {
  const directory = createProject({ summaries: { "alpha.md": summaryText("alpha", "1.0.0") } });
  const outside = mkdtempSync(join(tmpdir(), "codemaster-outside-"));
  const target = join(outside, "target.md");
  try {
    writeFileSync(target, "keep");
    symlinkSync(target, join(directory, summaryDirectory, "SKILL.md"));
    assert.throws(() => rebuildIndex(directory), refusesToWrite);
    assert.equal(readFileSync(target, "utf8"), "keep");
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("rebuildIndex refuses a path whose real location is outside the project", () => {
  const directory = createProject({});
  const outside = mkdtempSync(join(tmpdir(), "codemaster-outside-"));
  try {
    mkdirSync(join(outside, "skills/codemaster-libraries"), { recursive: true });
    symlinkSync(outside, join(directory, ".claude"));
    assert.throws(() => rebuildIndex(directory), refusesToWrite);
    assert.equal(existsSync(join(outside, "skills/codemaster-libraries/SKILL.md")), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("runCommand reports a refused write on stderr, returns 0 and prunes nothing outside", async () => {
  const directory = createProject({});
  const outside = mkdtempSync(join(tmpdir(), "codemaster-outside-"));
  try {
    writeFileSync(join(outside, "zeta.md"), summaryText("zeta", "3.0.0"));
    mkdirSync(join(directory, ".claude/skills"), { recursive: true });
    symlinkSync(outside, join(directory, summaryDirectory));
    const result = await runCaptured(createContext(directory, ["--prune", "--index"]));
    assert.equal(result.status, 0);
    assert.ok(result.stderr.startsWith("codemaster: refusing to write"), result.stderr);
    assert.equal(existsSync(join(outside, "zeta.md")), true);
    assert.equal(existsSync(join(outside, "SKILL.md")), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("a declared name outside npm's grammar is never read and is missing", () => {
  const manifest = JSON.stringify({ version: "9.9.9" });
  const diff = runDiff({
    dependencies: { "../outside": "1.0.0", "a/b/c": "1.0.0", "@x/../y": "1.0.0", alpha: "^1.0.0" },
    installed: { alpha: { version: "1.0.0" } },
    files: {
      "outside/package.json": manifest,
      "node_modules/a/b/c/package.json": manifest,
      "node_modules/y/package.json": manifest,
    },
  });
  assert.deepEqual(diff.add.map((entry) => entry.name), ["alpha"]);
  assert.deepEqual(diff.missing.toSorted(), ["../outside", "@x/../y", "a/b/c"].toSorted());
  assert.ok(formatLibraryDiff(diff).includes("missing ../outside (not installed)"));
});

test("the first existing readme spelling is reported", () => {
  const names = ["a-upper", "b-lower", "c-mixed", "d-bare", "e-both", "f-none", "g-all"];
  const diff = runDiff(
    {
      dependencies: Object.fromEntries(names.map((name) => [name, "^1.0.0"])),
      installed: Object.fromEntries(names.map((name) => [name, { version: "1.0.0" }])),
      files: {
        "node_modules/a-upper/README.md": "",
        "node_modules/b-lower/readme.md": "",
        "node_modules/c-mixed/Readme.md": "",
        "node_modules/d-bare/README": "",
        "node_modules/e-both/README": "",
        "node_modules/e-both/readme.md": "",
        "node_modules/g-all/README": "",
        "node_modules/g-all/Readme.md": "",
        "node_modules/g-all/readme.md": "",
        "node_modules/g-all/README.md": "",
      },
    },
    { libraryDigestPerRun: 10 },
  );
  assert.deepEqual(Object.fromEntries(diff.add.map((entry) => [entry.name, entry.readme])), {
    "a-upper": "node_modules/a-upper/README.md",
    "b-lower": "node_modules/b-lower/readme.md",
    "c-mixed": "node_modules/c-mixed/Readme.md",
    "d-bare": "node_modules/d-bare/README",
    "e-both": "node_modules/e-both/readme.md",
    "f-none": null,
    "g-all": "node_modules/g-all/README.md",
  });
});

test("mixed-case package names are listed and traversal names stay missing", () => {
  const manifest = JSON.stringify({ version: "9.9.9" });
  const diff = runDiff({
    dependencies: { JSONStream: "^1.3.0", Base64: "^1.0.0", "../Outside": "1.0.0", "@X/../Y": "1.0.0" },
    installed: { JSONStream: { version: "1.3.5" }, Base64: { version: "1.0.1" } },
    files: { "Outside/package.json": manifest, "node_modules/Y/package.json": manifest },
  });
  assert.deepEqual(diff.add.map((entry) => `${entry.name} ${entry.version}`), ["Base64 1.0.1", "JSONStream 1.3.5"]);
  assert.deepEqual(diff.missing.toSorted(), ["../Outside", "@X/../Y"].toSorted());
});

test("a summary without frontmatter name maps scope__pkg.md back to @scope/pkg", () => {
  const diff = runDiff({ summaries: { "scope__pkg.md": "## Purpose\nScoped helpers.\n" } });
  assert.deepEqual(diff.remove, ["@scope/pkg"]);
});

test("prune deletes the summary of a removed package but not a declared one that shares its frontmatter name", async () => {
  const directory = createProject({
    dependencies: { alpha: "^1.0.0" },
    installed: { alpha: { version: "1.0.0" } },
    summaries: {
      "alpha.md": summaryText("zeta", "1.0.0"),
      "zeta.md": summaryText("zeta", "3.0.0"),
    },
  });
  try {
    const result = await runCaptured(createContext(directory, ["--prune"]));
    assert.equal(result.status, 0);
    assert.equal(existsSync(join(directory, summaryDirectory, "alpha.md")), true);
    assert.equal(existsSync(join(directory, summaryDirectory, "zeta.md")), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("prune deletes an orphaned file whose frontmatter name matches a declared package", async () => {
  const directory = createProject({
    dependencies: { alpha: "^1.0.0" },
    installed: { alpha: { version: "1.0.0" } },
    summaries: {
      "alpha.md": summaryText("alpha", "1.0.0"),
      "old.md": summaryText("alpha", "1.0.0"),
    },
  });
  try {
    const result = await runCaptured(createContext(directory, ["--prune"]));
    assert.equal(result.status, 0);
    assert.equal(existsSync(join(directory, summaryDirectory, "alpha.md")), true);
    assert.equal(existsSync(join(directory, summaryDirectory, "old.md")), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a summary with CRLF line endings keeps its frontmatter", () => {
  const summaries = { "beta.md": summaryText("beta", "1.2.0").replaceAll("\n", "\r\n") };
  const same = runDiff({ dependencies: { beta: "^1.0.0" }, installed: { beta: { version: "1.2.0" } }, summaries });
  assert.deepEqual(same.stale, []);
  assert.deepEqual(same.add, []);
  assert.deepEqual(same.remove, []);
  const newer = runDiff({ dependencies: { beta: "^2.0.0" }, installed: { beta: { version: "2.0.0" } }, summaries });
  assert.deepEqual(newer.stale, [{ name: "beta", previous: "1.2.0", current: "2.0.0" }]);
});
