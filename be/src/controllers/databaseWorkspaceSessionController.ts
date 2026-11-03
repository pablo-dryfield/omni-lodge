import { workspaceHandler } from './databaseWorkspaceController.js';
import {
  workspaceAccess,
  reauthorizeExecution,
} from '../services/databaseWorkspace/access.js';
import {
  workspaceConfiguration,
  targetCredential,
} from '../services/databaseWorkspace/config.js';
import {
  controlStore,
  operationHash,
} from '../services/databaseWorkspace/store.js';
import {
  openSession,
  listSessions,
  getSession,
} from '../services/databaseWorkspace/sessions.js';
import { parseSql } from '../services/databaseWorkspace/parser.js';
import {
  createReview,
  verifyReview,
} from '../services/databaseWorkspace/reviews.js';
import { getConfigValue } from '../services/configService.js';
import {
  WorkspaceError,
  type SessionCommand,
  type JobPayload,
  type SessionPolicy,
} from '../services/databaseWorkspace/types.js';

export const sessionList = workspaceHandler(async (req, res) => {
  const actor = await workspaceAccess(req, 'session');
  res.json(await listSessions(controlStore(), actor));
});
export const sessionOpen = workspaceHandler(async (req, res) => {
  const actorId = await workspaceAccess(req, 'session'),
    mode = req.body?.mode === 'write' ? 'write' : 'read';
  await workspaceAccess(req, mode);
  const config = await workspaceConfiguration(),
    { target, credential } = targetCredential(
      config,
      String(req.body?.targetId || ''),
      mode,
    );
  const sessionPolicy: SessionPolicy = {
    idleMs: Number(getConfigValue('DB_WORKSPACE_SESSION_IDLE_MS')),
    transactionMaxMs: Number(
      getConfigValue('DB_WORKSPACE_SESSION_TRANSACTION_MAX_MS'),
    ),
    maxMs: Number(getConfigValue('DB_WORKSPACE_SESSION_MAX_MS')),
    maxPerTarget: Number(
      getConfigValue('DB_WORKSPACE_ACTIVE_SESSIONS_PER_TARGET'),
    ),
  };
  res.status(202).json(
    await openSession(controlStore(), {
      actorId,
      target,
      credential,
      statements: [],
      parameters: [],
      mode,
      reason: 'Expert transaction session',
      limits: config.limits,
      policyHash: config.policyHash,
      protectedObjects: config.protectedObjects,
      sessionPolicy,
    }),
  );
});
export const sessionStatus = workspaceHandler(async (req, res) => {
  const actor = await workspaceAccess(req, 'session');
  res.json(
    (await getSession(controlStore(), String(req.params.id), actor)).record,
  );
});
export const sessionCommand = workspaceHandler(async (req, res) => {
  const actorId = await workspaceAccess(req, 'session'),
    store = controlStore(),
    { record, payload } = await getSession(
      store,
      String(req.params.id),
      actorId,
    );
  await reauthorizeExecution(actorId, payload.mode, payload.policyHash);
  const body = req.body || {},
    command = String(body.command || 'sql') as SessionCommand;
  if (
    ![
      'sql',
      'savepoint',
      'rollbackTo',
      'release',
      'commit',
      'rollback',
    ].includes(command)
  )
    throw new WorkspaceError(
      400,
      'INVALID_SESSION_COMMAND',
      'Unknown transaction command.',
    );
  if (
    record.state === 'aborted' &&
    !['rollback', 'rollbackTo'].includes(command)
  )
    throw new WorkspaceError(
      409,
      'TRANSACTION_ABORTED',
      'Roll back this transaction or roll back to a savepoint.',
    );
  const config = await workspaceConfiguration(),
    name = typeof body.name === 'string' ? body.name : undefined;
  if (
    ['savepoint', 'rollbackTo', 'release'].includes(command) &&
    (!name || !/^[a-z][a-z0-9_]{0,31}$/.test(name))
  )
    throw new WorkspaceError(
      400,
      'INVALID_SAVEPOINT',
      'Use a short lowercase savepoint name.',
    );
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  const statements =
    command === 'sql'
      ? await parseSql(body.sql, payload.target.major, {
          maxBytes: payload.limits.queryMaxBytes,
          maxStatements: 1,
          mode: payload.mode,
          schemas: payload.target.schemas,
          protectedObjects: payload.protectedObjects,
        })
      : [];
  if (statements.some((s) => s.rollbackPlan))
    throw new WorkspaceError(
      400,
      'PLAN_ORDINARY_JOB',
      'Run actual write plans outside an expert session so rollback is guaranteed.',
    );
  const parameters = body.parameters ?? [];
  if (
    !Array.isArray(parameters) ||
    parameters.length > 100 ||
    parameters.some(
      (v) => v !== null && (typeof v !== 'string' || v.length > 100000),
    )
  )
    throw new WorkspaceError(
      400,
      'INVALID_PARAMETERS',
      'Use exact text or null parameters.',
    );
  const reviewed =
    (command === 'commit' && payload.mode === 'write') ||
    statements.some((s) => s.mutating || s.requiresReview);
  if (reviewed && (reason.length < 5 || reason.length > 1000))
    throw new WorkspaceError(
      400,
      'REASON_REQUIRED',
      'Explain this transaction change.',
    );
  const revision = Number(body.revision);
  const commandPayload: JobPayload = {
    ...payload,
    statements,
    parameters,
    reason,
    sessionCommand: { command, name },
  };
  const hash = operationHash({
    actorId,
    session: record.id,
    revision,
    command,
    statements,
    parameters,
    name,
    reason,
    policy: config.policyHash,
  });
  // Status lookup by request ID precedes review expiry/state checks; never replay a commit.
  const existing = await store.existing(
    actorId,
    typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined,
    hash,
  );
  if (existing) {
    res.status(202).json(existing);
    return;
  }
  if (
    record.revision !== revision ||
    !['idle', 'aborted'].includes(record.state)
  )
    throw new WorkspaceError(
      409,
      'SESSION_CHANGED',
      'The transaction state changed. Refresh before reviewing another command.',
    );
  if (body.action === 'review') {
    const review = createReview(
      hash,
      actorId,
      config.limits.reviewTokenTtlSeconds,
    );
    await store.audit(
      actorId,
      'session_command_reviewed',
      {
        hash,
        session: record.id,
        command,
        reason,
        affectedRows: record.affectedRows,
      },
      record.targetId,
    );
    res.json({
      ...review,
      hash,
      command,
      sql: statements.map((s) => s.sql).join(';\n'),
      affectedRows: record.affectedRows,
      revision,
    });
    return;
  }
  if (
    typeof body.idempotencyKey !== 'string' ||
    !/^[0-9a-f-]{36}$/i.test(body.idempotencyKey)
  )
    throw new WorkspaceError(
      400,
      'REQUEST_ID_REQUIRED',
      'Supply a unique request ID.',
    );
  const nonce = reviewed
    ? verifyReview(body.reviewToken, hash, actorId)
    : undefined;
  res.status(202).json(
    await store.enqueue(commandPayload, hash, body.idempotencyKey, nonce, {
      id: record.id,
      revision,
    }),
  );
});
