import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { runDeploymentMigrationGate } from './libexec/deploy/worker.mjs';

const SOURCE_SHA = 'f'.repeat(40);
const REQUEST_ID = '923e4567-e89b-42d3-a456-426614174013';
const RELEASE_ID = `omnilodge-r876-a4-${SOURCE_SHA.slice(0, 12)}`;

const requestState = Object.freeze({
  request: Object.freeze({
    kind: 'forward_submit',
    requestId: REQUEST_ID,
  }),
  intent: Object.freeze({
    operation: 'deploy',
    releaseId: RELEASE_ID,
    sourceSha: SOURCE_SHA,
  }),
  phase: 'backup_verified',
});

const migrationStatus = (pendingMigrationNames = ['20260922090000-apply-change.js']) => Object.freeze({
  schemaVersion: 1,
  kind: 'omnilodge-migration-status',
  ok: true,
  classification: 'managed',
  lineage: 'strict',
  metadataTableExists: true,
  appliedMigrationCount: 189,
  compiledMigrationCount: 189 + pendingMigrationNames.length,
  pendingMigrationCount: pendingMigrationNames.length,
  pendingMigrationNames,
});

const backupGateResult = Object.freeze({
  schemaVersion: 1,
  requestId: REQUEST_ID,
  releaseId: RELEASE_ID,
  sourceSha: SOURCE_SHA,
  backupRequired: true,
  backupReason: 'PENDING_MIGRATIONS',
  pendingMigrationCount: 1,
  pendingMigrationNames: ['20260922090000-apply-change.js'],
  command: {
    path: '/home/postgres/backup.sh',
    timeoutMs: 60 * 60 * 1000,
    stdoutBytes: 12,
    stderrBytes: 0,
  },
  backupRoot: '/home/postgres/backups',
  availableBytesBefore: 6 * 1024 * 1024 * 1024,
  availableBytesAfter: 5 * 1024 * 1024 * 1024,
  selectedBackup: {
    path: '/home/postgres/backups/manual.tar.gz',
    sizeBytes: 1024,
    sha256: '4'.repeat(64),
    mtimeUtc: '2026-09-17T10:00:00.000Z',
  },
  createdBackupCount: 1,
  startedAtUtc: '2026-09-17T10:00:00.000Z',
  completedAtUtc: '2026-09-17T10:01:00.000Z',
});

const testPlan = Object.freeze({
  releaseId: RELEASE_ID,
  sourceSha: SOURCE_SHA,
  releaseRoot: `/opt/omnilodge/releases/${RELEASE_ID}`,
  layout: Object.freeze({
    puppeteerCacheRoot: '/var/cache/omnilodge/puppeteer',
    persistentRoot: '/var/lib/omnilodge',
  }),
});

test('migration gate runs compiled migrations and requires a clean post-migration status', async () => {
  const executed = [];
  const result = await runDeploymentMigrationGate({
    requestState,
    migrationStatus: migrationStatus(),
    backupGateResult,
    now: () => new Date('2026-09-17T10:02:00.000Z'),
    createPlan: () => testPlan,
    migrationExecutor: async (command) => {
      executed.push(command);
      return { exitCode: 0, stdout: 'migrated\n', stderr: '' };
    },
    statusExecutor: async (command) => {
      assert.equal(command.label, 'post-migration-status');
      return {
        exitCode: 0,
        stdout: `${JSON.stringify(migrationStatus([]))}\n`,
        stderr: '',
      };
    },
  });

  assert.equal(executed.length, 1);
  assert.equal(executed[0].label, 'run-migrations');
  assert.deepEqual(executed[0].args, [
    '--env-file=/etc/omnilodge/backend.env',
    '--enable-source-maps',
    'dist/scripts/runMigrations.js',
  ]);
  assert.equal(executed[0].cwd, path.join('/opt/omnilodge/releases', RELEASE_ID, 'be'));
  assert.equal(executed[0].env.APP_RUNTIME_MODE, 'deployment-candidate');
  assert.equal(executed[0].env.SEED_ACCESS_CONTROL, 'false');

  assert.equal(result.migrationRequired, true);
  assert.equal(result.pendingMigrationCountBefore, 1);
  assert.equal(result.command.stdoutBytes, Buffer.byteLength('migrated\n'));
  assert.equal(result.postMigrationStatus.pendingMigrationCount, 0);
});

test('migration gate skips command execution when migrations are already current', async () => {
  const result = await runDeploymentMigrationGate({
    requestState,
    migrationStatus: migrationStatus([]),
    backupGateResult: {
      ...backupGateResult,
      backupRequired: false,
      backupReason: 'NO_PENDING_MIGRATIONS',
      pendingMigrationCount: 0,
      pendingMigrationNames: [],
      command: null,
      backupRoot: null,
      availableBytesBefore: null,
      availableBytesAfter: null,
      selectedBackup: null,
      createdBackupCount: 0,
    },
    migrationExecutor: async () => {
      throw new Error('migration command should not run');
    },
    statusExecutor: async () => {
      throw new Error('post-status command should not run');
    },
    now: () => new Date('2026-09-17T10:02:00.000Z'),
  });

  assert.equal(result.migrationRequired, false);
  assert.equal(result.command, null);
  assert.equal(result.postMigrationStatus.pendingMigrationCount, 0);
});
