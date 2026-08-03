import type { QueryInterface } from 'sequelize';

type Params = { context: QueryInterface };

export async function up({ context: qi }: Params): Promise<void> {
  const transaction = await qi.sequelize.transaction();
  try {
    await qi.sequelize.query(
      `
      INSERT INTO review_manual_credits
        (user_id, platform, date, credit, notes, created_by, created_at, updated_at)
      SELECT
        entry.user_id,
        counter.platform,
        counter.period_start,
        entry.raw_count,
        CONCAT('Backfilled from legacy review counter #', counter.id,
          CASE WHEN entry.notes IS NOT NULL AND entry.notes <> '' THEN CONCAT(': ', entry.notes) ELSE '' END),
        COALESCE(entry.created_by, counter.created_by, entry.user_id),
        COALESCE(entry.created_at, NOW()),
        COALESCE(entry.updated_at, entry.created_at, NOW())
      FROM review_counter_entries entry
      JOIN review_counters counter ON counter.id = entry.counter_id
      WHERE entry.category = 'staff'
        AND entry.user_id IS NOT NULL
        AND entry.raw_count <> 0
        AND NOT EXISTS (
          SELECT 1
          FROM review_manual_credits existing
          WHERE existing.user_id = entry.user_id
            AND existing.platform = counter.platform
            AND existing.date = counter.period_start
            AND existing.notes LIKE CONCAT('Backfilled from legacy review counter #', counter.id, '%')
        );
      `,
      { transaction },
    );
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function down({ context: qi }: Params): Promise<void> {
  await qi.sequelize.query(
    `DELETE FROM review_manual_credits WHERE notes LIKE 'Backfilled from legacy review counter #%';`,
  );
}
