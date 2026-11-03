import type { Response } from 'express';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import {
  workspaceAccess,
  WORKSPACE_ACTIONS,
} from '../services/databaseWorkspace/access.js';
import {
  workspaceConfiguration,
  targetCredential,
  publicTarget,
} from '../services/databaseWorkspace/config.js';
import { parseSql } from '../services/databaseWorkspace/parser.js';
import { controlStore } from '../services/databaseWorkspace/store.js';
import {
  executionHash,
  createReview,
  verifyReview,
} from '../services/databaseWorkspace/reviews.js';
import { readResult } from '../services/databaseWorkspace/artifacts.js';
import {
  catalogObjects,
  describeCatalogObject,
  catalogCategory,
} from '../services/databaseWorkspace/catalog.js';
import {
  WorkspaceError,
  type ExecutionInput,
  type ExecutionMode,
} from '../services/databaseWorkspace/types.js';
import { getConfigValue } from '../services/configService.js';
import {
  buildDataChanges,
  buildTableView,
  tableCursor,
} from '../services/databaseWorkspace/dataChanges.js';
import { operationHash } from '../services/databaseWorkspace/store.js';
import { authorizeResult } from '../services/databaseWorkspace/resultAccess.js';
import HttpError from '../errors/HttpError.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = (value: unknown) => {
  if (typeof value !== 'string' || !uuid.test(value))
    throw new WorkspaceError(400, 'INVALID_ID', 'Invalid execution reference.');
  return value;
};
export const workspaceHandler =
  (handler: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      await handler(req, res);
    } catch (error) {
      if (error instanceof WorkspaceError)
        res
          .status(error.status)
          .json({ code: error.code, message: error.message, ...error.context });
      else if (error instanceof HttpError)
        res
          .status(error.status)
          .json({ code: 'WORKSPACE_OPERATION', message: error.message });
      else
        res.status(503).json({
          code: 'WORKSPACE_UNAVAILABLE',
          message:
            'The database workspace service is unavailable. Check worker and control-storage readiness.',
        });
    }
  };
async function input(
  req: AuthenticatedRequest,
  requireReason = true,
): Promise<ExecutionInput> {
  const b = req.body as Partial<ExecutionInput>;
  if (
    !b ||
    typeof b.targetId !== 'string' ||
    typeof b.sql !== 'string' ||
    !['read', 'write'].includes(b.mode || '') ||
    !Array.isArray(b.parameters) ||
    b.parameters.length > 100 ||
    b.parameters.some(
      (v) => v !== null && (typeof v !== 'string' || v.length > 100000),
    ) ||
    (b.reason !== undefined &&
      (typeof b.reason !== 'string' || b.reason.length > 1000))
  )
    throw new WorkspaceError(
      400,
      'INVALID_EXECUTION',
      'Select a connection, mode, SQL and typed parameters.',
    );
  if (
    requireReason &&
    b.mode === 'write' &&
    (typeof b.reason !== 'string' ||
      b.reason.trim().length < 5 ||
      b.reason.length > 1000)
  )
    throw new WorkspaceError(
      400,
      'REASON_REQUIRED',
      'Enter a reason of at least five characters for this write.',
    );
  return {
    targetId: b.targetId,
    sql: b.sql,
    mode: b.mode as ExecutionMode,
    parameters: b.parameters,
    reason: b.reason || '',
    reviewToken: b.reviewToken,
    idempotencyKey: b.idempotencyKey,
  };
}
async function preparation(req: AuthenticatedRequest, requireReason = true) {
  const data = await input(req, requireReason),
    actorId = await workspaceAccess(
      req,
      data.mode === 'read' ? 'read' : 'write',
    );
  const config = await workspaceConfiguration(),
    { target, credential } = targetCredential(config, data.targetId, data.mode);
  const statements = await parseSql(data.sql, target.major, {
    maxBytes: config.limits.queryMaxBytes,
    maxStatements: config.limits.batchMaxStatements,
    mode: data.mode,
    schemas: target.schemas,
    protectedObjects: config.protectedObjects,
  });
  return {
    data,
    actorId,
    config,
    target,
    credential,
    statements,
    hash: executionHash(data, actorId, config.policyHash),
  };
}

export const workspaceCapabilities = workspaceHandler(async (req, res) => {
  await workspaceAccess(req, 'view');
  const config = await workspaceConfiguration();
  const actions = Object.fromEntries(
    await Promise.all(
      WORKSPACE_ACTIONS.map(async (a) => {
        try {
          await workspaceAccess(req, a);
          return [a, true];
        } catch {
          return [a, false];
        }
      }),
    ),
  );
  let controlReady = false;
  try {
    controlReady = await controlStore().healthy();
  } catch {
    /* Setup screen remains available. */
  }
  const workerReady = controlReady && (await controlStore().workerReady());
  res.json({
    enabled: config.enabled,
    writesEnabled: config.writesEnabled,
    maintenanceEnabled: config.maintenanceEnabled,
    controlReady,
    workerReady,
    controlStorage: controlReady ? await controlStore().capacity() : undefined,
    activityRefreshSeconds: Number(
      getConfigValue('DB_WORKSPACE_ACTIVITY_REFRESH_SECONDS'),
    ),
    metadataTtlSeconds: Number(
      getConfigValue('DB_WORKSPACE_METADATA_TTL_SECONDS'),
    ),
    cellDisplayMaxBytes: Number(
      getConfigValue('DB_WORKSPACE_CELL_DISPLAY_MAX_BYTES'),
    ),
    actions,
    limits: config.limits,
    targets: config.targets.map((target) => ({
      ...publicTarget(target),
      roles: Object.fromEntries(
        Object.entries(
          (config.credentials[target.id] || {}) as Record<
            string,
            { user?: string }
          >,
        ).map(([mode, value]) => [mode, value.user || 'not configured']),
      ),
    })),
    policyHash: config.policyHash,
  });
});
export const workspaceValidate = workspaceHandler(async (req, res) => {
  const p = await preparation(req, false);
  res.json({
    hash: p.hash,
    statements: p.statements.map(({ tree, ...s }) => s),
    target: publicTarget(p.target),
  });
});
export const workspaceReview = workspaceHandler(async (req, res) => {
  const p = await preparation(req);
  if (
    p.statements.some((s) => s.requiresReview) &&
    p.data.reason!.trim().length < 5
  )
    throw new WorkspaceError(
      400,
      'REASON_REQUIRED',
      'Explain why this statement should be executed for an actual plan.',
    );
  const review = createReview(
    p.hash,
    p.actorId,
    p.config.limits.reviewTokenTtlSeconds,
  );
  await controlStore().audit(
    p.actorId,
    'operation_reviewed',
    {
      hash: p.hash,
      reason: p.data.reason,
      statementCount: p.statements.length,
    },
    p.target.id,
  );
  res.json({
    token: review.token,
    expiresAt: review.expiresAt,
    hash: p.hash,
    target: publicTarget(p.target),
    statements: p.statements.map(({ tree, ...s }) => s),
    reason: p.data.reason,
    atomic: true,
    rowLimit: p.config.limits.writeMaxRows,
  });
});
export const workspaceExecute = workspaceHandler(async (req, res) => {
  const p = await preparation(req);
  if (
    p.data.idempotencyKey !== undefined &&
    (typeof p.data.idempotencyKey !== 'string' ||
      !uuid.test(p.data.idempotencyKey))
  )
    throw new WorkspaceError(
      400,
      'INVALID_REQUEST_ID',
      'Use a UUID request ID.',
    );
  const reviewed =
    p.data.mode === 'write' || p.statements.some((s) => s.requiresReview);
  if (reviewed && !p.data.idempotencyKey)
    throw new WorkspaceError(
      400,
      'REQUEST_ID_REQUIRED',
      'A reviewed request requires an idempotency ID.',
    );
  const existing = await controlStore().existing(
    p.actorId,
    p.data.idempotencyKey,
    p.hash,
  );
  if (existing) {
    res.status(202).json(existing);
    return;
  }
  const nonce = reviewed
    ? verifyReview(p.data.reviewToken, p.hash, p.actorId)
    : undefined;
  const job = await controlStore().enqueue(
    {
      actorId: p.actorId,
      target: p.target,
      credential: p.credential,
      statements: p.statements,
      parameters: p.data.parameters,
      mode: p.data.mode,
      reason: p.data.reason || '',
      limits: p.config.limits,
      policyHash: p.config.policyHash,
      protectedObjects: p.config.protectedObjects,
    },
    p.hash,
    p.data.idempotencyKey,
    nonce,
  );
  res.status(202).json(job);
});
export const workspaceStatus = workspaceHandler(async (req, res) => {
  const actorId = await workspaceAccess(req, 'view');
  res.json(await controlStore().get(id(req.params.id), actorId));
});
export const workspaceHistory = workspaceHandler(async (req, res) => {
  const actorId = await workspaceAccess(req, 'view');
  res.json(await controlStore().history(actorId));
});
export const workspaceCancel = workspaceHandler(async (req, res) => {
  const actorId = await workspaceAccess(req, 'view');
  res.json(await controlStore().cancel(id(req.params.id), actorId));
});
export const workspaceResult = workspaceHandler(async (req, res) => {
  const actorId = await workspaceAccess(req, 'read');
  const executionId = id(req.params.id),
    index = Number(req.params.index);
  if (!Number.isSafeInteger(index) || index < 0)
    throw new WorkspaceError(400, 'INVALID_RESULT', 'Invalid result index.');
  await authorizeResult(controlStore(), executionId, actorId);
  const config = await workspaceConfiguration();
  res.json(
    await readResult(controlStore(), executionId, index, actorId, {
      ...req.body,
      pageSize: Math.min(
        Number(req.body?.pageSize || config.limits.resultPageRows),
        config.limits.resultPageRows,
      ),
    }),
  );
});
export const workspaceCatalog = workspaceHandler(async (req, res) => {
  await workspaceAccess(req, 'read');
  const config = await workspaceConfiguration(),
    { target, credential } = targetCredential(
      config,
      String(req.query.targetId || ''),
      'read',
    );
  if (req.query.category && req.query.category !== 'relations') {
    res.json(
      await catalogCategory(
        target,
        credential,
        String(req.query.category),
        String(req.query.search || ''),
        Number(req.query.offset || 0),
      ),
    );
    return;
  }
  res.json(
    await catalogObjects(
      target,
      credential,
      String(req.query.search || ''),
      config.protectedObjects,
      typeof req.query.schema === 'string' ? req.query.schema : undefined,
      Number(req.query.offset || 0),
    ),
  );
});
export const workspaceObject = workspaceHandler(async (req, res) => {
  await workspaceAccess(req, 'read');
  const config = await workspaceConfiguration(),
    { target, credential } = targetCredential(
      config,
      String(req.query.targetId || ''),
      'read',
    );
  res.json(
    await describeCatalogObject(
      target,
      credential,
      String(req.params.oid),
      config.protectedObjects,
    ),
  );
});
export const workspaceDocuments = workspaceHandler(async (req, res) => {
  const actorId = await workspaceAccess(req, 'view'),
    kind = String(req.query.kind || 'query');
  if (!['query', 'draft', 'layout', 'share'].includes(kind))
    throw new WorkspaceError(
      400,
      'INVALID_DOCUMENT',
      'Invalid document category.',
    );
  res.json(await controlStore().documents(actorId, kind));
});
export const workspaceSaveDocument = workspaceHandler(async (req, res) => {
  const actorId = await workspaceAccess(req, 'view'),
    body = req.body;
  if (
    !body ||
    !['query', 'draft', 'layout'].includes(body.kind) ||
    !body.value ||
    typeof body.value !== 'object' ||
    Array.isArray(body.value)
  )
    throw new WorkspaceError(
      400,
      'INVALID_DOCUMENT',
      'A document needs a category and content.',
    );
  const config = await workspaceConfiguration();
  if (
    Buffer.byteLength(JSON.stringify(body.value)) >
    config.limits.queryMaxBytes * (body.kind === 'layout' ? 21 : 2)
  )
    throw new WorkspaceError(
      413,
      'DOCUMENT_TOO_LARGE',
      'The document exceeds its size limit.',
    );
  if (body.id) id(body.id);
  if (body.value.title && String(body.value.title).length > 120)
    throw new WorkspaceError(
      400,
      'INVALID_DOCUMENT',
      'Use a title shorter than 120 characters.',
    );
  if (body.value.sql !== undefined && typeof body.value.sql !== 'string')
    throw new WorkspaceError(
      400,
      'INVALID_DOCUMENT',
      'SQL content must be text.',
    );
  res.json(
    await controlStore().saveDocument(
      actorId,
      {
        id: body.id,
        kind: body.kind,
        revision: body.revision,
        value: body.value,
      },
      body.kind === 'query'
        ? undefined
        : Number(getConfigValue('DB_WORKSPACE_DRAFT_RETENTION_DAYS') || 7),
      {
        documents: Number(getConfigValue('DB_WORKSPACE_LIBRARY_MAX_DOCUMENTS')),
        revisions: Number(getConfigValue('DB_WORKSPACE_LIBRARY_MAX_REVISIONS')),
      },
    ),
  );
});
export const workspaceDocumentRevisions = workspaceHandler(async (req, res) => {
  const actor = await workspaceAccess(req, 'view');
  res.json(await controlStore().documentRevisions(actor, id(req.params.id)));
});
export const workspaceAudit = workspaceHandler(async (req, res) => {
  await workspaceAccess(req, 'audit');
  if (req.query.beforeId && !/^\d+$/.test(String(req.query.beforeId)))
    throw new WorkspaceError(400, 'AUDIT_CURSOR', 'Invalid audit cursor.');
  res.json(
    await controlStore().auditPage(
      req.query.beforeId ? String(req.query.beforeId) : undefined,
    ),
  );
});
export const workspaceAdminJob = workspaceHandler(async (req, res) => {
  await workspaceAccess(req, 'audit');
  res.json(await controlStore().get(id(req.params.id)));
});
export const workspaceAdminCancel = workspaceHandler(async (req, res) => {
  const actor = await workspaceAccess(req, 'cancelOthers'),
    job = await controlStore().get(id(req.params.id));
  if (typeof req.body?.reason !== 'string' || req.body.reason.trim().length < 5)
    throw new WorkspaceError(
      400,
      'REASON_REQUIRED',
      'Explain why this other user’s job should be cancelled.',
    );
  await controlStore().audit(
    actor,
    'other_job_cancel_reviewed',
    { ownerId: job.actorId, reason: req.body.reason },
    job.targetId,
    job.id,
  );
  res.json(await controlStore().cancel(job.id, job.actorId, actor));
});
export const workspaceDeleteDocument = workspaceHandler(async (req, res) => {
  const actorId = await workspaceAccess(req, 'view');
  await controlStore().deleteDocument(actorId, id(req.params.id));
  res.status(204).end();
});
export const workspaceTableView = workspaceHandler(async (req, res) => {
  const actorId = await workspaceAccess(req, 'read'),
    config = await workspaceConfiguration(),
    { target, credential } = targetCredential(
      config,
      String(req.body?.targetId || ''),
      'read',
    );
  const view = await buildTableView(
    target,
    credential,
    config.protectedObjects,
    config.limits,
    req.body || {},
  );
  const hash = operationHash({
    actorId,
    kind: 'table-view',
    target: target.id,
    statements: view.statements,
    policy: config.policyHash,
  });
  const context = {
    fingerprint: view.fingerprint,
    sort: view.sort,
    pageSize: view.pageSize,
    stable: view.stable,
    objectId: view.details.id,
    qualifiedName: view.details.qualifiedName,
  };
  const job = await controlStore().enqueue(
    {
      actorId,
      target,
      credential,
      statements: view.statements,
      parameters: [],
      mode: 'read',
      reason: 'Browse table data',
      limits: config.limits,
      policyHash: config.policyHash,
      protectedObjects: config.protectedObjects,
      tableView: context,
    },
    hash,
  );
  res.status(202).json({
    job,
    view: { ...context, selected: view.selected, output: view.output },
  });
});
export const workspaceTablePage = workspaceHandler(async (req, res) => {
  const actorId = await workspaceAccess(req, 'read'),
    executionId = id(req.params.id),
    store = controlStore();
  const payload = await authorizeResult(store, executionId, actorId);
  if (!payload.tableView)
    throw new WorkspaceError(
      400,
      'NOT_TABLE_VIEW',
      'This execution is not a table browse operation.',
    );
  const result = await readResult(store, executionId, 0, actorId, {
    page: 0,
    pageSize: 500,
  });
  const view = payload.tableView,
    rows = result.rows.slice(0, view.pageSize),
    hasMore = result.capturedRows > view.pageSize || !result.complete;
  if (hasMore && !rows.length)
    throw new WorkspaceError(
      413,
      'ROW_TOO_LARGE',
      'The first row exceeds the capture budget. Choose fewer columns.',
    );
  res.json({
    ...result,
    rows,
    hasMore,
    nextCursor:
      hasMore && view.stable
        ? tableCursor(
            view.fingerprint,
            view.sort,
            result.fields.map((f) => f.name),
            rows[rows.length - 1],
          )
        : null,
    stable: view.stable,
    scope: 'live-table-page',
  });
});
export const workspaceDataChange = workspaceHandler(async (req, res) => {
  const actorId = await workspaceAccess(req, 'write'),
    config = await workspaceConfiguration(),
    { target, credential } = targetCredential(
      config,
      String(req.body?.targetId || ''),
      'write',
    );
  const reason =
    typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (reason.length < 5 || reason.length > 1000)
    throw new WorkspaceError(
      400,
      'REASON_REQUIRED',
      'Explain the reason for these row changes.',
    );
  const plan = await buildDataChanges(
    target,
    credential,
    config.protectedObjects,
    config.limits,
    req.body || {},
  );
  const hash = operationHash({
    actorId,
    kind: 'data-change',
    target: target.id,
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
    await controlStore().audit(
      actorId,
      'data_change_reviewed',
      { hash, reason, changes: plan.summary },
      target.id,
    );
    res.json({
      token: review.token,
      expiresAt: review.expiresAt,
      hash,
      target: publicTarget(target),
      summary: plan.summary,
      statements: plan.statements.map((s) => ({
        sql: s.sql,
        parameters: s.parameters,
      })),
      atomic: true,
    });
    return;
  }
  const requestId = id(req.body.idempotencyKey),
    existing = await controlStore().existing(actorId, requestId, hash);
  if (existing) {
    res.status(202).json(existing);
    return;
  }
  const nonce = verifyReview(req.body.reviewToken, hash, actorId);
  const job = await controlStore().enqueue(
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
    requestId,
    nonce,
  );
  res.status(202).json(job);
});
