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
  prepareMaintenance,
  parseDDL,
  schemaStateHash,
} from '../services/databaseWorkspace/administration.js';
import {
  createReview,
  verifyReview,
} from '../services/databaseWorkspace/reviews.js';
import {
  WorkspaceError,
  type JobPayload,
} from '../services/databaseWorkspace/types.js';
import {
  schemaSnapshot,
  compareSchemas,
} from '../services/databaseWorkspace/schemaTools.js';
import {
  privilegeSnapshot,
  preparePrivilege,
  prepareRoleChange,
} from '../services/databaseWorkspace/privileges.js';

const protectedIdentities = (
  credentials: Record<string, unknown>,
): string[] => {
  const control = process.env.DB_WORKSPACE_CONTROL_URL;
  return [
    ...new Set([
      'postgres',
      process.env.DB_USER || '',
      control ? decodeURIComponent(new URL(control).username) : '',
      ...Object.values(credentials).flatMap((v) =>
        Object.values(v as Record<string, { user?: string }>).map(
          (c) => c.user || '',
        ),
      ),
    ]),
  ].filter(Boolean);
};
export const privilegesInspect = workspaceHandler(async (req, res) => {
  await workspaceAccess(req, 'privileges');
  const config = await workspaceConfiguration(),
    { target, credential } = targetCredential(
      config,
      String(req.query.targetId || ''),
      'read',
    );
  res.json(
    await privilegeSnapshot(
      target,
      credential,
      protectedIdentities(config.credentials),
    ),
  );
});

export const schemaInspect = workspaceHandler(async (req, res) => {
  await workspaceAccess(req, 'schema');
  const config = await workspaceConfiguration(),
    { target, credential } = targetCredential(
      config,
      String(req.query.targetId || ''),
      'read',
    );
  res.json(await schemaSnapshot(target, credential, config.protectedObjects));
});
export const schemaCompare = workspaceHandler(async (req, res) => {
  const actorId = await workspaceAccess(req, 'schema'),
    config = await workspaceConfiguration(),
    source = targetCredential(config, String(req.body?.sourceId || ''), 'read'),
    target = targetCredential(config, String(req.body?.targetId || ''), 'read');
  if (source.target.major !== target.target.major)
    throw new WorkspaceError(
      409,
      'COMPARE_VERSION',
      'Compare targets with the same supported PostgreSQL major.',
    );
  const [a, b] = await Promise.all([
    schemaSnapshot(source.target, source.credential, config.protectedObjects),
    schemaSnapshot(target.target, target.credential, config.protectedObjects),
  ]);
  const result = compareSchemas(a, b, req.body.includeDrops === true);
  await controlStore().audit(actorId, 'schemas_compared', {
    source: a.targetId,
    target: b.targetId,
    sourceHash: a.hash,
    targetHash: b.hash,
    changes: result.changes.length,
  });
  res.json(result);
});

export const adminOperation = workspaceHandler(async (req, res) => {
  const kind = String(req.body?.kind || ''),
    action =
      kind === 'ddl'
        ? 'schema'
        : kind === 'signal'
          ? req.body.terminate === true
            ? 'terminate'
            : 'cancelOthers'
          : ['privilege', 'role'].includes(kind)
            ? 'privileges'
            : 'maintenance';
  const actorId = await workspaceAccess(req, action),
    config = await workspaceConfiguration(),
    store = controlStore();
  const {
    action: _action,
    reviewToken: _review,
    idempotencyKey: _key,
    ...requestBody
  } = req.body || {};
  const requestHash = operationHash({ actorId, requestBody });
  if (
    req.body.action === 'execute' &&
    typeof req.body.idempotencyKey === 'string'
  ) {
    const existing = await store.existingRequest(
      actorId,
      req.body.idempotencyKey,
      requestHash,
    );
    if (existing) {
      res.status(202).json(existing);
      return;
    }
  }
  const selected = targetCredential(
      config,
      String(req.body?.targetId || ''),
      'maintenance',
    ),
    target = selected.target,
    read = targetCredential(config, target.id, 'read');
  let credential = selected.credential;
  const policy = getConfigValue('DB_WORKSPACE_MAINTENANCE_POLICY') as {
    operations?: string[];
    timeoutMs?: number;
    protectedApplications?: string[];
  };
  if (!Array.isArray(policy?.operations) || !policy.operations.includes(kind))
    throw new WorkspaceError(
      403,
      'ADMIN_POLICY',
      'This administration operation is not enabled in the Control Panel maintenance policy.',
    );
  const reason =
    typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
  if (reason.length < 5 || reason.length > 1000)
    throw new WorkspaceError(
      400,
      'REASON_REQUIRED',
      'Explain this administration operation.',
    );
  let operation: NonNullable<JobPayload['administration']>;
  if (kind === 'ddl') {
    const parsed = await parseDDL(
      req.body.sql,
      target,
      config.limits.queryMaxBytes,
      config.limits.batchMaxStatements,
      config.protectedObjects,
    );
    operation = {
      kind,
      sql: parsed.sql,
      atomic: parsed.atomic,
      action,
      schemaHash: await schemaStateHash(target, read.credential),
      lockRelations: parsed.lockRelations,
    };
  } else if (kind === 'privilege')
    operation = await preparePrivilege(
      target,
      read.credential,
      config.protectedObjects,
      protectedIdentities(config.credentials),
      req.body,
    );
  else if (kind === 'role') {
    const roleAdmin = (
      config.credentials[target.id] as {
        roleAdmin?: { user?: string; password?: string };
      }
    ).roleAdmin;
    if (!roleAdmin?.user || !roleAdmin.password)
      throw new WorkspaceError(
        503,
        'ROLE_ADMIN_IDENTITY',
        'Configure the separate restricted CREATEROLE identity before using role-management operations.',
      );
    credential = { user: roleAdmin.user, password: roleAdmin.password };
    operation = await prepareRoleChange(
      target,
      read.credential,
      protectedIdentities(config.credentials),
      req.body,
    );
  } else
    operation = await prepareMaintenance(
      target,
      read.credential,
      config.protectedObjects,
      req.body,
      selected.credential.user,
    );
  operation = { ...operation, action };
  if (operation.signal) {
    const application = operation.signal.applicationName,
      serviceRoles = Object.values(config.credentials).flatMap((v) =>
        Object.values(v as Record<string, { user?: string }>).map(
          (c) => c.user,
        ),
      );
    if (
      serviceRoles.includes(operation.signal.user) ||
      application.startsWith('omnilodge-workspace') ||
      (policy.protectedApplications || []).some((p) =>
        application.startsWith(p),
      )
    )
      throw new WorkspaceError(
        403,
        'PROTECTED_SESSION',
        'Use the owning job cancellation or infrastructure maintenance controls for this protected service session.',
      );
  }
  const timeout = Number(policy.timeoutMs ?? 120000);
  if (!Number.isSafeInteger(timeout) || timeout < 1000 || timeout > 900000)
    throw new WorkspaceError(
      503,
      'ADMIN_POLICY',
      'Maintenance timeout must be between 1000 and 900000 ms.',
    );
  const hash = operationHash({
    actorId,
    target: target.id,
    operation,
    reason,
    policy: config.policyHash,
  });
  if (req.body.action !== 'execute') {
    const review = createReview(
      hash,
      actorId,
      config.limits.reviewTokenTtlSeconds,
    );
    await store.audit(
      actorId,
      'administration_reviewed',
      { hash, operation, reason },
      target.id,
    );
    res.json({
      ...review,
      hash,
      target: publicTarget(target),
      operation,
      timeoutMs: timeout,
      reason,
      warning:
        kind === 'ddl'
          ? 'Direct changes create schema drift. Prepare a repository migration; migration tracking will not be modified.'
          : !operation.atomic
            ? 'This operation is not atomic. Cancellation may require a post-check before retrying.'
            : 'This operation uses one database transaction.',
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
      'Use a unique operation request ID.',
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
        statements: [],
        parameters: [],
        mode: 'maintenance',
        reason,
        limits: { ...config.limits, jobMaxDurationMs: timeout },
        policyHash: config.policyHash,
        protectedObjects: config.protectedObjects,
        administration: operation,
        requestHash,
      },
      hash,
      req.body.idempotencyKey,
      nonce,
    ),
  );
});
