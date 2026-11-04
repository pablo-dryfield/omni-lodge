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
  operationHash,
} from '../services/databaseWorkspace/store.js';
import { authorizeResult } from '../services/databaseWorkspace/resultAccess.js';
import { readResult } from '../services/databaseWorkspace/artifacts.js';
import { WorkspaceError } from '../services/databaseWorkspace/types.js';
import User from '../models/User.js';
import UserType from '../models/UserType.js';

export const downloadResult = workspaceHandler(async (req, res) => {
  const actorId = await workspaceAccess(req, 'export'),
    store = controlStore(),
    executionId = String(req.params.id),
    index = Number(req.query.index || 0),
    format = String(req.query.format || '');
  if (
    !['csv', 'json', 'sql'].includes(format) ||
    !Number.isSafeInteger(index) ||
    index < 0
  )
    throw new WorkspaceError(
      400,
      'EXPORT_FORMAT',
      'Choose CSV, lossless JSON or SQL data.',
    );
  const payload = await authorizeResult(store, executionId, actorId),
    first = await readResult(store, executionId, index, actorId, {
      pageSize: 500,
    });
  const write = async (value: string) => {
    if (res.destroyed)
      throw new WorkspaceError(
        499,
        'DOWNLOAD_CLOSED',
        'Download connection closed.',
      );
    if (!res.write(value))
      await new Promise<void>((resolve, reject) => {
        const clean = () => {
          res.off('drain', drained);
          res.off('close', closed);
          res.off('error', closed);
        };
        const drained = () => {
          clean();
          resolve();
        };
        const closed = () => {
          clean();
          reject(
            new WorkspaceError(
              499,
              'DOWNLOAD_CLOSED',
              'Download connection closed.',
            ),
          );
        };
        res.once('drain', drained);
        res.once('close', closed);
        res.once('error', closed);
        if (res.destroyed) closed();
      });
  };
  const csv = (value: string) =>
    `"${(/^[\s\u0000-\u001f]*[=+@-]/.test(value) ? "'" + value : value).replace(/"/g, '""')}"`;
  const ident = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const literal = (value: string | null, i: number) =>
    `${value === null ? 'NULL' : `E'${value.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`}::${ident(first.fields[i].pgTypeSchema || 'pg_catalog')}.${ident(first.fields[i].pgType)}`;
  await store.audit(
    actorId,
    'result_download_started',
    {
      format,
      index,
      scope: 'all captured rows',
      rows: first.capturedRows,
      complete: first.complete,
    },
    payload.target.id,
    executionId,
  );
  res.setHeader(
    'Content-Type',
    format === 'json'
      ? 'application/json'
      : format === 'csv'
        ? 'text/csv;charset=utf-8'
        : 'text/plain;charset=utf-8',
  );
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="database-result-${executionId}.${format}"`,
  );
  try {
    if (format === 'json')
      await write(`{"fields":${JSON.stringify(first.fields)},"rows":[`);
    else if (format === 'csv')
      await write(
        '\uFEFF' + first.fields.map((f) => csv(f.name)).join(',') + '\r\n',
      );
    else
      await write(
        `-- Captured PostgreSQL data; ${first.complete ? 'complete' : 'limited'} capture. Review before execution.\n${first.capturedRows ? 'VALUES\n' : '-- No rows.\n'}`,
      );
    let count = 0;
    for (let page = 0; ; page++) {
      if (page) {
        await reauthorizeExecution(
          actorId,
          payload.mode,
          payload.policyHash,
          'export',
        );
        await authorizeResult(store, executionId, actorId);
      }
      const batch = page
        ? await readResult(store, executionId, index, actorId, {
            page,
            pageSize: 500,
          })
        : first;
      for (const row of batch.rows) {
        if (format === 'json')
          await write(`${count ? ',' : ''}${JSON.stringify(row)}`);
        else if (format === 'csv')
          await write(
            row.map((v) => (v === null ? '\\N' : csv(v))).join(',') + '\r\n',
          );
        else
          await write(`${count ? ',\n' : ''}(${row.map(literal).join(', ')})`);
        count++;
      }
      if (count >= batch.capturedRows || !batch.rows.length) break;
    }
    if (format === 'json')
      await write(`],"scope":"captured-result","complete":${first.complete}}`);
    else if (format === 'sql' && count) await write(';\n');
    res.end();
    await store.audit(
      actorId,
      'result_download_completed',
      { format, index, rows: count },
      payload.target.id,
      executionId,
    );
  } catch {
    res.destroy();
    await store
      .audit(
        actorId,
        'result_download_interrupted',
        { format, index },
        payload.target.id,
        executionId,
      )
      .catch(() => {});
  }
});

export const exportQuery = workspaceHandler(async (req, res) => {
  const actorId = await workspaceAccess(req, 'export');
  await workspaceAccess(req, 'read');
  const original = await authorizeResult(
      controlStore(),
      String(req.body?.executionId || ''),
      actorId,
    ),
    index = Number(req.body?.index || 0),
    statement = original.statements[index];
  if (
    original.mode !== 'read' ||
    original.sessionCommand ||
    !statement ||
    statement.kind !== 'SelectStmt' ||
    statement.mutating
  )
    throw new WorkspaceError(
      400,
      'EXPORT_READ_ONLY',
      'A full export may execute only one original read-only SELECT. Write/RETURNING and expert-session results can only export their captured data.',
    );
  const config = await workspaceConfiguration(),
    { target, credential } = targetCredential(
      config,
      original.target.id,
      'read',
    );
  const limits = {
    ...config.limits,
    resultMaxRows: Number(getConfigValue('DB_WORKSPACE_EXPORT_MAX_ROWS')),
    resultMaxBytes: Number(getConfigValue('DB_WORKSPACE_EXPORT_MAX_BYTES')),
    readTimeoutMs: Number(getConfigValue('DB_WORKSPACE_EXPORT_TIMEOUT_MS')),
    jobMaxDurationMs: Number(getConfigValue('DB_WORKSPACE_EXPORT_TIMEOUT_MS')),
  };
  const job = await controlStore().enqueue(
    {
      ...original,
      actorId,
      target,
      credential,
      statements: [statement],
      mode: 'read',
      reason: 'Explicit full read export at a new database snapshot',
      limits,
      policyHash: config.policyHash,
      tableView: undefined,
    },
    operationHash({
      actorId,
      source: req.body.executionId,
      index,
      limits,
      policy: config.policyHash,
    }),
    String(req.body.idempotencyKey || ''),
  );
  await controlStore().audit(
    actorId,
    'full_export_requested',
    {
      source: req.body.executionId,
      index,
      jobId: job.id,
      rows: limits.resultMaxRows,
      bytes: limits.resultMaxBytes,
    },
    target.id,
    job.id,
  );
  res.status(202).json(job);
});
export const recordExport = workspaceHandler(async (req, res) => {
  const actorId = await workspaceAccess(req, 'export'),
    payload = await authorizeResult(
      controlStore(),
      String(req.params.id),
      actorId,
    );
  await controlStore().audit(
    actorId,
    'result_exported',
    {
      format: String(req.body?.format || 'unknown').slice(0, 20),
      scope: String(req.body?.scope || 'captured').slice(0, 100),
      resultIndex: Number(req.body?.index || 0),
    },
    payload.target.id,
    String(req.params.id),
  );
  res.status(204).end();
});
export const shareRecipients = workspaceHandler(async (req, res) => {
  await workspaceAccess(req, 'export');
  const roles = await UserType.findAll({
    where: { slug: ['admin', 'administrator'], status: true },
    attributes: ['id'],
  });
  const users = await User.findAll({
    where: { userTypeId: roles.map((r) => r.id), status: true, approved: true },
    attributes: ['id', 'firstName', 'lastName'],
  });
  res.json(
    users.map((u) => ({
      id: u.id,
      name: `${u.firstName} ${u.lastName}`.trim(),
    })),
  );
});
type Share = {
  kind: 'result' | 'query';
  recipients: number[];
  ownerId: number;
  executionId?: string;
  index?: number;
  documentId?: string;
  revision?: number;
  title: string;
  policyHash: string;
};
export const createShare = workspaceHandler(async (req, res) => {
  const actorId = await workspaceAccess(req, 'export'),
    config = await workspaceConfiguration(),
    body = req.body || {},
    store = controlStore();
  const recipients = body.recipientIds;
  if (
    !Array.isArray(recipients) ||
    !recipients.length ||
    recipients.length > 20 ||
    recipients.some((id) => !Number.isSafeInteger(id) || id < 1)
  )
    throw new WorkspaceError(
      400,
      'SHARE_RECIPIENTS',
      'Choose 1–20 eligible administrator recipients.',
    );
  for (const recipient of recipients)
    await reauthorizeExecution(recipient, 'read', config.policyHash, 'export');
  let value: Share;
  if (body.kind === 'query') {
    const doc = (await store.documents(actorId, 'query')).find(
      (d) => d.id === body.documentId,
    );
    if (!doc)
      throw new WorkspaceError(
        404,
        'DOCUMENT_NOT_FOUND',
        'Saved query not found.',
      );
    value = {
      kind: 'query',
      recipients,
      ownerId: actorId,
      documentId: doc.id,
      revision: doc.revision,
      title: String((doc.value as { title?: string }).title || 'Shared query'),
      policyHash: config.policyHash,
    };
  } else {
    const payload = await authorizeResult(
      store,
      String(body.executionId || ''),
      actorId,
    );
    if (payload.mode !== 'read' || payload.sessionCommand)
      throw new WorkspaceError(
        403,
        'SHARE_CONTEXT',
        'Only captured results from ordinary read-only jobs can be shared.',
      );
    await readResult(
      store,
      String(body.executionId),
      Number(body.index || 0),
      actorId,
      { pageSize: 1 },
    );
    value = {
      kind: 'result',
      recipients,
      ownerId: actorId,
      executionId: String(body.executionId),
      index: Number(body.index || 0),
      title: 'Shared database result',
      policyHash: config.policyHash,
    };
  }
  const doc = await store.saveDocument(
    actorId,
    { kind: 'share', value },
    config.limits.resultTtlMinutes / 1440,
  );
  await store.audit(
    actorId,
    'share_created',
    { id: doc.id, kind: value.kind, recipients },
    undefined,
    value.executionId,
  );
  res
    .status(201)
    .json({ id: doc.id, path: `/settings/sql-helper?share=${doc.id}` });
});
async function sharedDocument(id: string, actorId: number) {
  const r = await controlStore().pool.query(
    "SELECT actor_id FROM database_workspace.documents WHERE id=$1 AND kind='share' AND (expires_at IS NULL OR expires_at>now())",
    [id],
  );
  if (!r.rowCount)
    throw new WorkspaceError(
      410,
      'SHARE_EXPIRED',
      'This share expired or was revoked.',
    );
  const owner = Number(r.rows[0].actor_id),
    doc = (await controlStore().documents(owner, 'share')).find(
      (d) => d.id === id,
    ),
    share = doc?.value as Share | undefined;
  if (!share || (!share.recipients.includes(actorId) && owner !== actorId))
    throw new WorkspaceError(
      403,
      'SHARE_RECIPIENT',
      'This link is restricted to its named authenticated recipients.',
    );
  await reauthorizeExecution(owner, 'read', share.policyHash, 'export');
  await reauthorizeExecution(actorId, 'read', share.policyHash, 'export');
  return share;
}
export const openShare = workspaceHandler(async (req, res) => {
  const actor = await workspaceAccess(req, 'export'),
    share = await sharedDocument(String(req.params.id), actor),
    store = controlStore();
  if (share.kind === 'query') {
    const doc = (await store.documents(share.ownerId, 'query')).find(
      (d) => d.id === share.documentId,
    );
    if (!doc || doc.revision !== share.revision)
      throw new WorkspaceError(
        409,
        'SHARED_QUERY_CHANGED',
        'The owner changed this query. Ask for a new link to the reviewed revision.',
      );
    res.json({ kind: 'query', title: share.title, query: doc.value });
  } else {
    await authorizeResult(store, share.executionId!, share.ownerId);
    const source = await store.get(share.executionId!, share.ownerId),
      selected = source.outcomes[share.index!];
    if (!selected?.result)
      throw new WorkspaceError(
        410,
        'RESULT_EXPIRED',
        'The shared captured result is unavailable.',
      );
    res.json({
      kind: 'result',
      job: {
        id: source.id,
        actorId: share.ownerId,
        targetId: source.targetId,
        mode: 'read',
        status: source.status,
        transactionOutcome: source.transactionOutcome,
        createdAt: source.createdAt,
        generation: 0,
        summary: share.title,
        statementCount: 1,
        outcomes: [
          {
            index: 0,
            sql: '',
            sourceStart: 0,
            sourceEnd: 0,
            kind: 'read',
            command: selected.command,
            durationMs: selected.durationMs,
            result: selected.result,
          },
        ],
      },
      index: 0,
      title: share.title,
    });
  }
  await store.audit(actor, 'share_opened', {
    id: req.params.id,
    owner: share.ownerId,
    kind: share.kind,
  });
});
export const sharedResult = workspaceHandler(async (req, res) => {
  const actor = await workspaceAccess(req, 'export'),
    share = await sharedDocument(String(req.params.id), actor);
  if (share.kind !== 'result')
    throw new WorkspaceError(400, 'SHARE_KIND', 'This is a query share.');
  await authorizeResult(controlStore(), share.executionId!, share.ownerId);
  res.json(
    await readResult(
      controlStore(),
      share.executionId!,
      share.index!,
      share.ownerId,
      {
        ...req.body,
        pageSize: Math.min(500, Number(req.body?.pageSize || 200)),
      },
    ),
  );
});
export const sharedExportAudit = workspaceHandler(async (req, res) => {
  const actor = await workspaceAccess(req, 'export'),
    share = await sharedDocument(String(req.params.id), actor);
  if (share.kind !== 'result')
    throw new WorkspaceError(
      400,
      'SHARE_KIND',
      'This share does not contain a captured result.',
    );
  await authorizeResult(controlStore(), share.executionId!, share.ownerId);
  await controlStore().audit(
    actor,
    'shared_result_exported',
    {
      shareId: req.params.id,
      ownerId: share.ownerId,
      index: share.index,
      format: String(req.body?.format || '').slice(0, 20),
      scope: String(req.body?.scope || '').slice(0, 100),
    },
    undefined,
    share.executionId,
  );
  res.status(204).end();
});
