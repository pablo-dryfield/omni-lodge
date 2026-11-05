import type { QueryInterface } from 'sequelize';

type Params = { context: QueryInterface };

export async function up({ context }: Params): Promise<void> {
  await context.sequelize.transaction(async transaction => {
    await context.sequelize.query(`ALTER TABLE staff_free_entries
      DROP CONSTRAINT staff_free_entries_benefit_check,
      ADD CONSTRAINT staff_free_entries_benefit_check
        CHECK (benefit IN ('allowance', 'busy_night', 'assistant_manager', 'management', 'override'))`, { transaction });
  });
}

export async function down({ context }: Params): Promise<void> {
  await context.sequelize.transaction(async transaction => {
    // Refuse rollback if it would invalidate recorded management visits; never rewrite their history.
    await context.sequelize.query(`ALTER TABLE staff_free_entries
      DROP CONSTRAINT staff_free_entries_benefit_check,
      ADD CONSTRAINT staff_free_entries_benefit_check
        CHECK (benefit IN ('allowance', 'busy_night', 'assistant_manager', 'override'))`, { transaction });
  });
}
