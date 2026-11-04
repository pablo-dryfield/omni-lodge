import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

test("the immutable ESM broker loads from an isolated directory with no installed runtime dependencies", async () => {
  const root = fileURLToPath(new URL("..", import.meta.url)),
    directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "omnilodge-broker-bundle-"),
    );
  try {
    const built = spawnSync(process.execPath, ["build.mjs"], {
      cwd: root,
      encoding: "utf8",
      timeout: 20000,
    });
    assert.equal(built.status, 0, built.stderr);
    const file = path.join(directory, "server.mjs");
    await fs.copyFile(path.join(root, "dist/server.mjs"), file);
    const loaded = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `await import(${JSON.stringify(pathToFileURL(file).href)})`,
      ],
      {
        cwd: directory,
        encoding: "utf8",
        timeout: 10000,
        env: { PATH: process.env.PATH, NODE_ENV: "test" },
      },
    );
    assert.equal(loaded.status, 0, loaded.stderr);
    assert.equal(loaded.stdout, "");
  } finally {
    assert.equal(path.dirname(directory), os.tmpdir());
    await fs.rm(directory, { recursive: true, force: true });
  }
});
