import crypto from 'node:crypto';
import { workspaceHandler } from './databaseWorkspaceController.js';
import {
  workspaceAccess,
  reauthorizeExecution,
} from '../services/databaseWorkspace/access.js';
import {
  workspaceConfiguration,
  targetCredential,
  publicTarget,
} from '../services/databaseWorkspace/config.js';
import { getConfigValue } from '../services/configService.js';
import {
  controlStore,
  operationHash,
  opened,
} from '../services/databaseWorkspace/store.js';
import {
  stageRecovery,
  recoveryArchive,
} from '../services/databaseWorkspace/recovery.js';
import {
  listBackupCopies,
  findBackupCopy,
  streamBackupCopy,
  executeBackupScript,
} from '../services/dbBackupService.js';
import {
  createReview,
  verifyReview,
} from '../services/databaseWorkspace/reviews.js';
import {
  WorkspaceError,
  type JobPayload,
} from '../services/databaseWorkspace/types.js';

export const backupInventory = workspaceHandler(async (req, res) => {
  await workspaceAccess(req, 'backup');
  const inventory = await listBackupCopies(),
    files = inventory.files,
    jobs = await controlStore().pool.query(
      "SELECT payload,finished_at FROM database_workspace.jobs WHERE mode='maintenance' AND status='succeeded' ORDER BY finished_at DESC LIMIT 100",
    );
  const tested = jobs.rows
    .map((row) => ({
      payload: opened<JobPayload>(row.payload),
      finishedAt: row.finished_at,
    }))
    .filter((row) => row.payload.recovery);
  res.json({
    files: files.map((file) => ({
      id: file.id,
      filename: file.filename,
      sizeBytes: file.sizeBytes,
      createdAt: file.createdAt,
      modifiedAt: file.modifiedAt,
      location: file.location,
      checksum: file.sha256Checksum || null,
      matchingNameCopies: files.filter((f) => f.filename === file.filename)
        .length,
      lastTestedRestore:
        tested.find(
          (t) =>
            t.payload.recovery?.sourceCopyId === file.id &&
            t.payload.recovery?.sourceFingerprint === file.fingerprint &&
            (!file.sha256Checksum ||
              t.payload.recovery.checksum === file.sha256Checksum),
        )?.finishedAt || null,
    })),
    stores: inventory.stores,
    storageMode: inventory.storageMode,
    keepLocalAfterUpload: inventory.keepLocalAfterUpload,
    pitr: {
      verified: false,
      reason:
        'This inventory contains logical dump archives. Continuous WAL/base-backup coverage has not been verified.',
    },
  });
});
export const backupDownload = workspaceHandler(async (req, res) => {
  const actor = await workspaceAccess(req, 'backup');
  await workspaceAccess(req, 'export');
  const config = await workspaceConfiguration();
  const copy = await findBackupCopy(String(req.params.id));
  await controlStore().audit(actor, 'backup_download_started', {
    copyId: copy.id,
    location: copy.location,
    filename: copy.filename,
    bytes: copy.sizeBytes,
  });
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename*=UTF-8''${encodeURIComponent(copy.filename)}`,
  );
  res.setHeader('Content-Length', String(copy.sizeBytes));
  const timeout = setTimeout(
      () => res.destroy(),
      Number(getConfigValue('DB_WORKSPACE_EXPORT_TIMEOUT_MS')),
    ),
    authority = setInterval(() => {
      void reauthorizeExecution(actor, 'read', config.policyHash, 'backup')
        .then(() =>
          reauthorizeExecution(actor, 'read', config.policyHash, 'export'),
        )
        .catch(() => res.destroy());
    }, 5000);
  timeout.unref();
  authority.unref();
  try {
    await streamBackupCopy(copy.id, res, copy.fingerprint);
    await controlStore().audit(actor, 'backup_download_completed', {
      copyId: copy.id,
    });
  } catch {
    res.destroy();
    await controlStore()
      .audit(actor, 'backup_download_interrupted', { copyId: copy.id })
      .catch(() => {});
  } finally {
    clearTimeout(timeout);
    clearInterval(authority);
  }
});
export const backupCreate = workspaceHandler(async (req, res) => {
  const actor = await workspaceAccess(req, 'backup');
  await controlStore().audit(actor, 'backup_requested', {
    source: 'existing DB Backups integration',
  });
  // The existing backup script/storage integration remains the source of truth.
  // This route awaits completion so failures are visible instead of accepting an
  // untracked fire-and-forget request.
  const result = await executeBackupScript();
  if (result.exitCode !== 0)
    throw new WorkspaceError(
      409,
      'BACKUP_FAILED',
      'The existing backup job failed. Inspect DB Backups operator logs.',
    );
  res.json({ completed: true });
});
export const restoreStage = workspaceHandler(async (req, res) => {
  const actorId = await workspaceAccess(req, 'restore');
  await workspaceAccess(req, 'backup');
  const config = await workspaceConfiguration(),
    { target } = targetCredential(
      config,
      String(req.body?.targetId || ''),
      'maintenance',
    );
  if (getConfigValue('DB_WORKSPACE_RESTORE_ENABLED') !== true)
    throw new WorkspaceError(
      403,
      'RESTORE_DISABLED',
      'Enable isolated restore only after provisioning and rehearsing its dedicated identity.',
    );
  const source = await findBackupCopy(String(req.body?.copyId || ''));
  const archive = await stageRecovery(
    controlStore(),
    actorId,
    source,
    {
      directory: config.limits.artifactDirectory,
      maxBytes: Number(getConfigValue('DB_WORKSPACE_RESTORE_MAX_BACKUP_BYTES')),
      minFreeBytes: Number(
        getConfigValue('DB_WORKSPACE_RESTORE_MIN_FREE_BYTES'),
      ),
      storageBudget: config.limits.storageBudgetBytes,
      binary: String(getConfigValue('DB_WORKSPACE_PG_RESTORE_BIN')),
      targetMajor: target.major,
      ttlMinutes: config.limits.resultTtlMinutes,
      expansionFactor: Number(
        getConfigValue('DB_WORKSPACE_RESTORE_EXPANSION_FACTOR'),
      ),
    },
    (destination) =>
      streamBackupCopy(source.id, destination, source.fingerprint),
  );
  res.status(201).json({
    id: archive.archiveId,
    filename: archive.sourceFilename,
    bytes: archive.bytes,
    checksum: archive.checksum,
    archiveMajor: archive.archiveMajor,
    toolMajor: archive.toolMajor,
  });
});
export const backupDelete = workspaceHandler(async (req, res) => {
  const actorId = await workspaceAccess(req, 'backupDelete');
  await workspaceAccess(req, 'backup');
  const config = await workspaceConfiguration(),
    store = controlStore(),
    body = req.body || {};
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 5 || reason.length > 1000)
    throw new WorkspaceError(
      400,
      'REASON_REQUIRED',
      'Explain why this backup copy should be removed.',
    );
  const requestHash = operationHash({
    actorId,
    targetId: body.targetId,
    copyId: body.copyId,
    permanent: body.permanent === true,
    reason,
  });
  if (body.action === 'delete') {
    if (
      typeof body.idempotencyKey !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(body.idempotencyKey)
    )
      throw new WorkspaceError(
        400,
        'REQUEST_ID_REQUIRED',
        'Use a unique deletion request ID.',
      );
    const existing = await store.existingRequest(
      actorId,
      body.idempotencyKey,
      requestHash,
    );
    if (existing) {
      res.status(202).json(existing);
      return;
    }
  }
  const copy = await findBackupCopy(String(body.copyId || '')),
    { target, credential } = targetCredential(
      config,
      String(body.targetId || ''),
      'read',
    );
  const deletion = {
    copyId: copy.id,
    fingerprint: copy.fingerprint,
    filename: copy.filename,
    location: copy.location,
    permanent: copy.location === 'local' || body.permanent === true,
  };
  const hash = operationHash({
    actorId,
    target: target.id,
    deletion,
    reason,
    policy: config.policyHash,
  });
  if (body.action !== 'delete') {
    const review = createReview(
      hash,
      actorId,
      config.limits.reviewTokenTtlSeconds,
    );
    await store.audit(
      actorId,
      'backup_deletion_reviewed',
      { hash, deletion, reason },
      target.id,
    );
    res.json({
      ...review,
      copy: {
        id: copy.id,
        filename: copy.filename,
        location: copy.location,
        sizeBytes: copy.sizeBytes,
      },
      permanent: deletion.permanent,
      warning: deletion.permanent
        ? 'Only this selected copy will be permanently deleted. Other copies are not removed.'
        : 'Only this selected Google Drive copy will move to the trash. It remains recoverable according to Drive retention; trash may still consume storage.',
    });
    return;
  }
  if (body.confirmFilename !== copy.filename)
    throw new WorkspaceError(
      400,
      'DELETE_CONFIRMATION',
      'Type the exact backup filename to confirm deletion of this copy.',
    );
  const nonce = verifyReview(body.reviewToken, hash, actorId);
  res.status(202).json(
    await store.enqueue(
      {
        actorId,
        target,
        credential,
        statements: [],
        parameters: [],
        mode: 'maintenance',
        reason,
        limits: config.limits,
        policyHash: config.policyHash,
        protectedObjects: config.protectedObjects,
        requestHash,
        backupDeletion: deletion,
      },
      hash,
      body.idempotencyKey,
      nonce,
    ),
  );
});
export const restoreReview = workspaceHandler(async (req, res) => {
  const actorId = await workspaceAccess(req, 'restore');
  await workspaceAccess(req, 'backup');
  const config = await workspaceConfiguration(),
    store = controlStore(),
    body = req.body || {},
    reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 5 || reason.length > 1000)
    throw new WorkspaceError(
      400,
      'REASON_REQUIRED',
      'Explain the purpose of this isolated restore.',
    );
  if (getConfigValue('DB_WORKSPACE_RESTORE_ENABLED') !== true)
    throw new WorkspaceError(
      403,
      'RESTORE_DISABLED',
      'Isolated restore is disabled.',
    );
  const { target, credential } = targetCredential(
      config,
      String(body.targetId || ''),
      'maintenance',
    ),
    archive = await recoveryArchive(
      store,
      String(body.archiveId || ''),
      actorId,
    );
  const entry = config.credentials[target.id] as {
      restore?: { user?: string; password?: string };
    },
    restore = entry?.restore;
  if (!restore?.user || !restore.password)
    throw new WorkspaceError(
      503,
      'RESTORE_IDENTITY',
      'Configure a separate nonsuperuser CREATEDB restore identity for this target.',
    );
  const destination =
    typeof body.destination === 'string'
      ? body.destination
      : `omnilodge_restore_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}_${crypto.randomBytes(4).toString('hex')}`;
  if (
    !/^omnilodge_restore_\d{8}_[a-f0-9]{8}$/.test(destination) ||
    config.targets.some((t) => t.database === destination)
  )
    throw new WorkspaceError(
      403,
      'RESTORE_DESTINATION',
      'Use the server-generated isolated destination. Registered databases cannot be overwritten.',
    );
  const recovery: NonNullable<JobPayload['recovery']> = {
    ...archive,
    destination,
    adminDatabase: String(
      getConfigValue('DB_WORKSPACE_RESTORE_ADMIN_DATABASE'),
    ),
    credential: { user: restore.user, password: restore.password },
    binary: String(getConfigValue('DB_WORKSPACE_PG_RESTORE_BIN')),
    serverMajor: target.major,
    minFreeBytes: Number(getConfigValue('DB_WORKSPACE_RESTORE_MIN_FREE_BYTES')),
  };
  const hash = operationHash({
    actorId,
    target: target.id,
    recovery,
    reason,
    policy: config.policyHash,
  });
  if (body.action !== 'restore') {
    const review = createReview(
      hash,
      actorId,
      config.limits.reviewTokenTtlSeconds,
    );
    await store.audit(
      actorId,
      'isolated_restore_reviewed',
      {
        hash,
        destination,
        source: archive.sourceFilename,
        checksum: archive.checksum,
        reason,
      },
      target.id,
    );
    res.json({
      ...review,
      hash,
      destination,
      target: publicTarget(target),
      source: archive.sourceFilename,
      checksum: archive.checksum,
      bytes: archive.bytes,
      archiveMajor: archive.archiveMajor,
      toolMajor: archive.toolMajor,
      warning:
        'A new private database will be created. The source/application database will not be replaced. No application schema sync or access reseed will run.',
    });
    return;
  }
  if (body.confirmDestination !== destination)
    throw new WorkspaceError(
      400,
      'RESTORE_CONFIRMATION',
      'Type the exact isolated destination name to confirm.',
    );
  if (
    typeof body.idempotencyKey !== 'string' ||
    !/^[0-9a-f-]{36}$/i.test(body.idempotencyKey)
  )
    throw new WorkspaceError(
      400,
      'REQUEST_ID_REQUIRED',
      'Use a unique restore request ID.',
    );
  const existing = await store.existing(actorId, body.idempotencyKey, hash);
  if (existing) {
    res.status(202).json(existing);
    return;
  }
  const nonce = verifyReview(body.reviewToken, hash, actorId);
  const job = await store.enqueue(
    {
      actorId,
      target,
      credential,
      statements: [],
      parameters: [],
      mode: 'maintenance',
      reason,
      limits: {
        ...config.limits,
        jobMaxDurationMs: Number(
          getConfigValue('DB_WORKSPACE_RESTORE_TIMEOUT_MS'),
        ),
      },
      policyHash: config.policyHash,
      protectedObjects: config.protectedObjects,
      recovery,
    },
    hash,
    body.idempotencyKey,
    nonce,
  );
  await store.pool.query(
    'UPDATE database_workspace.restore_archives SET job_id=$2 WHERE id=$1',
    [archive.archiveId, job.id],
  );
  res.status(202).json(job);
});
