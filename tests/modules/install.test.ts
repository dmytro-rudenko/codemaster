import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INSTALL_AST_GREP_VERSION } from "../../src/consts/install.ts";
import {
  ensureInstalled,
  isInstalled,
  resolveDataDirectory,
  runCommand,
} from "../../src/modules/install.ts";

const CLEARED_VARIABLES = ["CODEMASTER_DATA_DIR", "XDG_DATA_HOME", "npm_config_registry"];

const FAKE_NPM_WRITES_PACKAGES = [
  'mkdir -p "$3/node_modules/@ast-grep/napi" "$3/node_modules/@ast-grep/cli"',
  `echo '{"version":"${INSTALL_AST_GREP_VERSION}"}' > "$3/node_modules/@ast-grep/napi/package.json"`,
  `echo '{"version":"${INSTALL_AST_GREP_VERSION}"}' > "$3/node_modules/@ast-grep/cli/package.json"`,
].join("\n");

async function withVariables(
  values: Record<string, string>,
  body: () => void | Promise<void>,
): Promise<void> {
  const names = [...new Set([...CLEARED_VARIABLES, ...Object.keys(values)])];
  const saved: Record<string, string | undefined> = {};
  for (const name of names) {
    saved[name] = process.env[name];
  }
  for (const name of CLEARED_VARIABLES) {
    delete process.env[name];
  }
  Object.assign(process.env, values);
  try {
    await body();
  } finally {
    for (const name of names) {
      if (saved[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = saved[name];
      }
    }
  }
}

async function withFakeNpm(
  script: string,
  body: (dataDirectory: string) => void | Promise<void>,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "codemaster-install-"));
  const binDirectory = join(root, "bin");
  const dataDirectory = join(root, "data");
  mkdirSync(binDirectory);
  writeFileSync(join(binDirectory, "npm"), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  try {
    await withVariables(
      { CODEMASTER_DATA_DIR: dataDirectory, PATH: `${binDirectory}:${process.env.PATH}` },
      () => body(dataDirectory),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function withUnwritableDataDirectory(body: () => void | Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "codemaster-install-"));
  chmodSync(root, 0o555);
  try {
    await withVariables({ CODEMASTER_DATA_DIR: join(root, "data") }, body);
  } finally {
    chmodSync(root, 0o755);
    rmSync(root, { recursive: true, force: true });
  }
}

const RUNS_AS_ROOT = process.getuid?.() === 0;

function writeManifest(dataDirectory: string, packageName: string, content: string): void {
  const packageDirectory = join(dataDirectory, "node_modules", packageName);
  mkdirSync(packageDirectory, { recursive: true });
  writeFileSync(join(packageDirectory, "package.json"), content);
}

function writeInstalledPackages(dataDirectory: string): void {
  const content = JSON.stringify({ version: INSTALL_AST_GREP_VERSION });
  writeManifest(dataDirectory, "@ast-grep/napi", content);
  writeManifest(dataDirectory, "@ast-grep/cli", content);
}

async function captureStderr(body: () => Promise<void>): Promise<string[]> {
  const chunks: string[] = [];
  const original = process.stderr.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    await body();
  } finally {
    process.stderr.write = original;
  }
  return chunks;
}

test("resolveDataDirectory prefers CODEMASTER_DATA_DIR over XDG_DATA_HOME", async () => {
  await withVariables(
    { CODEMASTER_DATA_DIR: "/srv/codemaster-data", XDG_DATA_HOME: "/srv/xdg" },
    () => {
      assert.equal(resolveDataDirectory(), "/srv/codemaster-data");
    },
  );
});

test("resolveDataDirectory falls back to XDG_DATA_HOME/codemaster", async () => {
  await withVariables({ XDG_DATA_HOME: "/srv/xdg" }, () => {
    assert.equal(resolveDataDirectory(), join("/srv/xdg", "codemaster"));
  });
});

test("isInstalled is true only when both packages carry the pinned version", async () => {
  const root = mkdtempSync(join(tmpdir(), "codemaster-install-"));
  try {
    await withVariables({ CODEMASTER_DATA_DIR: root }, () => {
      assert.equal(isInstalled(), false);
      writeManifest(root, "@ast-grep/napi", JSON.stringify({ version: INSTALL_AST_GREP_VERSION }));
      assert.equal(isInstalled(), false);
      writeManifest(root, "@ast-grep/cli", JSON.stringify({ version: "0.0.1" }));
      assert.equal(isInstalled(), false);
      writeManifest(root, "@ast-grep/cli", "not json");
      assert.equal(isInstalled(), false);
      writeInstalledPackages(root);
      assert.equal(isInstalled(), true);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ensureInstalled returns ok without a message when already installed", async () => {
  const root = mkdtempSync(join(tmpdir(), "codemaster-install-"));
  try {
    writeInstalledPackages(root);
    await withVariables({ CODEMASTER_DATA_DIR: root }, () => {
      assert.deepEqual(ensureInstalled(), { ok: true, message: null });
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ensureInstalled reports the install when npm provides the packages", async () => {
  await withFakeNpm(FAKE_NPM_WRITES_PACKAGES, (dataDirectory) => {
    assert.deepEqual(ensureInstalled(), {
      ok: true,
      message: `codemaster: installed ast-grep ${INSTALL_AST_GREP_VERSION} into ${dataDirectory}`,
    });
    assert.equal(isInstalled(), true);
  });
});

test("ensureInstalled fails when npm exits 0 but the packages are missing", async () => {
  await withFakeNpm("exit 0", () => {
    const outcome = ensureInstalled();
    assert.equal(outcome.ok, false);
    assert.ok(outcome.message?.startsWith("codemaster: install failed"), `${outcome.message}`);
  });
});

test("ensureInstalled fails when npm exits non-zero even if the packages exist", async () => {
  await withFakeNpm(`${FAKE_NPM_WRITES_PACKAGES}\nexit 1`, () => {
    const outcome = ensureInstalled();
    assert.equal(outcome.ok, false);
    assert.ok(outcome.message?.startsWith("codemaster: install failed"), `${outcome.message}`);
  });
});

test("ensureInstalled quotes the first non-empty stderr line on failure", async () => {
  await withFakeNpm("printf '\\n  \\nnpm exploded\\nsecond line\\n' >&2\nexit 1", () => {
    assert.deepEqual(ensureInstalled(), {
      ok: false,
      message: "codemaster: install failed (npm exploded)",
    });
  });
});

test("ensureInstalled falls back to the exit status when stderr is empty", async () => {
  await withFakeNpm("exit 3", () => {
    assert.deepEqual(ensureInstalled(), {
      ok: false,
      message: "codemaster: install failed (exit 3)",
    });
  });
});

test("ensureInstalled quotes the spawn error when npm is not on the PATH", async () => {
  const root = mkdtempSync(join(tmpdir(), "codemaster-install-"));
  try {
    await withVariables({ CODEMASTER_DATA_DIR: join(root, "data"), PATH: join(root, "empty") }, () => {
      assert.deepEqual(ensureInstalled(), { ok: false, message: "codemaster: install failed (spawnSync npm ENOENT)" });
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ensureInstalled reports a failed install when the registry is unreachable", async () => {
  const dataDirectory = mkdtempSync(join(tmpdir(), "codemaster-install-"));
  try {
    await withVariables(
      { CODEMASTER_DATA_DIR: dataDirectory, npm_config_registry: "http://127.0.0.1:9" },
      () => {
        const outcome = ensureInstalled();
        assert.equal(outcome.ok, false);
        assert.ok(
          outcome.message?.startsWith("codemaster: install failed"),
          `unexpected message: ${outcome.message}`,
        );
      },
    );
  } finally {
    rmSync(dataDirectory, { recursive: true, force: true });
  }
});

test("runCommand prints the install message to stderr and resolves to 0", async () => {
  await withFakeNpm("printf 'npm exploded\\n' >&2\nexit 1", async () => {
    let exitCode = -1;
    const written = await captureStderr(async () => {
      exitCode = await runCommand();
    });
    assert.equal(exitCode, 0);
    assert.deepEqual(written, ["codemaster: install failed (npm exploded)\n"]);
  });
});

test("runCommand prints nothing and resolves to 0 when already installed", async () => {
  const root = mkdtempSync(join(tmpdir(), "codemaster-install-"));
  try {
    writeInstalledPackages(root);
    await withVariables({ CODEMASTER_DATA_DIR: root }, async () => {
      let exitCode = -1;
      const written = await captureStderr(async () => {
        exitCode = await runCommand();
      });
      assert.equal(exitCode, 0);
      assert.deepEqual(written, []);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test(
  "ensureInstalled reports a failed install when the data directory cannot be created",
  { skip: RUNS_AS_ROOT },
  async () => {
    await withUnwritableDataDirectory(() => {
      const outcome = ensureInstalled();
      assert.equal(outcome.ok, false);
      assert.ok(
        outcome.message?.startsWith("codemaster: install failed ("),
        `unexpected message: ${outcome.message}`,
      );
    });
  },
);

test(
  "runCommand resolves to 0 when the data directory cannot be created",
  { skip: RUNS_AS_ROOT },
  async () => {
    await withUnwritableDataDirectory(async () => {
      let exitCode = -1;
      const written = await captureStderr(async () => {
        exitCode = await runCommand();
      });
      assert.equal(exitCode, 0);
      assert.equal(written.length, 1);
      assert.ok(
        written[0]?.startsWith("codemaster: install failed ("),
        `unexpected stderr: ${written[0]}`,
      );
    });
  },
);
