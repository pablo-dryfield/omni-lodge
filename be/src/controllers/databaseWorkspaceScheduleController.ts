import { workspaceHandler } from './databaseWorkspaceController.js';
import {
  workspaceAccess,
  reauthorizeExecution,
} from '../services/databaseWorkspace/access.js';
import {
  workspaceConfiguration,
  targetCredential,
} from '../services/databaseWorkspace/config.js';
import { getConfigValue } from '../services/configService.js';
import {
  controlStore,
  opened,
  operationHash,
} from '../services/databaseWorkspace/store.js';
import {
  validateSchedule,
  listSchedules,
  saveSchedule,
  nextOccurrence,
  type ScheduledPayload,
} from '../services/databaseWorkspace/schedules.js';
import { parseSql } from '../services/databaseWorkspace/parser.js';
import {
  createReview,
  verifyReview,
} from '../services/databaseWorkspace/reviews.js';
import { WorkspaceError } from '../services/databaseWorkspace/types.js';
import { prepareMaintenance } from '../services/databaseWorkspace/administration.js';

export const schedulesList = workspaceHandler(async (req, res) => {
  const actor = await workspaceAccess(req, 'schedule');
  res.json(await listSchedules(controlStore(), actor));
});
export const scheduleCreate = workspaceHandler(async (req, res) => {
  const actorId = await workspaceAccess(req, 'schedule'),
    config = await workspaceConfiguration(),
    store = controlStore(),
    body = req.body || {};
  const doc = (await store.documents(actorId, 'query')).find(
      (d) => d.id === body.documentId,
    ),
    template = ['analyze', 'vacuum', 'reindex', 'refresh'].includes(
      body.template,
    )
      ? String(body.template)
      : '',
    mode = template ? 'maintenance' : body.mode === 'write' ? 'write' : 'read';
  await workspaceAccess(req, mode);
  if (!doc && !template)
    throw new WorkspaceError(
      404,
      'SCHEDULE_QUERY',
      'Save a versioned query before scheduling it.',
    );
  const value = (doc?.value || {}) as {
      sql?: string;
      targetId?: string;
      title?: string;
    },
    spec = validateSchedule(body.spec),
    reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 5 || reason.length > 1000)
    throw new WorkspaceError(
      400,
      'REASON_REQUIRED',
      'Explain this recurring operation.',
    );
  const { target, credential } = targetCredential(
      config,
      String(template ? body.targetId || '' : value.targetId || ''),
      mode,
    ),
    statements = template
      ? []
      : await parseSql(value.sql, target.major, {
          maxBytes: config.limits.queryMaxBytes,
          maxStatements: config.limits.batchMaxStatements,
          mode,
          schemas: target.schemas,
          protectedObjects: config.protectedObjects,
        });
  if (statements.some((s) => s.parameterCount))
    throw new WorkspaceError(
      400,
      'SCHEDULE_PARAMETERS',
      'Save a parameter-free scheduling query. Parameter values are never silently copied from an interactive tab.',
    );
  let administration;
  if (template) {
    const policy = getConfigValue('DB_WORKSPACE_MAINTENANCE_POLICY') as {
      operations?: string[];
    };
    if (!policy.operations?.includes(template))
      throw new WorkspaceError(
        403,
        'ADMIN_POLICY',
        'This maintenance template is disabled in Control Panel.',
      );
    const read = targetCredential(config, target.id, 'read');
    administration = await prepareMaintenance(
      target,
      read.credential,
      config.protectedObjects,
      { ...body, kind: template },
      credential.user,
    );
  }
  const payload: ScheduledPayload = {
    title: template
      ? `${template}: ${administration!.sql[0]}`
      : value.title || 'Scheduled query',
    spec,
    documentId: template ? undefined : doc!.id,
    documentRevision: template ? undefined : doc!.revision,
    version: 1,
    job: {
      actorId,
      target,
      credential,
      statements,
      parameters: [],
      mode,
      reason,
      limits: config.limits,
      policyHash: config.policyHash,
      protectedObjects: config.protectedObjects,
      administration,
    },
  };
  const hash = operationHash(payload);
  if (body.action !== 'create') {
    const review = createReview(
      hash,
      actorId,
      config.limits.reviewTokenTtlSeconds,
    );
    await store.audit(
      actorId,
      'schedule_reviewed',
      {
        hash,
        spec,
        documentId: doc?.id,
        documentRevision: doc?.revision,
        reason,
      },
      target.id,
    );
    res.json({
      ...review,
      hash,
      title: payload.title,
      sql: template ? administration!.sql.join(';\n') : value.sql,
      mode,
      spec,
      nextRun: nextOccurrence(new Date(), spec),
      documentRevision: doc?.revision,
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
      'Use a unique schedule request ID.',
    );
  const prior = await store.pool.query(
    'SELECT * FROM database_workspace.review_uses WHERE actor_id=$1 AND idempotency_key=$2',
    [actorId, body.idempotencyKey],
  );
  if (prior.rowCount) {
    if (prior.rows[0].operation_hash !== hash)
      throw new WorkspaceError(
        409,
        'IDEMPOTENCY_CONFLICT',
        'That request ID belongs to another schedule.',
      );
    res.json({ id: prior.rows[0].result_id });
    return;
  }
  const nonce = verifyReview(body.reviewToken, hash, actorId),
    c = await store.pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock($1)', [actorId]);
    const used = await c.query(
      'SELECT * FROM database_workspace.review_uses WHERE nonce=$1',
      [nonce],
    );
    if (used.rowCount) {
      if (
        used.rows[0].actor_id == actorId &&
        used.rows[0].idempotency_key === body.idempotencyKey &&
        used.rows[0].operation_hash === hash
      ) {
        await c.query('COMMIT');
        res.json({ id: used.rows[0].result_id });
        return;
      }
      throw new WorkspaceError(
        409,
        'REVIEW_ALREADY_USED',
        'This schedule approval was already submitted.',
      );
    }
    const id = await saveSchedule(
      store,
      actorId,
      payload,
      Number(getConfigValue('DB_WORKSPACE_SCHEDULE_MAX_PER_USER')),
      c,
    );
    await c.query(
      'INSERT INTO database_workspace.review_uses(nonce,actor_id,operation_hash,result_id,idempotency_key) VALUES($1,$2,$3,$4,$5)',
      [nonce, actorId, hash, id, body.idempotencyKey],
    );
    await c.query('COMMIT');
    res.status(201).json({ id });
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
});
export const scheduleAction = workspaceHandler(async (req, res) => {
  const actor = await workspaceAccess(req, 'schedule'),
    store = controlStore(),
    id = String(req.params.id),
    row = (
      await store.pool.query(
        'SELECT * FROM database_workspace.schedules WHERE id=$1 AND actor_id=$2',
        [id, actor],
      )
    ).rows[0];
  if (!row)
    throw new WorkspaceError(404, 'SCHEDULE_NOT_FOUND', 'Schedule not found.');
  const payload = opened<ScheduledPayload>(row.payload),
    action = req.body?.action;
  if (action === 'history') {
    res.json(
      (
        await store.pool.query(
          'SELECT scheduled_for,state,job_id,detail,created_at FROM database_workspace.schedule_runs WHERE schedule_id=$1 ORDER BY scheduled_for DESC LIMIT 100',
          [id],
        )
      ).rows,
    );
    return;
  }
  if (action === 'delete') {
    await store.pool.query(
      'DELETE FROM database_workspace.schedules WHERE id=$1 AND actor_id=$2',
      [id, actor],
    );
  } else if (action === 'pause') {
    await store.pool.query(
      "UPDATE database_workspace.schedules SET enabled=false,disabled_reason='Paused by owner',revision=revision+1 WHERE id=$1",
      [id],
    );
  } else if (['resume', 'runNow'].includes(action)) {
    await reauthorizeExecution(
      actor,
      payload.job.mode,
      payload.job.policyHash,
      'schedule',
    );
    const document = (await store.documents(actor, 'query')).find(
      (d) => d.id === payload.documentId,
    );
    if (payload.documentId && document?.revision !== payload.documentRevision)
      throw new WorkspaceError(
        409,
        'SCHEDULE_QUERY_CHANGED',
        'The saved query changed. Create a newly reviewed schedule for its new revision.',
      );
    await store.pool.query(
      'UPDATE database_workspace.schedules SET enabled=true,disabled_reason=NULL,next_run=$2,revision=revision+1 WHERE id=$1',
      [
        id,
        action === 'runNow'
          ? new Date()
          : nextOccurrence(new Date(), payload.spec),
      ],
    );
  } else
    throw new WorkspaceError(
      400,
      'SCHEDULE_ACTION',
      'Choose Pause, Resume, Run now, History or Delete.',
    );
  await store.audit(actor, `schedule_${action}`, { id }, row.target_id);
  res.status(204).end();
});
