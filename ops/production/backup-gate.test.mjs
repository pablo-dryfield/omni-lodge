import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  parseProductionBackupGateResult,
  runProductionBackupGate,
  serializeProductionBackupGateResult,
} from './libexec/deploy/backup-gate.mjs';

const SOURCE_SHA = 'e'.repeat(40);
const REQUEST_ID = '823e4567-e89b-42d3-a456-426614174012';
const RELEASE_ID = `omnilodge-r765-a3-${SOURCE_SHA.slice(0, 12)}`;

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
  phase: 'preflight_passed',
});

const migrationStatus = (pendingMigrationNames = ['20260922090000-add-example-column.js']) => Object.freeze({
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

const nativePathApi = path;

const makeTempFixture = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omnilodge-backup-gate-'));
  const backupRoot = path.join(root, 'backups');
  const commandPath = path.join(root, process.platform === 'win32' ? 'backup.cmd' : 'backup.sh');
  await fs.mkdir(backupRoot);
  await fs.writeFile(commandPath, process.platform === 'win32' ? '@echo off\r\n' : '#!/bin/sh\n');
  await fs.chmod(commandPath, 0o700).catch(() => undefined);
  return { root, backupRoot, commandPath };
};

const removeTempFixture = async (root) => {
  await fs.rm(root, { recursive: true, force: true });
};

const permissiveTestSecurity = Object.freeze({
  enforceOwnership: false,
  enforceNoGroupWorldWrite: false,
  enforcePrivateBackupFileMode: false,
  enforceCommandExecutable: false,
  minimumAvailableBytes: 0,
  freshnessToleranceMs: 60 * 1000,
  pathApi: nativePathApi,
});

test('production backup gate records a fresh non-empty checksummed backup', async () => {
  const fixture = await makeTempFixture();
  try {
    let commandRan = false;
    const payload = Buffer.from('fresh backup archive bytes\n');
    const backupPath = path.join(fixture.backupRoot, 'backup-20260917.tar.gz');
    const result = await runProductionBackupGate({
      requestState,
      migrationStatus: migrationStatus(),
      backupCommandPath: fixture.commandPath,
      backupRoot: fixture.backupRoot,
      ...permissiveTestSecurity,
      clock: () => new Date(commandRan ? '2026-09-17T10:01:00.000Z' : '2026-09-17T10:00:00.000Z'),
      execFileImpl: async (commandPath, args, options) => {
        assert.equal(commandPath, fixture.commandPath);
        assert.deepEqual(args, []);
        assert.equal(options.windowsHide, true);
        commandRan = true;
        await fs.writeFile(backupPath, payload, { mode: 0o600 });
        await fs.utimes(backupPath, new Date('2026-09-17T10:00:30.000Z'), new Date('2026-09-17T10:00:30.000Z'));
        return { stdout: Buffer.from('backup complete\n'), stderr: Buffer.alloc(0) };
      },
    });

    assert.equal(result.requestId, REQUEST_ID);
    assert.equal(result.releaseId, RELEASE_ID);
    assert.equal(result.backupRequired, true);
    assert.equal(result.backupReason, 'PENDING_MIGRATIONS');
    assert.equal(result.pendingMigrationCount, 1);
    assert.deepEqual(result.pendingMigrationNames, ['20260922090000-add-example-column.js']);
    assert.equal(result.command.path, fixture.commandPath);
    assert.equal(result.command.stdoutBytes, Buffer.byteLength('backup complete\n'));
    assert.equal(result.selectedBackup.path, backupPath);
    assert.equal(result.selectedBackup.sizeBytes, payload.length);
    assert.equal(result.selectedBackup.sha256, createHash('sha256').update(payload).digest('hex'));
    assert.equal(result.createdBackupCount, 1);

    const serialized = serializeProductionBackupGateResult(result);
    assert.deepEqual(parseProductionBackupGateResult(serialized), result);
  } finally {
    await removeTempFixture(fixture.root);
  }
});

test('production backup gate skips the backup when no migrations are pending', async () => {
  const result = await runProductionBackupGate({
    requestState,
    migrationStatus: migrationStatus([]),
    ...permissiveTestSecurity,
    clock: () => new Date('2026-09-17T10:00:00.000Z'),
    execFileImpl: async () => {
      throw new Error('backup command should not run');
    },
  });

  assert.equal(result.backupRequired, false);
  assert.equal(result.backupReason, 'NO_PENDING_MIGRATIONS');
  assert.equal(result.pendingMigrationCount, 0);
  assert.deepEqual(result.pendingMigrationNames, []);
  assert.equal(result.command, null);
  assert.equal(result.backupRoot, null);
  assert.equal(result.selectedBackup, null);
  assert.equal(result.createdBackupCount, 0);

  const serialized = serializeProductionBackupGateResult(result);
  assert.deepEqual(parseProductionBackupGateResult(serialized), result);
});

test('production backup gate rejects commands that do not create a new backup', async () => {
  const fixture = await makeTempFixture();
  try {
    await assert.rejects(
      runProductionBackupGate({
        requestState,
        migrationStatus: migrationStatus(),
        backupCommandPath: fixture.commandPath,
        backupRoot: fixture.backupRoot,
        ...permissiveTestSecurity,
        execFileImpl: async () => ({ stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }),
      }),
      /did not create a fresh backup file/,
    );
  } finally {
    await removeTempFixture(fixture.root);
  }
});
