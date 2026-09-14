import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

test('server exits nonzero before listening when the configured UI artifact is invalid', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omnilodge-ui-startup-'));
  const invalidBuild = path.join(temporaryRoot, 'invalid-build');
  fs.mkdirSync(invalidBuild);
  try {
    const result = spawnSync(process.execPath, [path.join(moduleDirectory, 'server.js')], {
      cwd: temporaryRoot,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        UI_BUILD_PATH: invalidBuild,
        UI_SERVER_PORT: '49152',
        UI_SERVER_TELEMETRY_SPOOL_PATH: path.join(temporaryRoot, 'telemetry.json'),
        ERROR_MONITORING_SOURCE_MAP_DIR: path.join(temporaryRoot, 'source-maps'),
      },
      encoding: 'utf8',
      timeout: 10_000,
    });

    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /UI artifact validation failed/);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /Server is running/);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
