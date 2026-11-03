import type { WorkspaceStore } from './store.js';
import { targetClient, assertRestrictedIdentity } from './connection.js';
import { executeStatements } from './execute.js';
import { schemaFingerprint } from './schemaFingerprint.js';
import { authorizationSnapshot } from './resultAccess.js';
import {
  errorInfo,
  WorkspaceError,
  type JobPayload,
  type JobRecord,
  type StatementOutcome,
  type TransactionOutcome,
} from './types.js';

export async function runJob(
  store: WorkspaceStore,
  job: JobRecord,
  payload: JobPayload,
  authorize: () => Promise<void>,
): Promise<void> {
  const client = targetClient(
    payload.target,
    payload.credential,
    `omnilodge-workspace:${job.id}`,
  );
  const outcomes: StatementOutcome[] = [];
  // A lost socket can emit independently of its pending query promise. Keep
  // both paths inside durable outcome handling rather than crashing a worker.
  client.on('error', () => {});
  let transaction = false,
    committing = false,
    committed = false,
    connected = false,
    stopped = false,
    leaseLost = false;
  let backend: { pid: number; start: string } | undefined;
  let authority = '';
  let cancelReason: string | undefined;
  let checking = false;
  const deadline = Date.now() + payload.limits.jobMaxDurationMs;
  const cancel = async (reason: string) => {
    if (cancelReason) return;
    cancelReason = reason;
    if (!backend) return;
    const control = targetClient(
      payload.target,
      payload.credential,
      'omnilodge-workspace-cancel',
    );
    try {
      await control.connect();
      await control.query(
        'SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE pid=$1 AND backend_start=$2::timestamptz AND application_name=$3',
        [backend.pid, backend.start, `omnilodge-workspace:${job.id}`],
      );
    } catch {
      /* The query deadline/session close remains a second boundary. */
    } finally {
      await control.end().catch(() => {});
    }
  };
  const heartbeat = setInterval(() => {
    if (checking || stopped) return;
    checking = true;
    void (async () => {
      const state = await store.heartbeat(
        job.id,
        job.workerId!,
        job.generation,
      );
      if (!state) {
        leaseLost = true;
        await cancel('lease_lost');
      } else if (state.status === 'cancel_requested') await cancel('user');
      if (Date.now() > deadline) await cancel('deadline');
    })()
      .catch(() => {
        leaseLost = true;
        void cancel('control_store_unavailable');
      })
      .finally(() => {
        checking = false;
      });
  }, 500);
  heartbeat.unref();
  try {
    await authorize();
    await client.connect();
    connected = true;
    await assertRestrictedIdentity(client, payload.target);
    authority = await authorizationSnapshot(client, payload);
    await store.authorization(job, authority);
    const identity = await client.query(
      'SELECT pg_backend_pid() AS pid,backend_start::text AS start FROM pg_stat_activity WHERE pid=pg_backend_pid()',
    );
    backend = identity.rows[0];
    await store.backend(
      job.id,
      job.workerId!,
      job.generation,
      backend!.pid,
      backend!.start,
    );
    if (cancelReason)
      throw new WorkspaceError(
        409,
        'CANCELLED',
        'Execution cancelled before it started.',
      );
    await client.query(payload.mode === 'read' ? 'BEGIN READ ONLY' : 'BEGIN');
    transaction = true;
    await client.query('SELECT set_config($1,$2,true),set_config($3,$4,true)', [
      'statement_timeout',
      String(
        payload.mode === 'read'
          ? payload.limits.readTimeoutMs
          : payload.limits.writeTimeoutMs,
      ),
      'lock_timeout',
      String(payload.limits.lockTimeoutMs),
    ]);
    await client.query(
      "SELECT set_config('idle_in_transaction_session_timeout','10000',true),set_config('search_path','pg_catalog,public',true)",
    );
    for (const check of payload.schemaChecks || []) {
      await client.query(
        `LOCK TABLE ${check.qualifiedName} IN ROW EXCLUSIVE MODE`,
      );
      if ((await schemaFingerprint(client, check.oid)) !== check.fingerprint)
        throw new WorkspaceError(
          409,
          'SCHEMA_CHANGED',
          'The table or its dependencies changed after review. Refresh the table and review the operation again.',
        );
    }
    await executeStatements(store, client, job, payload, outcomes, {
      beforeStatement: async () => {
        if (cancelReason || leaseLost)
          throw new WorkspaceError(
            409,
            'CANCELLED',
            'Execution was cancelled.',
          );
      },
    });
    await authorize();
    if ((await authorizationSnapshot(client, payload)) !== authority)
      throw new WorkspaceError(
        403,
        'DATABASE_AUTHORITY_CHANGED',
        'Database roles, grants or row policies changed during execution. The transaction was rolled back.',
      );
    if (cancelReason || leaseLost)
      throw new WorkspaceError(
        409,
        'CANCELLED',
        'Execution was cancelled before commit.',
      );
    const rollbackPlan = payload.statements.some((s) => s.rollbackPlan);
    committing = true;
    await client.query(rollbackPlan ? 'ROLLBACK' : 'COMMIT');
    committed = !rollbackPlan;
    transaction = false;
    await store.finish(
      job,
      'succeeded',
      rollbackPlan
        ? 'rolled_back'
        : payload.mode === 'read'
          ? 'read_only'
          : 'committed',
      outcomes,
    );
  } catch (error) {
    let outcome: TransactionOutcome = committed
      ? 'committed'
      : committing
        ? 'unknown'
        : transaction
          ? 'unknown'
          : 'not_started';
    if (transaction && !committing && connected) {
      try {
        await client.query('ROLLBACK');
        outcome = 'rolled_back';
        transaction = false;
      } catch {
        outcome = 'unknown';
      }
    }
    const unknown = outcome === 'unknown' || leaseLost;
    const isCancelled = cancelReason === 'user' || cancelReason === 'deadline';
    const info =
      cancelReason === 'deadline'
        ? {
            code: 'JOB_TIMEOUT',
            message: 'Execution exceeded its configured duration.',
          }
        : errorInfo(error);
    await store
      .finish(
        job,
        unknown
          ? 'outcome_unknown'
          : committed
            ? 'succeeded'
            : isCancelled
              ? 'cancelled'
              : 'failed',
        outcome,
        outcomes,
        info,
      )
      .catch(() => {});
  } finally {
    stopped = true;
    clearInterval(heartbeat);
    await client.end().catch(() => {});
  }
}
