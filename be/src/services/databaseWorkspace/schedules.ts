import crypto from 'node:crypto';
import { sealed, opened, type WorkspaceStore } from './store.js';
import { WorkspaceError, type JobPayload } from './types.js';
import type pg from 'pg';

export type ScheduleSpec = {
  timezone: string;
  time: string;
  weekdays: number[];
  missed: 'skip';
  overlap: 'skip';
  dst: 'skip-gap-once-fold';
};
export function validateSchedule(input: unknown): ScheduleSpec {
  const spec = input as ScheduleSpec;
  try {
    new Intl.DateTimeFormat('en', { timeZone: spec.timezone }).format();
  } catch {
    throw new WorkspaceError(
      400,
      'SCHEDULE_TIMEZONE',
      'Choose a valid IANA timezone.',
    );
  }
  if (
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(spec.time) ||
    !Array.isArray(spec.weekdays) ||
    !spec.weekdays.length ||
    spec.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6) ||
    spec.missed !== 'skip' ||
    spec.overlap !== 'skip' ||
    spec.dst !== 'skip-gap-once-fold'
  )
    throw new WorkspaceError(
      400,
      'SCHEDULE_POLICY',
      'Choose a local time, weekdays, skip missed/overlapping runs and skip-gap/once-fold DST behavior.',
    );
  return { ...spec, weekdays: [...new Set(spec.weekdays)].sort() };
}
export function nextOccurrence(after: Date, spec: ScheduleSpec): Date {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: spec.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = (date: Date) =>
    Object.fromEntries(
      formatter
        .formatToParts(date)
        .filter((p) => p.type !== 'literal')
        .map((p) => [p.type, Number(p.value)]),
    );
  const current = parts(after),
    [hour, minute] = spec.time.split(':').map(Number);
  for (let day = 0; day < 9; day++) {
    const localDate = new Date(
      Date.UTC(current.year, current.month - 1, current.day + day),
    );
    if (!spec.weekdays.includes(localDate.getUTCDay())) continue;
    const guess = Date.UTC(
      localDate.getUTCFullYear(),
      localDate.getUTCMonth(),
      localDate.getUTCDate(),
      hour,
      minute,
    );
    const offsets = new Set(
      [-2, -1, 0, 1, 2].map((delta) => {
        const stamp = guess + delta * 86400000,
          p = parts(new Date(stamp));
        return (
          Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) -
          stamp
        );
      }),
    );
    const candidates = [...offsets]
      .map((offset) => new Date(guess - offset))
      .filter((date) => {
        const p = parts(date);
        return (
          p.year === localDate.getUTCFullYear() &&
          p.month === localDate.getUTCMonth() + 1 &&
          p.day === localDate.getUTCDate() &&
          p.hour === hour &&
          p.minute === minute
        );
      })
      .sort((a, b) => a.getTime() - b.getTime());
    // A nonexistent local time has no candidates. A repeated local time always
    // uses the first instant; never dispatch its second occurrence.
    if (candidates[0] && candidates[0].getTime() > after.getTime())
      return candidates[0];
  }
  throw new WorkspaceError(
    400,
    'SCHEDULE_TIME',
    'No valid occurrence was found within the next nine local days.',
  );
}
export type ScheduledPayload = {
  title: string;
  spec: ScheduleSpec;
  job: JobPayload;
  documentId?: string;
  documentRevision?: number;
  version: number;
};
export async function initializeSchedules(
  store: WorkspaceStore,
): Promise<void> {
  await store.pool
    .query(`ALTER TABLE database_workspace.schedules ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
    ALTER TABLE database_workspace.schedules ADD COLUMN IF NOT EXISTS disabled_reason text;
    CREATE TABLE IF NOT EXISTS database_workspace.schedule_runs(id uuid PRIMARY KEY,schedule_id uuid NOT NULL,scheduled_for timestamptz NOT NULL,state text NOT NULL,job_id uuid,detail text,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(schedule_id,scheduled_for));`);
}
export async function listSchedules(store: WorkspaceStore, actorId: number) {
  const r = await store.pool.query(
    'SELECT * FROM database_workspace.schedules WHERE actor_id=$1 ORDER BY updated_at DESC LIMIT 100',
    [actorId],
  );
  return r.rows.map((row) => {
    const value = opened<ScheduledPayload>(row.payload);
    return {
      id: row.id,
      title: value.title,
      targetId: row.target_id,
      enabled: row.enabled,
      revision: row.revision,
      spec: value.spec,
      nextRun: row.next_run,
      lastJobId: row.last_job_id,
      disabledReason: row.disabled_reason,
      documentId: value.documentId,
      documentRevision: value.documentRevision,
    };
  });
}
export async function saveSchedule(
  store: WorkspaceStore,
  actorId: number,
  input: ScheduledPayload,
  maxSchedules: number,
  client?: pg.PoolClient,
): Promise<string> {
  const db = client || store.pool,
    count = await db.query(
      'SELECT count(*)::int AS total FROM database_workspace.schedules WHERE actor_id=$1',
      [actorId],
    );
  if (count.rows[0].total >= maxSchedules)
    throw new WorkspaceError(
      409,
      'SCHEDULE_LIMIT',
      'Remove an old schedule before creating another.',
    );
  const id = crypto.randomUUID(),
    next = nextOccurrence(new Date(), input.spec);
  await db.query(
    'INSERT INTO database_workspace.schedules(id,actor_id,target_id,enabled,next_run,payload) VALUES($1,$2,$3,true,$4,$5)',
    [id, actorId, input.job.target.id, next, sealed(input)],
  );
  await db.query(
    'INSERT INTO database_workspace.audit(actor_id,event,metadata,target_id) VALUES($1,$2,$3,$4)',
    [
      actorId,
      'schedule_approved',
      sealed({
        id,
        title: input.title,
        spec: input.spec,
        version: input.version,
      }),
      input.job.target.id,
    ],
  );
  return id;
}
export async function dispatchSchedules(
  store: WorkspaceStore,
  authorize: (payload: JobPayload, schedule: ScheduledPayload) => Promise<void>,
  graceMs: number,
): Promise<void> {
  const c = await store.pool.connect();
  try {
    await c.query('BEGIN');
    if (
      !(
        await c.query(
          "SELECT pg_try_advisory_xact_lock(hashtext('omnilodge.database-workspace.schedule-dispatch')) AS acquired",
        )
      ).rows[0].acquired
    ) {
      await c.query('ROLLBACK');
      return;
    }
    const due = await c.query(
      'SELECT * FROM database_workspace.schedules WHERE enabled AND next_run<=now() ORDER BY next_run FOR UPDATE SKIP LOCKED LIMIT 1',
    );
    if (!due.rowCount) {
      await c.query('COMMIT');
      return;
    }
    const row = due.rows[0],
      payload = opened<ScheduledPayload>(row.payload),
      scheduled = new Date(row.next_run),
      next = nextOccurrence(new Date(), payload.spec);
    let state = 'dispatched',
      detail = '',
      jobId: string | null = null;
    try {
      await authorize(payload.job, payload);
      if (Date.now() - scheduled.getTime() > graceMs) {
        state = 'missed';
        detail = 'Missed occurrence skipped; no catch-up replay.';
      }
      if (row.last_job_id) {
        const previous = await store.get(row.last_job_id);
        if (
          ['queued', 'running', 'cancel_requested', 'outcome_unknown'].includes(
            previous.status,
          )
        ) {
          state = 'overlap_skipped';
          detail = 'Previous run remains active or uncertain.';
        }
      }
      if (state === 'dispatched') {
        const raw = crypto
            .createHash('sha256')
            .update(`${row.id}:${scheduled.toISOString()}`)
            .digest('hex')
            .slice(0, 32),
          key = `${raw.slice(0, 8)}-${raw.slice(8, 12)}-5${raw.slice(13, 16)}-a${raw.slice(17, 20)}-${raw.slice(20)}`;
        const job = await store.enqueue(
          payload.job,
          `schedule:${row.id}:${payload.version}:${scheduled.toISOString()}`,
          key,
        );
        jobId = job.id;
      }
    } catch {
      state = 'disabled';
      detail =
        'Owner authority, target policy, credentials or saved revision no longer match approval.';
      await c.query(
        'UPDATE database_workspace.schedules SET enabled=false,disabled_reason=$2 WHERE id=$1',
        [row.id, detail],
      );
    }
    await c.query(
      'INSERT INTO database_workspace.schedule_runs(id,schedule_id,scheduled_for,state,job_id,detail) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(schedule_id,scheduled_for) DO NOTHING',
      [crypto.randomUUID(), row.id, scheduled, state, jobId, detail],
    );
    await c.query(
      'UPDATE database_workspace.schedules SET next_run=$2,last_job_id=COALESCE($3,last_job_id),updated_at=now() WHERE id=$1',
      [row.id, next, jobId],
    );
    await c.query('COMMIT');
    await store.audit(
      payload.job.actorId,
      'schedule_dispatched',
      { scheduleId: row.id, scheduledFor: scheduled, state, jobId, detail },
      payload.job.target.id,
      jobId || undefined,
    );
  } catch (error) {
    await c.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    c.release();
  }
}
