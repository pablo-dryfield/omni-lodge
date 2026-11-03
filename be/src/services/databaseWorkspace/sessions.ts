import crypto from 'node:crypto';
import type pg from 'pg';
import { sealed, opened, type WorkspaceStore } from './store.js';
import { targetClient, assertRestrictedIdentity } from './connection.js';
import { executeStatements } from './execute.js';
import { authorizationSnapshot } from './resultAccess.js';
import {
  WorkspaceError,
  errorInfo,
  type SessionRecord,
  type SessionPayload,
  type JobPayload,
  type JobRecord,
  type StatementOutcome,
} from './types.js';
import { quoteIdentifier } from './filters.js';

type Row = {
  id: string;
  actor_id: string;
  target_id: string;
  state: string;
  revision: number;
  affected_rows: number;
  created_at: Date;
  expires_at: Date;
  outcome: string;
  pending_job_id: string | null;
  payload: Parameters<typeof opened>[0];
  last_activity: Date;
  transaction_started: Date | null;
  worker_id: string | null;
  backend_pid: number | null;
  backend_start: Date | null;
};
const publicSession = (r: Row): SessionRecord => ({
  id: r.id,
  targetId: r.target_id,
  mode: opened<SessionPayload>(r.payload).mode,
  state: r.state,
  revision: r.revision,
  affectedRows: r.affected_rows,
  createdAt: r.created_at.toISOString(),
  expiresAt: r.expires_at.toISOString(),
  outcome: r.outcome,
  pendingJobId: r.pending_job_id,
});
export async function getSession(
  store: WorkspaceStore,
  id: string,
  actorId: number,
): Promise<{ record: SessionRecord; payload: SessionPayload }> {
  const r = await store.pool.query(
    'SELECT * FROM database_workspace.sessions WHERE id=$1 AND actor_id=$2',
    [id, actorId],
  );
  if (!r.rowCount)
    throw new WorkspaceError(
      404,
      'SESSION_NOT_FOUND',
      'Transaction session not found.',
    );
  return {
    record: publicSession(r.rows[0]),
    payload: opened<SessionPayload>(r.rows[0].payload),
  };
}
export async function listSessions(
  store: WorkspaceStore,
  actorId: number,
): Promise<SessionRecord[]> {
  const r = await store.pool.query(
    'SELECT * FROM database_workspace.sessions WHERE actor_id=$1 ORDER BY created_at DESC LIMIT 30',
    [actorId],
  );
  return r.rows.map(publicSession);
}
export async function openSession(
  store: WorkspaceStore,
  payload: SessionPayload,
): Promise<SessionRecord> {
  const c = await store.pool.connect();
  try {
    await c.query('BEGIN');
    await store.assertCapacity(c);
    await c.query(
      "SELECT pg_advisory_xact_lock(hashtext('omnilodge.database-workspace.admission'))",
    );
    const count = await c.query(
      "SELECT count(*)::int AS total,count(*) FILTER(WHERE actor_id=$2)::int AS owned FROM database_workspace.sessions WHERE target_id=$1 AND state NOT IN ('closed','expired','failed')",
      [payload.target.id, payload.actorId],
    );
    const jobs = await c.query(
      "SELECT count(*)::int AS total,count(*) FILTER(WHERE mode<>'read')::int AS writes FROM database_workspace.jobs WHERE target_id=$1 AND (status IN ('running','cancel_requested') OR (status='outcome_unknown' AND NOT backend_reconciled))",
      [payload.target.id],
    );
    if (
      count.rows[0].total >= payload.sessionPolicy.maxPerTarget ||
      count.rows[0].owned ||
      jobs.rows[0].writes ||
      count.rows[0].total + jobs.rows[0].total >=
        payload.limits.activeJobsPerTarget
    )
      throw new WorkspaceError(
        429,
        'SESSION_CAPACITY',
        'This connection has an active transaction or write. Close it before opening another session.',
      );
    const id = crypto.randomUUID();
    const row = await c.query(
      "INSERT INTO database_workspace.sessions(id,actor_id,target_id,payload,expires_at) VALUES($1,$2,$3,$4,now()+$5::int*interval '1 millisecond') RETURNING *",
      [
        id,
        payload.actorId,
        payload.target.id,
        sealed(payload),
        payload.sessionPolicy.maxMs,
      ],
    );
    await c.query('COMMIT');
    await store.audit(
      payload.actorId,
      'session_open_requested',
      {},
      payload.target.id,
      id,
    );
    return publicSession(row.rows[0]);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
type Owned = {
  row: Row;
  payload: SessionPayload;
  client: pg.Client;
  busy: boolean;
  dead: boolean;
  aborted: boolean;
  savepoints: Map<string, number>;
};
export class SessionEngine {
  private owned = new Map<string, Owned>();
  private ticking = false;
  constructor(
    private store: WorkspaceStore,
    private workerId: string,
    private authorize: (payload: JobPayload) => Promise<void>,
  ) {}
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.reconcileLost();
      const claimed = await this.store.pool.query(
        "UPDATE database_workspace.sessions SET state='opening',worker_id=$1,heartbeat_at=now() WHERE id=(SELECT id FROM database_workspace.sessions WHERE state='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *",
        [this.workerId],
      );
      if (claimed.rowCount) await this.connect(claimed.rows[0]);
      for (const entry of this.owned.values()) {
        await this.store.pool.query(
          'UPDATE database_workspace.sessions SET heartbeat_at=now() WHERE id=$1 AND worker_id=$2',
          [entry.row.id, this.workerId],
        );
        if (entry.busy) continue;
        const live = await this.store.pool.query(
          'SELECT * FROM database_workspace.sessions WHERE id=$1 AND worker_id=$2',
          [entry.row.id, this.workerId],
        );
        if (!live.rowCount) {
          await this.close(entry, 'unknown', 'unknown');
          continue;
        }
        entry.row = live.rows[0];
        const now = Date.now();
        if (
          now >= entry.row.expires_at.getTime() ||
          now - entry.row.last_activity.getTime() >=
            entry.payload.sessionPolicy.idleMs ||
          now - (entry.row.transaction_started?.getTime() || now) >=
            entry.payload.sessionPolicy.transactionMaxMs
        ) {
          await this.close(entry, 'expired', 'rolled_back');
          continue;
        }
        try {
          await this.authorize(entry.payload);
        } catch {
          await this.close(entry, 'expired', 'rolled_back');
          continue;
        }
        if (entry.row.pending_job_id) {
          entry.busy = true;
          void this.command(entry).finally(() => {
            entry.busy = false;
          });
        }
      }
    } finally {
      this.ticking = false;
    }
  }
  private async connect(row: Row): Promise<void> {
    const payload = opened<SessionPayload>(row.payload),
      client = targetClient(
        payload.target,
        payload.credential,
        `omnilodge-workspace-session:${row.id}`,
      );
    const entry: Owned = {
      row,
      payload,
      client,
      busy: false,
      dead: false,
      aborted: false,
      savepoints: new Map(),
    };
    try {
      await this.authorize(payload);
      await client.connect();
      await assertRestrictedIdentity(client, payload.target);
      client.on('error', () => {
        entry.dead = true;
      });
      const identity = await client.query(
        'SELECT pg_backend_pid() AS pid,backend_start FROM pg_stat_activity WHERE pid=pg_backend_pid()',
      );
      await client.query(payload.mode === 'read' ? 'BEGIN READ ONLY' : 'BEGIN');
      await client.query(
        "SELECT set_config('idle_in_transaction_session_timeout',$1,true),set_config('statement_timeout',$2,true),set_config('lock_timeout',$3,true)",
        [
          String(payload.sessionPolicy.idleMs),
          String(
            Math.min(
              payload.sessionPolicy.transactionMaxMs,
              payload.mode === 'read'
                ? payload.limits.readTimeoutMs
                : payload.limits.writeTimeoutMs,
            ),
          ),
          String(payload.limits.lockTimeoutMs),
        ],
      );
      await this.store.pool.query(
        "UPDATE database_workspace.sessions SET state='idle',backend_pid=$2,backend_start=$3,transaction_started=now(),last_activity=now(),outcome='staged' WHERE id=$1 AND worker_id=$4",
        [
          row.id,
          identity.rows[0].pid,
          identity.rows[0].backend_start,
          this.workerId,
        ],
      );
      this.owned.set(row.id, entry);
    } catch {
      await client.end().catch(() => {});
      await this.store.pool.query(
        "UPDATE database_workspace.sessions SET state='failed',outcome='not_started' WHERE id=$1 AND worker_id=$2",
        [row.id, this.workerId],
      );
    }
  }
  private async command(entry: Owned): Promise<void> {
    const { row, client, payload } = entry,
      id = row.pending_job_id!;
    const outcomes: StatementOutcome[] = [];
    let job: JobRecord | undefined,
      cancelled = false,
      committing = false,
      checking = false;
    const timer = setInterval(() => {
      if (checking) return;
      checking = true;
      void (async () => {
        const live =
          job &&
          (await this.store.heartbeat(id, this.workerId, job.generation));
        if (
          !live ||
          live.status === 'cancel_requested' ||
          Date.now() > row.expires_at.getTime() ||
          Date.now() - (row.transaction_started?.getTime() || 0) >
            payload.sessionPolicy.transactionMaxMs
        ) {
          cancelled = true;
          const cancel = targetClient(
            payload.target,
            payload.credential,
            'omnilodge-workspace-session-cancel',
          );
          try {
            await cancel.connect();
            await cancel.query(
              'SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE pid=$1 AND backend_start=$2 AND application_name=$3',
              [row.backend_pid, row.backend_start, `omnilodge-workspace:${id}`],
            );
          } finally {
            await cancel.end().catch(() => {});
          }
        }
      })()
        .catch(() => {
          cancelled = true;
          entry.dead = true;
          void client.end().catch(() => {});
        })
        .finally(() => {
          checking = false;
        });
    }, 500);
    timer.unref();
    try {
      const claimed = await this.store.pool.query(
        "UPDATE database_workspace.jobs SET status='running',worker_id=$2,generation=generation+1,lease_until=now()+interval '15 seconds',started_at=now() WHERE id=$1 AND executor='session' AND status='queued' RETURNING id",
        [id, this.workerId],
      );
      if (!claimed.rowCount) {
        await this.close(entry, 'closed', 'rolled_back');
        return;
      }
      job = await this.store.get(id);
      const commandPayload = await this.store.privatePayload(
        id,
        payload.actorId,
      );
      await this.authorize(payload);
      const command = commandPayload.sessionCommand?.command || 'sql',
        name = commandPayload.sessionCommand?.name || '';
      if (entry.aborted && !['rollback', 'rollbackTo'].includes(command))
        throw new WorkspaceError(
          409,
          'TRANSACTION_ABORTED',
          'Roll back the transaction or roll back to a savepoint before another command.',
        );
      if (!entry.aborted)
        await client.query("SELECT set_config('application_name',$1,false)", [
          `omnilodge-workspace:${id}`,
        ]);
      await this.store.backend(
        id,
        this.workerId,
        job.generation,
        row.backend_pid!,
        row.backend_start!.toISOString(),
      );
      if (command === 'sql') {
        await this.store.authorization(
          job,
          await authorizationSnapshot(client, commandPayload),
        );
        await executeStatements(
          this.store,
          client,
          job,
          commandPayload,
          outcomes,
          {
            beforeStatement: async () => {
              if (cancelled)
                throw new WorkspaceError(
                  409,
                  'CANCELLED',
                  'Session command cancelled.',
                );
              await this.authorize(payload);
            },
            affected: async (count) => {
              row.affected_rows += count;
              if (row.affected_rows > payload.limits.writeMaxRows)
                throw new WorkspaceError(
                  409,
                  'WRITE_ROW_LIMIT',
                  'The expert transaction exceeded its affected-row budget. Roll back this transaction.',
                );
            },
          },
        );
      } else if (command === 'commit') {
        await this.authorize(payload);
        if (cancelled)
          throw new WorkspaceError(
            409,
            'CANCELLED',
            'Commit cancelled before submission.',
          );
        if (entry.dead || entry.aborted)
          throw new WorkspaceError(
            409,
            'TRANSACTION_ABORTED',
            'Roll back the aborted transaction.',
          );
        committing = true;
        const result = await client.query('COMMIT');
        if (result.command !== 'COMMIT')
          throw new WorkspaceError(
            409,
            'TRANSACTION_ABORTED',
            'The transaction was rolled back by PostgreSQL.',
          );
        await this.store.finish(
          job,
          'succeeded',
          payload.mode === 'read' ? 'read_only' : 'committed',
          outcomes,
        );
        await this.close(
          entry,
          'closed',
          payload.mode === 'read' ? 'read_only' : 'committed',
          false,
        );
        return;
      } else if (command === 'rollback') {
        await client.query('ROLLBACK');
        await this.store.finish(job, 'succeeded', 'rolled_back', outcomes);
        await this.close(entry, 'closed', 'rolled_back', false);
        return;
      } else {
        if (!/^[a-z][a-z0-9_]{0,31}$/.test(name))
          throw new WorkspaceError(
            400,
            'INVALID_SAVEPOINT',
            'Use a short lowercase savepoint name.',
          );
        if (command === 'savepoint') {
          if (entry.savepoints.has(name))
            throw new WorkspaceError(
              409,
              'SAVEPOINT_EXISTS',
              'Choose a unique savepoint name.',
            );
          await client.query(`SAVEPOINT ${quoteIdentifier(name)}`);
          entry.savepoints.set(name, row.affected_rows);
        } else {
          if (!entry.savepoints.has(name))
            throw new WorkspaceError(
              409,
              'SAVEPOINT_NOT_FOUND',
              'Savepoint not found in this transaction.',
            );
          await client.query(
            `${command === 'rollbackTo' ? 'ROLLBACK TO SAVEPOINT' : 'RELEASE SAVEPOINT'} ${quoteIdentifier(name)}`,
          );
          if (command === 'rollbackTo') {
            row.affected_rows = entry.savepoints.get(name)!;
            entry.aborted = false;
          }
          const keys = [...entry.savepoints.keys()],
            position = keys.indexOf(name);
          for (const later of keys.slice(
            position + (command === 'rollbackTo' ? 1 : 0),
          ))
            entry.savepoints.delete(later);
        }
      }
      await this.store.finish(job, 'succeeded', 'staged', outcomes);
      await this.store.pool.query(
        "UPDATE database_workspace.sessions SET state='idle',pending_job_id=NULL,affected_rows=$2,last_activity=now(),revision=revision+1 WHERE id=$1 AND worker_id=$3",
        [row.id, row.affected_rows, this.workerId],
      );
    } catch (error) {
      if (error instanceof WorkspaceError && error.code === 'WRITE_ROW_LIMIT') {
        let outcome: 'rolled_back' | 'unknown' = 'rolled_back';
        try {
          await client.query('ROLLBACK');
        } catch {
          outcome = 'unknown';
        }
        if (job)
          await this.store.finish(
            job,
            outcome === 'unknown' ? 'outcome_unknown' : 'failed',
            outcome,
            outcomes,
            errorInfo(error),
          );
        await this.close(entry, 'closed', outcome, false);
        return;
      }
      if (job)
        await this.store
          .finish(
            job,
            committing || entry.dead
              ? 'outcome_unknown'
              : cancelled
                ? 'cancelled'
                : 'failed',
            committing || entry.dead ? 'unknown' : 'staged',
            outcomes,
            errorInfo(error),
          )
          .catch(() => {});
      if (committing || entry.dead) {
        await this.close(entry, 'unknown', 'unknown');
        return;
      }
      entry.aborted = true;
      await this.store.pool.query(
        "UPDATE database_workspace.sessions SET state='aborted',pending_job_id=NULL,affected_rows=$2,last_activity=now(),revision=revision+1 WHERE id=$1 AND worker_id=$3",
        [row.id, row.affected_rows, this.workerId],
      );
    } finally {
      clearInterval(timer);
      while (checking) await new Promise((resolve) => setTimeout(resolve, 10));
      // The cancellation query is fully settled before another command can reuse this backend.
      if (!entry.dead && this.owned.has(row.id))
        await client
          .query("SELECT set_config('application_name',$1,false)", [
            `omnilodge-workspace-session:${row.id}`,
          ])
          .catch(() => {});
    }
  }
  private async close(
    entry: Owned,
    state: string,
    outcome: string,
    rollback = true,
  ): Promise<void> {
    if (rollback) {
      try {
        await entry.client.query('ROLLBACK');
      } catch {
        if (outcome !== 'unknown') outcome = 'unknown';
      }
    }
    await entry.client.end().catch(() => {});
    entry.dead = true;
    this.owned.delete(entry.row.id);
    await this.store.pool.query(
      'UPDATE database_workspace.sessions SET state=$2,outcome=$3,pending_job_id=NULL,revision=revision+1 WHERE id=$1 AND worker_id=$4',
      [entry.row.id, state, outcome, this.workerId],
    );
    await this.store.audit(
      entry.payload.actorId,
      'session_closed',
      { state, outcome },
      entry.row.target_id,
      entry.row.id,
    );
  }
  private async reconcileLost(): Promise<void> {
    await this.store.pool.query(
      "UPDATE database_workspace.sessions SET state='unknown',outcome='unknown' WHERE state IN ('opening','idle','pending','aborted') AND worker_id IS NOT NULL AND heartbeat_at<now()-interval '30 seconds'",
    );
    const lost = await this.store.pool.query(
      "SELECT * FROM database_workspace.sessions WHERE state='unknown' LIMIT 20",
    );
    for (const row of lost.rows) {
      const payload = opened<SessionPayload>(row.payload),
        client = targetClient(
          payload.target,
          payload.credential,
          'omnilodge-workspace-session-reconcile',
        );
      try {
        await client.connect();
        if (row.backend_pid)
          await client.query(
            'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid=$1 AND backend_start=$2 AND (application_name=$3 OR application_name=$4)',
            [
              row.backend_pid,
              row.backend_start,
              `omnilodge-workspace-session:${row.id}`,
              `omnilodge-workspace:${row.pending_job_id}`,
            ],
          );
        const remaining = await client.query(
          'SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND backend_start=$2',
          [row.backend_pid, row.backend_start],
        );
        if (!remaining.rowCount)
          await this.store.pool.query(
            "UPDATE database_workspace.sessions SET state='expired',revision=revision+1 WHERE id=$1 AND state='unknown'",
            [row.id],
          );
      } catch {
        /* Unknown sessions continue reserving capacity. */
      } finally {
        await client.end().catch(() => {});
      }
    }
  }
  async shutdown(): Promise<void> {
    for (const entry of this.owned.values())
      if (!entry.busy) await this.close(entry, 'closed', 'rolled_back');
  }
}
