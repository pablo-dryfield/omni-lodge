import type { Response } from 'express';
import { QueryTypes } from 'sequelize';
import sequelize from '../config/database.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';

const TABLE_MIGRATION_RUNS = 'migration_audit_runs';
const TABLE_MIGRATION_STEPS = 'migration_audit_steps';

type MigrationAuditRow = {
  run_id: string;
  direction: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  node_env: string | null;
  db_name: string | null;
  error_message: string | null;
  step_count: number;
  failed_steps: number;
  success_steps: number;
  running_steps: number;
};

const parseLimit = (value: unknown, fallback = 5, max = 25): number => {
  const parsed = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(parsed), max);
};

const tableExists = async (tableName: string): Promise<boolean> => {
  const rows = await sequelize.query<{ name: string | null }>(
    'SELECT to_regclass(:tableName) AS name',
    {
      replacements: { tableName: `public.${tableName}` },
      type: QueryTypes.SELECT,
    },
  );
  return Boolean(rows[0]?.name);
};

export const listMigrationAuditRuns = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const limit = parseLimit(req.query.limit, 5, 25);
    const hasRuns = await tableExists(TABLE_MIGRATION_RUNS);
    if (!hasRuns) {
      res.json({ runs: [] });
      return;
    }
    const hasSteps = await tableExists(TABLE_MIGRATION_STEPS);

    const rows = await sequelize.query<MigrationAuditRow>(
      hasSteps
        ? `
            SELECT
              r.run_id,
              r.direction,
              r.status,
              r.started_at,
              r.finished_at,
              r.node_env,
              r.db_name,
              r.error_message,
              COALESCE(COUNT(s.id), 0)::int AS step_count,
              COALESCE(SUM(CASE WHEN s.status = 'failed' THEN 1 ELSE 0 END), 0)::int AS failed_steps,
              COALESCE(SUM(CASE WHEN s.status = 'success' THEN 1 ELSE 0 END), 0)::int AS success_steps,
              COALESCE(SUM(CASE WHEN s.status = 'running' THEN 1 ELSE 0 END), 0)::int AS running_steps
            FROM ${TABLE_MIGRATION_RUNS} r
            LEFT JOIN ${TABLE_MIGRATION_STEPS} s
              ON s.run_id = r.run_id AND s.direction = r.direction
            GROUP BY
              r.run_id,
              r.direction,
              r.status,
              r.started_at,
              r.finished_at,
              r.node_env,
              r.db_name,
              r.error_message
            ORDER BY r.started_at DESC
            LIMIT :limit;
          `
        : `
            SELECT
              r.run_id,
              r.direction,
              r.status,
              r.started_at,
              r.finished_at,
              r.node_env,
              r.db_name,
              r.error_message,
              0::int AS step_count,
              0::int AS failed_steps,
              0::int AS success_steps,
              0::int AS running_steps
            FROM ${TABLE_MIGRATION_RUNS} r
            ORDER BY r.started_at DESC
            LIMIT :limit;
          `,
      {
        replacements: { limit },
        type: QueryTypes.SELECT,
      },
    );

    const runs = rows.map((row) => ({
      runId: row.run_id,
      direction: row.direction,
      status: row.status,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      nodeEnv: row.node_env,
      dbName: row.db_name,
      errorMessage: row.error_message,
      stepCount: row.step_count,
      failedSteps: row.failed_steps,
      successSteps: row.success_steps,
      runningSteps: row.running_steps,
    }));

    res.json({ runs });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load migration audit runs.';
    res.status(500).json([{ message }]);
  }
};
