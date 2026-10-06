import type { QueryInterface } from 'sequelize';

type MigrationParams = { context: QueryInterface };

export async function up({ context }: MigrationParams): Promise<void> {
  await context.sequelize.query(`
    WITH latest_good_tripadvisor_run AS (
      SELECT id
      FROM review_sync_runs
      WHERE platform = 'tripadvisor'
        AND status = 'completed'
        AND seen_count > 0
      ORDER BY completed_at DESC NULLS LAST, id DESC
      LIMIT 1
    ),
    reactivated AS (
      UPDATE review_archive
      SET is_deleted = FALSE,
          deleted_detected_at = NULL,
          updated_at = NOW()
      WHERE platform = 'tripadvisor'
        AND is_deleted = TRUE
        AND last_seen_run_id = (SELECT id FROM latest_good_tripadvisor_run)
        AND NOT EXISTS (
          SELECT 1
          FROM review_archive active_tripadvisor_reviews
          WHERE active_tripadvisor_reviews.platform = 'tripadvisor'
            AND active_tripadvisor_reviews.is_deleted = FALSE
        )
      RETURNING 1
    )
    UPDATE review_daily_snapshots
    SET active_count = restored.active_count,
        deleted_count = GREATEST(archived_count - restored.active_count, 0),
        updated_at = NOW()
    FROM (
      SELECT COUNT(*)::integer AS active_count
      FROM review_archive
      WHERE platform = 'tripadvisor'
        AND is_deleted = FALSE
    ) restored
    WHERE platform = 'tripadvisor'
      AND snapshot_date = CURRENT_DATE
      AND EXISTS (SELECT 1 FROM reactivated);
  `);
}

export async function down(): Promise<void> {
  // Do not reapply a known-bad zero-result sync that hid active TripAdvisor reviews.
}
