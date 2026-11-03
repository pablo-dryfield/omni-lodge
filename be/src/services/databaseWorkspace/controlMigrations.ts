import crypto from 'node:crypto';
import type pg from 'pg';
import { WorkspaceError } from './types.js';
export type ControlMigration = { id: string; sql: string };
// Applied SQL is immutable. Add a new numbered migration rather than editing
// an applied definition, and capture an independent journal backup first.
export async function migrateControlStore(
  pool: pg.Pool,
  migrations: ControlMigration[],
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('omnilodge.database-workspace.schema'))",
    );
    await client.query(`CREATE SCHEMA IF NOT EXISTS database_workspace;
      CREATE TABLE IF NOT EXISTS database_workspace.control_migrations(id text PRIMARY KEY,checksum text NOT NULL,release_id text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now());
      REVOKE ALL ON SCHEMA database_workspace FROM PUBLIC;
      REVOKE ALL ON database_workspace.control_migrations FROM PUBLIC;`);
    for (const migration of migrations) {
      if (!/^\d{3}-[a-z-]+$/.test(migration.id))
        throw new WorkspaceError(
          500,
          'CONTROL_MIGRATION_ID',
          'Invalid control migration identity.',
        );
      const checksum = crypto
        .createHash('sha256')
        .update(migration.sql.replace(/\r\n/g, '\n').trim())
        .digest('hex');
      const applied = (
        await client.query(
          'SELECT checksum FROM database_workspace.control_migrations WHERE id=$1',
          [migration.id],
        )
      ).rows[0];
      if (applied) {
        if (applied.checksum !== checksum)
          throw new WorkspaceError(
            503,
            'CONTROL_MIGRATION_CHANGED',
            'An applied control migration changed. Preserve the control store and add a forward migration; do not edit its journal.',
          );
        continue;
      }
      await client.query(migration.sql);
      await client.query(
        'INSERT INTO database_workspace.control_migrations(id,checksum,release_id) VALUES($1,$2,$3)',
        [
          migration.id,
          checksum,
          String(process.env.APP_VERSION || 'local').slice(0, 200),
        ],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export const CORE_MIGRATION: ControlMigration = {
  id: '001-core',
  sql: `CREATE SCHEMA IF NOT EXISTS database_workspace;
        CREATE TABLE IF NOT EXISTS database_workspace.jobs (
          id uuid PRIMARY KEY, actor_id bigint NOT NULL, target_id text NOT NULL, mode text NOT NULL,
          status text NOT NULL, transaction_outcome text NOT NULL DEFAULT 'not_started',
          created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, finished_at timestamptz,
          queue_deadline timestamptz NOT NULL, worker_id text, generation integer NOT NULL DEFAULT 0,
          lease_until timestamptz, backend_pid integer, backend_start timestamptz,
          payload jsonb NOT NULL, outcomes jsonb, error jsonb, summary text NOT NULL,
          statement_count integer NOT NULL, idempotency_key text, operation_hash text NOT NULL, review_nonce text UNIQUE,
          cancel_cause text, UNIQUE(actor_id,idempotency_key));
        CREATE INDEX IF NOT EXISTS dw_jobs_queue ON database_workspace.jobs(status,created_at);
        CREATE INDEX IF NOT EXISTS dw_jobs_actor ON database_workspace.jobs(actor_id,created_at DESC);
        CREATE INDEX IF NOT EXISTS dw_jobs_target ON database_workspace.jobs(target_id,status);
        ALTER TABLE database_workspace.jobs ADD COLUMN IF NOT EXISTS authorization_context text;
        ALTER TABLE database_workspace.jobs ADD COLUMN IF NOT EXISTS backend_reconciled boolean NOT NULL DEFAULT false;
        ALTER TABLE database_workspace.jobs ADD COLUMN IF NOT EXISTS executor text NOT NULL DEFAULT 'job';
        ALTER TABLE database_workspace.jobs ADD COLUMN IF NOT EXISTS session_id uuid;
        ALTER TABLE database_workspace.jobs ADD COLUMN IF NOT EXISTS archive_id uuid;
        CREATE TABLE IF NOT EXISTS database_workspace.schema_versions(version integer PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now());
        INSERT INTO database_workspace.schema_versions(version) VALUES(1) ON CONFLICT DO NOTHING;
        CREATE TABLE IF NOT EXISTS database_workspace.workers(id uuid PRIMARY KEY,heartbeat_at timestamptz NOT NULL DEFAULT now(),started_at timestamptz NOT NULL DEFAULT now());
        ALTER TABLE database_workspace.workers ADD COLUMN IF NOT EXISTS limits jsonb;
        CREATE TABLE IF NOT EXISTS database_workspace.review_uses(nonce uuid PRIMARY KEY,actor_id bigint NOT NULL,operation_hash text NOT NULL,result_id uuid NOT NULL,idempotency_key uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(actor_id,idempotency_key));
        CREATE TABLE IF NOT EXISTS database_workspace.audit (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor_id bigint, target_id text,
          execution_id uuid, event text NOT NULL, metadata jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
        CREATE INDEX IF NOT EXISTS dw_audit_time ON database_workspace.audit(created_at DESC);
        CREATE TABLE IF NOT EXISTS database_workspace.documents (
          id uuid PRIMARY KEY, actor_id bigint NOT NULL, kind text NOT NULL, revision integer NOT NULL DEFAULT 1,
          payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz);
        CREATE INDEX IF NOT EXISTS dw_documents_actor ON database_workspace.documents(actor_id,kind,updated_at DESC);
        CREATE TABLE IF NOT EXISTS database_workspace.document_revisions (
          document_id uuid NOT NULL REFERENCES database_workspace.documents(id) ON DELETE CASCADE,
          revision integer NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(document_id,revision));
        CREATE TABLE IF NOT EXISTS database_workspace.artifacts (
          id uuid PRIMARY KEY, execution_id uuid NOT NULL REFERENCES database_workspace.jobs(id), actor_id bigint NOT NULL,
          result_index integer NOT NULL, manifest jsonb NOT NULL, directory text NOT NULL, bytes bigint NOT NULL DEFAULT 0,
          expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(execution_id,result_index));
        CREATE INDEX IF NOT EXISTS dw_artifacts_expiry ON database_workspace.artifacts(expires_at);
        CREATE TABLE IF NOT EXISTS database_workspace.storage_budget (id integer PRIMARY KEY CHECK(id=1), bytes bigint NOT NULL DEFAULT 0 CHECK(bytes>=0));
        INSERT INTO database_workspace.storage_budget(id,bytes) VALUES(1,0) ON CONFLICT DO NOTHING;
        CREATE TABLE IF NOT EXISTS database_workspace.schedules (
          id uuid PRIMARY KEY, actor_id bigint NOT NULL, target_id text NOT NULL, enabled boolean NOT NULL DEFAULT false,
          next_run timestamptz, payload jsonb NOT NULL, last_job_id uuid, updated_at timestamptz NOT NULL DEFAULT now());
        CREATE TABLE IF NOT EXISTS database_workspace.sessions (
          id uuid PRIMARY KEY, actor_id bigint NOT NULL, target_id text NOT NULL, worker_id text,
          generation integer NOT NULL DEFAULT 1, state text NOT NULL DEFAULT 'queued', payload jsonb NOT NULL,
          heartbeat_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL);
        ALTER TABLE database_workspace.sessions ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
        ALTER TABLE database_workspace.sessions ADD COLUMN IF NOT EXISTS affected_rows integer NOT NULL DEFAULT 0;
        ALTER TABLE database_workspace.sessions ADD COLUMN IF NOT EXISTS backend_pid integer;
        ALTER TABLE database_workspace.sessions ADD COLUMN IF NOT EXISTS backend_start timestamptz;
        ALTER TABLE database_workspace.sessions ADD COLUMN IF NOT EXISTS last_activity timestamptz NOT NULL DEFAULT now();
        ALTER TABLE database_workspace.sessions ADD COLUMN IF NOT EXISTS pending_job_id uuid;
        ALTER TABLE database_workspace.sessions ADD COLUMN IF NOT EXISTS outcome text NOT NULL DEFAULT 'not_started';
        ALTER TABLE database_workspace.sessions ADD COLUMN IF NOT EXISTS transaction_started timestamptz;
        REVOKE ALL ON SCHEMA database_workspace FROM PUBLIC;
        REVOKE ALL ON ALL TABLES IN SCHEMA database_workspace FROM PUBLIC;`,
};

export const SCHEDULE_MIGRATION: ControlMigration = {
  id: '002-schedules',
  sql: `ALTER TABLE database_workspace.schedules ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
    ALTER TABLE database_workspace.schedules ADD COLUMN IF NOT EXISTS disabled_reason text;
    CREATE TABLE IF NOT EXISTS database_workspace.schedule_runs(id uuid PRIMARY KEY,schedule_id uuid NOT NULL,scheduled_for timestamptz NOT NULL,state text NOT NULL,job_id uuid,detail text,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(schedule_id,scheduled_for));`,
};

export const RECOVERY_MIGRATION: ControlMigration = {
  id: '003-recovery',
  sql: `CREATE TABLE IF NOT EXISTS database_workspace.restore_archives(id uuid PRIMARY KEY,actor_id bigint NOT NULL,directory text NOT NULL,bytes bigint NOT NULL,metadata jsonb NOT NULL,expires_at timestamptz NOT NULL,job_id uuid,created_at timestamptz NOT NULL DEFAULT now());`,
};
