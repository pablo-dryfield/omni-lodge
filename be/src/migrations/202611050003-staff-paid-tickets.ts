import type { QueryInterface } from 'sequelize';
export async function up({ context }: { context: QueryInterface }): Promise<void> {
  await context.sequelize.transaction(async transaction => {
    await context.sequelize.query(`ALTER TABLE staff_free_entries
      ADD COLUMN paid_amount NUMERIC(12,2), ADD COLUMN payment JSONB,
      DROP CONSTRAINT staff_free_entries_benefit_check,
      ADD CONSTRAINT staff_free_entries_benefit_check CHECK (benefit IN ('allowance','busy_night','assistant_manager','management','override','paid')),
      ADD CONSTRAINT staff_entries_paid_check CHECK (
        (benefit = 'paid' AND paid_amount IS NOT NULL AND paid_amount > 0 AND payment IS NOT NULL)
        OR (benefit <> 'paid' AND paid_amount IS NULL AND payment IS NULL))`, { transaction });
  });
}
export async function down({ context }: { context: QueryInterface }): Promise<void> {
  await context.sequelize.transaction(async transaction => {
    await context.sequelize.query(`ALTER TABLE staff_free_entries
      DROP CONSTRAINT staff_entries_paid_check, DROP CONSTRAINT staff_free_entries_benefit_check,
      ADD CONSTRAINT staff_free_entries_benefit_check CHECK (benefit IN ('allowance','busy_night','assistant_manager','management','override')),
      DROP COLUMN paid_amount, DROP COLUMN payment`, { transaction });
  });
}
