import { targetClient } from './connection.js';
import { schemaStateHash } from './administration.js';
import { privilegeStateHash } from './privileges.js';
import { quoteIdentifier } from './filters.js';
import { NETWORK_FUNCTION_PATTERN } from './functionBoundary.js';
import {
  WorkspaceError,
  errorInfo,
  type Credential,
  type JobPayload,
  type JobRecord,
  type StatementOutcome,
  type TransactionOutcome,
} from './types.js';
import type { WorkspaceStore } from './store.js';

export async function runMaintenance(
  store: WorkspaceStore,
  job: JobRecord,
  payload: JobPayload,
  authorize: () => Promise<void>,
  inspectionCredential: Credential,
): Promise<void> {
  const operation = payload.administration;
  if (!operation) {
    await store.finish(job, 'failed', 'not_started', [], {
      code: 'INVALID_ADMIN_JOB',
      message: 'Administration operation is missing.',
    });
    return;
  }
  const client = targetClient(
      payload.target,
      payload.credential,
      `omnilodge-workspace:${job.id}`,
    ),
    outcomes: StatementOutcome[] = [];
  let connected = false,
    transaction = false,
    committing = false,
    completed = 0,
    cancelled = false,
    leaseLost = false,
    checking = false,
    backend: { pid: number; start: string } | undefined;
  let committed = false;
  const warnings: string[] = [];
  client.on('notice', (notice: { severity?: string; message?: string }) => {
    if (notice.severity === 'WARNING' && warnings.length < 20)
      warnings.push((notice.message || 'PostgreSQL warning').slice(0, 2000));
  });
  const deadline = Date.now() + payload.limits.jobMaxDurationMs;
  const timer = setInterval(() => {
    if (checking) return;
    checking = true;
    void (async () => {
      const state = await store.heartbeat(
        job.id,
        job.workerId!,
        job.generation,
      );
      if (!state) leaseLost = true;
      if (
        leaseLost ||
        state?.status === 'cancel_requested' ||
        Date.now() > deadline
      ) {
        cancelled = true;
        if (backend) {
          const cancel = targetClient(
            payload.target,
            payload.credential,
            'omnilodge-workspace-maintenance-cancel',
          );
          try {
            await cancel.connect();
            await cancel.query(
              'SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE pid=$1 AND backend_start=$2::timestamptz AND application_name=$3',
              [backend.pid, backend.start, `omnilodge-workspace:${job.id}`],
            );
          } finally {
            await cancel.end().catch(() => {});
          }
        }
      }
    })()
      .catch(() => {
        leaseLost = true;
        cancelled = true;
        void client.end().catch(() => {});
      })
      .finally(() => {
        checking = false;
      });
  }, 500);
  timer.unref();
  try {
    await authorize();
    await client.connect();
    connected = true;
    client.on('error', () => {
      leaseLost = true;
    });
    const identity = await client.query(
      `SELECT current_database() AS database,current_setting('server_version_num')::int/10000 AS major,
      r.rolsuper,r.rolbypassrls,r.rolreplication,r.rolcreaterole,r.rolcreatedb,
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.proname~$1 AND has_schema_privilege(n.oid,'USAGE') AND has_function_privilege(p.oid,'EXECUTE')) AS unsafe_network_grant,
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=ANY($2::text[]) AND p.prosecdef AND has_function_privilege(p.oid,'EXECUTE')) AS unsafe_definer_grant
      FROM pg_roles r WHERE r.rolname=current_user`,
      [NETWORK_FUNCTION_PATTERN, payload.target.schemas],
    );
    const role = identity.rows[0];
    if (
      !role ||
      role.database !== payload.target.database ||
      Number(role.major) !== payload.target.major ||
      role.rolsuper ||
      role.rolbypassrls ||
      role.rolreplication ||
      (role.rolcreaterole && operation.kind !== 'role') ||
      role.rolcreatedb ||
      role.unsafe_network_grant ||
      role.unsafe_definer_grant
    )
      throw new WorkspaceError(
        503,
        'UNSAFE_MAINTENANCE_IDENTITY',
        'Provision a dedicated nonsuperuser maintenance identity without database creation, replication or RLS bypass. CREATEROLE is permitted only for the separate role-management wizard identity.',
      );
    backend = (
      await client.query(
        'SELECT pg_backend_pid() AS pid,backend_start::text AS start FROM pg_stat_activity WHERE pid=pg_backend_pid()',
      )
    ).rows[0];
    await store.backend(
      job.id,
      job.workerId!,
      job.generation,
      backend!.pid,
      backend!.start,
    );
    await client.query(
      "SELECT set_config('statement_timeout',$1,false),set_config('lock_timeout',$2,false)",
      [
        String(payload.limits.jobMaxDurationMs),
        String(payload.limits.lockTimeoutMs),
      ],
    );
    if (operation.atomic) {
      await client.query('BEGIN');
      transaction = true;
      if (operation.lockRelations?.length) {
        const relations = await client.query(
          `SELECT DISTINCT c.oid,n.nspname,c.relname FROM pg_class referenced
          LEFT JOIN pg_index i ON i.indexrelid=referenced.oid JOIN pg_class c ON c.oid=COALESCE(i.indrelid,referenced.oid) JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE referenced.oid=ANY(ARRAY(SELECT to_regclass(name) FROM unnest($1::text[]) name)) AND c.relkind IN ('r','p','v','m') ORDER BY c.oid`,
          [operation.lockRelations],
        );
        for (const relation of relations.rows)
          await client.query(
            `LOCK TABLE ONLY ${quoteIdentifier(relation.nspname)}.${quoteIdentifier(relation.relname)} IN ACCESS EXCLUSIVE MODE`,
          );
      }
    }
    if (
      operation.schemaHash &&
      (await schemaStateHash(payload.target, inspectionCredential)) !==
        operation.schemaHash
    )
      throw new WorkspaceError(
        409,
        'SCHEMA_CHANGED',
        'The schema changed after review. Refresh and prepare a new operation.',
      );
    if (
      operation.privilegeHash &&
      (await privilegeStateHash(payload.target, inspectionCredential)) !==
        operation.privilegeHash
    )
      throw new WorkspaceError(
        409,
        'PRIVILEGES_CHANGED',
        'Roles, memberships or object grants changed after review. Refresh and review the new state.',
      );
    if (operation.signal) {
      const s = operation.signal;
      const result = await client.query(
        `SELECT ${s.terminate ? 'pg_terminate_backend' : 'pg_cancel_backend'}(pid) AS signalled FROM pg_stat_activity
        WHERE pid=$1 AND backend_start=$2::timestamptz AND query_start=$3::timestamptz AND application_name=$4 AND usename=$5 AND datname=$6
        AND backend_type='client backend' AND pid<>pg_backend_pid()`,
        [
          s.pid,
          s.backendStart,
          s.queryStart,
          s.applicationName,
          s.user,
          payload.target.database,
        ],
      );
      if (!result.rowCount)
        throw new WorkspaceError(
          409,
          'SESSION_CHANGED',
          'That session or its current query changed. Refresh and review the current identity.',
        );
      if (!result.rows[0].signalled)
        throw new WorkspaceError(
          409,
          'SIGNAL_NOT_SENT',
          'PostgreSQL did not accept the session signal.',
        );
      completed = 1;
    }
    for (let index = 0; index < operation.sql.length; index++) {
      await authorize();
      if (cancelled)
        throw new WorkspaceError(409, 'CANCELLED', 'Maintenance cancelled.');
      const started = Date.now(),
        sql = operation.sql[index];
      try {
        const result = await client.query(sql);
        completed++;
        if (warnings.length)
          throw new WorkspaceError(
            409,
            'MAINTENANCE_WARNING',
            warnings.join('; '),
          );
        outcomes.push({
          index,
          sql,
          sourceStart: 0,
          sourceEnd: sql.length,
          kind: operation.kind,
          command: Array.isArray(result) ? 'DDL' : result.command,
          durationMs: Date.now() - started,
        });
        await store.progress(job, outcomes);
      } catch (error) {
        outcomes.push({
          index,
          sql,
          sourceStart: 0,
          sourceEnd: sql.length,
          kind: operation.kind,
          durationMs: Date.now() - started,
          error: errorInfo(error),
        });
        throw error;
      }
    }
    await authorize();
    if (cancelled)
      throw new WorkspaceError(
        409,
        'CANCELLED',
        'Maintenance cancelled before finalization.',
      );
    if (transaction) {
      committing = true;
      await client.query('COMMIT');
      transaction = false;
      committing = false;
      committed = true;
    }
    // Concurrent index work can leave invalid indexes after cancellation/failure.
    if (operation.postCheck) {
      const check = await client.query(
        'SELECT indexrelid::regclass::text AS name FROM pg_index WHERE indrelid=$1::oid AND (NOT indisvalid OR NOT indisready)',
        [operation.postCheck.oid],
      );
      if (check.rowCount)
        throw new WorkspaceError(
          409,
          'POSTCHECK_REQUIRED',
          'Maintenance finished but invalid/unready indexes remain. Inspect the index health view before retrying.',
        );
    }
    await store.finish(
      job,
      'succeeded',
      operation.atomic ? 'committed' : 'not_applicable',
      outcomes,
    );
    if (operation.kind === 'ddl')
      await store.audit(
        payload.actorId,
        'schema_drift_recorded',
        {
          jobId: job.id,
          reason: payload.reason,
          followUp:
            'Prepare and commit a repository migration; migration tracking was not changed.',
        },
        payload.target.id,
        job.id,
      );
  } catch (error) {
    let outcome: TransactionOutcome = committed
      ? 'committed'
      : committing || leaseLost
        ? 'unknown'
        : transaction
          ? 'unknown'
          : completed
            ? 'partial'
            : 'not_started';
    if (transaction && !committing && !leaseLost && connected) {
      try {
        await client.query('ROLLBACK');
        outcome = 'rolled_back';
      } catch {
        outcome = 'unknown';
      }
    }
    await store
      .finish(
        job,
        outcome === 'unknown'
          ? 'outcome_unknown'
          : cancelled
            ? 'cancelled'
            : 'failed',
        outcome,
        outcomes,
        errorInfo(error),
      )
      .catch(() => {});
    if (!operation.atomic && operation.postCheck)
      await store
        .audit(
          payload.actorId,
          'maintenance_postcheck_required',
          { oid: operation.postCheck.oid, operation: operation.kind },
          payload.target.id,
          job.id,
        )
        .catch(() => {});
  } finally {
    clearInterval(timer);
    while (checking) await new Promise((resolve) => setTimeout(resolve, 10));
    await client.end().catch(() => {});
  }
}
