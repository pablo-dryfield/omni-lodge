import crypto from 'node:crypto';
import { WorkspaceStore, opened } from '../services/databaseWorkspace/store.js';
import { runRecovery } from '../services/databaseWorkspace/recovery.js';
import type { JobPayload } from '../services/databaseWorkspace/types.js';

// Trusted-host recovery only. No application models, authentication DB, HTTP,
// Sequelize sync, migration adoption or application cutover is involved.
const argument = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const id = argument('--job'),
  destination = argument('--confirm-destination'),
  reason = argument('--reason');
if (
  !id ||
  !/^[a-f0-9-]{36}$/.test(id) ||
  !destination ||
  !/^omnilodge_restore_\d{8}_[a-f0-9]{8}$/.test(destination) ||
  !reason ||
  reason.length < 5 ||
  reason.length > 1000 ||
  !process.argv.includes('--execute')
)
  throw new Error(
    'Usage: node --env-file=<protected bootstrap environment> dist/scripts/offlineDatabaseRecovery.js --job <reviewed queued restore UUID> --confirm-destination <exact new isolated destination> --reason <operator reason> --execute',
  );
if (!process.env.DB_WORKSPACE_CONTROL_URL || !process.env.CONFIG_ENCRYPTION_KEY)
  throw new Error('Independent control URL and encryption key are required.');
const store = new WorkspaceStore(process.env.DB_WORKSPACE_CONTROL_URL),
  operator = `offline-${crypto.randomUUID()}`,
  c = await store.pool.connect();
let payload: JobPayload | undefined;
try {
  await c.query('BEGIN');
  await c.query(
    "SELECT pg_advisory_xact_lock(hashtext('omnilodge.database-workspace.admission'))",
  );
  const row = (
    await c.query(
      'SELECT * FROM database_workspace.jobs WHERE id=$1 FOR UPDATE',
      [id],
    )
  ).rows[0];
  if (!row || row.status !== 'queued' || row.executor !== 'job')
    throw new Error(
      'Only a previously reviewed, unstarted restore job can be claimed offline. Running or uncertain work is never replayed.',
    );
  payload = opened<JobPayload>(row.payload);
  if (
    !row.review_nonce ||
    payload.recovery?.destination !== destination ||
    payload.mode !== 'maintenance' ||
    !payload.recovery
  )
    throw new Error('Reviewed restore identity/destination does not match.');
  await c.query(
    "UPDATE database_workspace.jobs SET status='running',worker_id=$2,generation=generation+1,started_at=now(),lease_until=now()+interval '15 seconds' WHERE id=$1",
    [id, operator],
  );
  await c.query('COMMIT');
} catch (e) {
  await c.query('ROLLBACK').catch(() => {});
  throw e;
} finally {
  c.release();
  if (!payload) await store.close();
}
try {
  await store.audit(
    null,
    'offline_restore_claimed',
    { operator, reason, destination },
    payload.target.id,
    id,
  );
  const job = await store.get(id);
  await runRecovery(store, job, payload, async () => {
    const live = await store.get(id);
    if (live.workerId !== operator || live.status !== 'running')
      throw new Error('Offline restore lease or cancellation changed.');
  });
  const result = await store.get(id);
  console.log(
    JSON.stringify({
      jobId: id,
      status: result.status,
      outcome: result.transactionOutcome,
      destination,
      sourceReplaced: false,
    }),
  );
  if (result.status !== 'succeeded') process.exitCode = 1;
} finally {
  await store.close();
}
