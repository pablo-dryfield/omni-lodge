import type pg from 'pg';
import { operationHash, type WorkspaceStore } from './store.js';
import { targetClient, assertRestrictedIdentity } from './connection.js';
import { WorkspaceError, type JobPayload } from './types.js';
import { quoteIdentifier } from './filters.js';

// Bind captured data to the actual execution role, memberships, grants and RLS definitions.
// This is intentionally stricter than simply checking that the creator is still an administrator.
export async function authorizationSnapshot(
  client: pg.Client,
  payload: JobPayload,
): Promise<string> {
  const names = [
    ...new Set(
      payload.statements.flatMap((s) =>
        s.relations.map(
          (r) => `${quoteIdentifier(r.schema)}.${quoteIdentifier(r.name)}`,
        ),
      ),
    ),
  ].sort();
  const role =
    await client.query(`SELECT current_user,current_setting('row_security') AS row_security,
    ARRAY(SELECT rolname FROM pg_roles WHERE pg_has_role(current_user,oid,'MEMBER') ORDER BY rolname) AS memberships`);
  const relations = await client.query(
    `WITH RECURSIVE scope(oid) AS (
      SELECT to_regclass(name)::oid FROM unnest($1::text[]) name
      UNION SELECT d.refobjid FROM scope s
        JOIN LATERAL (SELECT r.oid,'pg_rewrite'::regclass AS classid FROM pg_rewrite r WHERE r.ev_class=s.oid
          UNION ALL SELECT p.oid,'pg_policy'::regclass FROM pg_policy p WHERE p.polrelid=s.oid) definition ON true
        JOIN pg_depend d ON d.classid=definition.classid AND d.objid=definition.oid AND d.refclassid='pg_class'::regclass
    ) SELECT c.oid::text,c.relowner,c.reloptions,c.relrowsecurity,c.relforcerowsecurity,
    CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid) END AS definition,
    has_table_privilege(c.oid,'SELECT') AS selectable,
    COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_policy p WHERE p.polrelid=c.oid),'[]'::jsonb) AS policies,
    c.relacl::text FROM pg_class c WHERE c.oid IN(SELECT oid FROM scope) ORDER BY c.oid`,
    [names],
  );
  return operationHash({ role: role.rows, relations: relations.rows });
}
export async function authorizeResult(
  store: WorkspaceStore,
  executionId: string,
  actorId: number,
): Promise<JobPayload> {
  const { workspaceConfiguration, targetCredential } = await import(
    './config.js'
  );
  const { reauthorizeExecution } = await import('./access.js');
  const payload = await store.privatePayload(executionId, actorId);
  await reauthorizeExecution(actorId, payload.mode, payload.policyHash);
  const config = await workspaceConfiguration(),
    { target, credential } = targetCredential(
      config,
      payload.target.id,
      payload.mode,
    );
  const expected = await store.authorizationContext(executionId, actorId);
  if (!expected)
    throw new WorkspaceError(
      410,
      'RESULT_CONTEXT_UNAVAILABLE',
      'This result has no verified authorization context. Capture a new permitted result.',
    );
  const client = targetClient(
    target,
    credential,
    'omnilodge-workspace-result-access',
  );
  try {
    await client.connect();
    await assertRestrictedIdentity(client, target);
    if ((await authorizationSnapshot(client, payload)) !== expected)
      throw new WorkspaceError(
        403,
        'RESULT_AUTHORITY_CHANGED',
        'Database grants or row-security context changed. Capture a new permitted result.',
      );
  } finally {
    await client.end().catch(() => {});
  }
  return payload;
}
export async function reconcileOrphans(store: WorkspaceStore): Promise<void> {
  for (const row of await store.unreconciled()) {
    if (!row.pid || !row.start) {
      await store.reconciled(row.id);
      continue;
    }
    const recovery = row.payload.recovery,
      credential = recovery?.credential || row.payload.credential;
    const client = targetClient(
      recovery
        ? { ...row.payload.target, database: recovery.adminDatabase }
        : row.payload.target,
      credential,
      'omnilodge-workspace-orphan-reconcile',
    );
    try {
      await client.connect();
      const exact = await client.query(
        'SELECT pid FROM pg_stat_activity WHERE pid=$1 AND backend_start=$2::timestamptz AND application_name=$3',
        [row.pid, row.start, `omnilodge-workspace:${row.id}`],
      );
      if (exact.rowCount)
        await client.query(
          'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid=$1 AND backend_start=$2::timestamptz AND application_name=$3',
          [row.pid, row.start, `omnilodge-workspace:${row.id}`],
        );
      if (recovery)
        await client.query(
          'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name=$1 AND usename=$2 AND datname=$3',
          [
            `omnilodge-workspace:${row.id}:restore`,
            credential.user,
            recovery.destination,
          ],
        );
      const remaining = await client.query(
        'SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND backend_start=$2::timestamptz',
        [row.pid, row.start],
      );
      const restoreRemaining = recovery
        ? await client.query(
            'SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND usename=$2 AND datname=$3',
            [
              `omnilodge-workspace:${row.id}:restore`,
              credential.user,
              recovery.destination,
            ],
          )
        : undefined;
      if (!remaining.rowCount && !restoreRemaining?.rowCount) {
        if (recovery)
          await (
            await import('./recovery.js')
          ).cleanupRecoveryPlaintext(row.payload, row.id);
        await store.reconciled(row.id);
      }
    } catch {
      /* Preserve the admission slot until the old backend is proven gone. */
    } finally {
      await client.end().catch(() => {});
    }
  }
}
