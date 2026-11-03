import { workspaceHandler } from './databaseWorkspaceController.js';
import { workspaceAccess } from '../services/databaseWorkspace/access.js';
import {
  workspaceConfiguration,
  targetCredential,
  publicTarget,
} from '../services/databaseWorkspace/config.js';
import { getConfigValue } from '../services/configService.js';
import {
  controlStore,
  operationHash,
} from '../services/databaseWorkspace/store.js';
import {
  parseImport,
  prepareImport,
  type ImportData,
} from '../services/databaseWorkspace/imports.js';
import {
  createReview,
  verifyReview,
} from '../services/databaseWorkspace/reviews.js';
import { WorkspaceError } from '../services/databaseWorkspace/types.js';

export const importStage = workspaceHandler(async (req, res) => {
  const actorId = await workspaceAccess(req, 'write'),
    config = await workspaceConfiguration();
  const { target } = targetCredential(
    config,
    String(req.body?.targetId || ''),
    'write',
  );
  const data = await parseImport(req.body?.content, req.body?.format, {
    maxBytes: Number(getConfigValue('DB_WORKSPACE_IMPORT_MAX_BYTES')),
    maxRows: Math.min(
      config.limits.writeMaxRows,
      Number(getConfigValue('DB_WORKSPACE_IMPORT_MAX_ROWS_PER_TX')),
    ),
    delimiter: req.body?.delimiter,
    nullToken: req.body?.nullToken,
  });
  const saved = await controlStore().saveDocument(
    actorId,
    {
      kind: 'import',
      value: {
        targetId: target.id,
        objectId: String(req.body.objectId || ''),
        data,
      },
    },
    1,
  );
  await controlStore().audit(
    actorId,
    'import_staged',
    { id: saved.id, rows: data.rows.length, columns: data.headers.length },
    target.id,
  );
  res.status(201).json({
    id: saved.id,
    revision: saved.revision,
    headers: data.headers,
    sample: data.rows.slice(0, 20),
    rows: data.rows.length,
  });
});
export const importReview = workspaceHandler(async (req, res) => {
  const actorId = await workspaceAccess(req, 'write'),
    config = await workspaceConfiguration(),
    store = controlStore();
  const document = (await store.documents(actorId, 'import')).find(
    (d) => d.id === req.params.id,
  );
  if (!document)
    throw new WorkspaceError(
      410,
      'IMPORT_EXPIRED',
      'The staged import expired or is unavailable. Upload it again.',
    );
  const value = document.value as {
      targetId: string;
      objectId: string;
      data: ImportData;
    },
    reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (reason.length < 5 || reason.length > 1000)
    throw new WorkspaceError(400, 'REASON_REQUIRED', 'Explain this import.');
  const { target, credential } = targetCredential(
    config,
    value.targetId,
    'write',
  );
  const plan = await prepareImport(
    target,
    credential,
    config.protectedObjects,
    config.limits,
    value.data,
    { ...req.body, objectId: value.objectId },
  );
  if (plan.errors.length) {
    res.status(422).json({
      code: 'IMPORT_VALIDATION',
      message: 'Fix the listed rows or mapping before importing.',
      ...plan,
      statements: undefined,
    });
    return;
  }
  const hash = operationHash({
    actorId,
    id: document.id,
    revision: document.revision,
    statements: plan.statements,
    schemaChecks: plan.schemaChecks,
    reason,
    policy: config.policyHash,
  });
  if (req.body.action !== 'commit') {
    const review = createReview(
      hash,
      actorId,
      config.limits.reviewTokenTtlSeconds,
    );
    await store.audit(
      actorId,
      'import_reviewed',
      { hash, id: document.id, rows: plan.rows, reason },
      target.id,
    );
    res.json({
      ...review,
      hash,
      target: publicTarget(target),
      rows: plan.rows,
      columns: plan.columns,
      sample: plan.sample,
      statements: plan.statements.map((s) => s.sql),
      atomic: true,
    });
    return;
  }
  if (
    typeof req.body.idempotencyKey !== 'string' ||
    !/^[0-9a-f-]{36}$/i.test(req.body.idempotencyKey)
  )
    throw new WorkspaceError(
      400,
      'REQUEST_ID_REQUIRED',
      'Use a unique request ID.',
    );
  const existing = await store.existing(actorId, req.body.idempotencyKey, hash);
  if (existing) {
    res.status(202).json(existing);
    return;
  }
  const nonce = verifyReview(req.body.reviewToken, hash, actorId);
  res.status(202).json(
    await store.enqueue(
      {
        actorId,
        target,
        credential,
        statements: plan.statements,
        parameters: [],
        mode: 'write',
        reason,
        limits: config.limits,
        policyHash: config.policyHash,
        protectedObjects: config.protectedObjects,
        schemaChecks: plan.schemaChecks,
      },
      hash,
      req.body.idempotencyKey,
      nonce,
    ),
  );
});
