import type { QueryInterface } from 'sequelize';

type MigrationParams = { context: QueryInterface };

export async function up({ context }: MigrationParams): Promise<void> {
  await context.sequelize.query(`
    UPDATE review_sync_runs
    SET status = 'failed',
        completed_at = NOW(),
        updated_at = NOW()
    WHERE platform = 'tripadvisor'
      AND status = 'running'
      AND started_at < NOW() - INTERVAL '2 minutes';
  `);
}

export async function down(): Promise<void> {
  // Do not reopen abandoned TripAdvisor sync runs.
}
