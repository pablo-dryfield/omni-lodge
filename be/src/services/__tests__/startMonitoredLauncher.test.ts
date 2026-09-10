import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const launcherPath = path.resolve(process.cwd(), 'scripts', 'startMonitored.js');

const captureBootstrapRelease = (release: string): unknown => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'omnilodge-start-monitored-'));
  const spoolPath = path.join(directory, 'failed-events.ndjson');

  try {
    const result = spawnSync(
      process.execPath,
      [launcherPath, 'dist/nonexistent-monitoring-test.js'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          APP_VERSION: release,
          GIT_COMMIT_SHA: '',
          ERROR_MONITORING_SPOOL_PATH: spoolPath,
        },
      },
    );

    expect(result.status).toBe(1);
    const envelope = JSON.parse(readFileSync(spoolPath, 'utf8').trim()) as {
      event: { release?: unknown };
    };
    return envelope.event.release;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

describe('startMonitored release sanitization', () => {
  it('preserves an ISO-dated deployment release in the bootstrap spool', () => {
    const release = 'omnilodge-2026-09-10-error-monitoring-r1.5';
    expect(captureBootstrapRelease(release)).toBe(release);
  });

  it.each([
    'release with arbitrary free text',
    'eyJabcdefghijk.abcdefghijk.abcdefghijk',
  ])('rejects an unsafe bootstrap release value: %s', (release) => {
    expect(captureBootstrapRelease(release)).toBeNull();
  });
});
