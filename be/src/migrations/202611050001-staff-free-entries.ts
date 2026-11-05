import type { QueryInterface } from 'sequelize';
type Params = { context: QueryInterface };

export async function up({ context }: Params): Promise<void> {
  await context.sequelize.transaction(async transaction => {
    await context.sequelize.query(`CREATE TABLE staff_free_entries (
      id SERIAL PRIMARY KEY,
      counter_id INTEGER NOT NULL REFERENCES counters(id) ON DELETE RESTRICT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      visit_date DATE NOT NULL,
      staff_type VARCHAR(64) NOT NULL,
      benefit VARCHAR(32) NOT NULL CHECK (benefit IN ('allowance','busy_night','assistant_manager','override')),
      checked_in_before INTEGER NOT NULL CHECK (checked_in_before >= 0),
      policy_snapshot JSONB NOT NULL,
      override_reason TEXT,
      created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      cancelled_at TIMESTAMPTZ,
      cancelled_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
      cancellation_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (benefit <> 'override' OR LENGTH(TRIM(override_reason)) > 0 AND override_reason IS NOT NULL),
      CHECK ((cancelled_at IS NULL AND cancelled_by IS NULL AND cancellation_reason IS NULL)
        OR (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND cancellation_reason IS NOT NULL AND LENGTH(TRIM(cancellation_reason)) > 0))
    )`, { transaction });
    await context.sequelize.query('CREATE UNIQUE INDEX staff_free_entries_counter_user_active ON staff_free_entries(counter_id, user_id) WHERE cancelled_at IS NULL', { transaction });
    await context.sequelize.query('CREATE INDEX staff_free_entries_user_history ON staff_free_entries(user_id, created_at DESC)', { transaction });
  });
}

export async function down({ context }: Params): Promise<void> {
  // Rollback is deliberately refused once operational attendance history exists.
  await context.sequelize.query(`DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM staff_free_entries) THEN RAISE EXCEPTION 'Preserve staff free-entry history before rolling back'; END IF;
    DROP TABLE staff_free_entries;
  END $$`);
}
