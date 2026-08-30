import type { QueryInterface, Transaction } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const USER_TYPE_PERIODS = 'user_type_membership_periods';
const SHIFT_ROLE_PERIODS = 'user_shift_role_membership_periods';
const STAFF_TYPE_PERIODS = 'staff_profile_type_periods';

export async function up({ context }: MigrationParams): Promise<void> {
  const transaction: Transaction = await context.sequelize.transaction();
  try {
    await context.sequelize.query('CREATE EXTENSION IF NOT EXISTS btree_gist;', { transaction });

    await context.sequelize.query(
      `CREATE TABLE ${USER_TYPE_PERIODS} (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        user_type_id INTEGER NOT NULL REFERENCES "userTypes"(id) ON DELETE RESTRICT,
        effective_start DATE NOT NULL,
        effective_end DATE NULL,
        created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
        ended_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
        change_reason TEXT NULL,
        source VARCHAR(64) NOT NULL DEFAULT 'application',
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT user_type_membership_period_dates_ck
          CHECK (effective_end IS NULL OR effective_end >= effective_start),
        CONSTRAINT user_type_membership_period_no_overlap_excl
          EXCLUDE USING gist (
            user_id WITH =,
            daterange(effective_start, COALESCE(effective_end, 'infinity'::date), '[]') WITH &&
          )
      );
      CREATE INDEX user_type_membership_period_lookup_idx
        ON ${USER_TYPE_PERIODS} (user_id, effective_start, effective_end);
      CREATE UNIQUE INDEX user_type_membership_period_open_uidx
        ON ${USER_TYPE_PERIODS} (user_id)
        WHERE effective_end IS NULL;`,
      { transaction },
    );

    await context.sequelize.query(
      `CREATE TABLE ${SHIFT_ROLE_PERIODS} (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        shift_role_id INTEGER NOT NULL REFERENCES shift_roles(id) ON DELETE RESTRICT,
        effective_start DATE NOT NULL,
        effective_end DATE NULL,
        created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
        ended_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
        change_reason TEXT NULL,
        source VARCHAR(64) NOT NULL DEFAULT 'application',
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT user_shift_role_membership_period_dates_ck
          CHECK (effective_end IS NULL OR effective_end >= effective_start),
        CONSTRAINT user_shift_role_membership_period_no_overlap_excl
          EXCLUDE USING gist (
            user_id WITH =,
            shift_role_id WITH =,
            daterange(effective_start, COALESCE(effective_end, 'infinity'::date), '[]') WITH &&
          )
      );
      CREATE INDEX user_shift_role_membership_period_lookup_idx
        ON ${SHIFT_ROLE_PERIODS} (user_id, effective_start, effective_end);
      CREATE INDEX user_shift_role_membership_period_role_lookup_idx
        ON ${SHIFT_ROLE_PERIODS} (shift_role_id, effective_start, effective_end);
      CREATE UNIQUE INDEX user_shift_role_membership_period_open_uidx
        ON ${SHIFT_ROLE_PERIODS} (user_id, shift_role_id)
        WHERE effective_end IS NULL;`,
      { transaction },
    );

    await context.sequelize.query(
      `CREATE TABLE ${STAFF_TYPE_PERIODS} (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        staff_type VARCHAR(64) NOT NULL,
        effective_start DATE NOT NULL,
        effective_end DATE NULL,
        created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
        ended_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
        change_reason TEXT NULL,
        source VARCHAR(64) NOT NULL DEFAULT 'application',
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT staff_profile_type_period_dates_ck
          CHECK (effective_end IS NULL OR effective_end >= effective_start),
        CONSTRAINT staff_profile_type_period_value_ck
          CHECK (staff_type IN ('volunteer', 'long_term', 'assistant_manager', 'manager', 'guide')),
        CONSTRAINT staff_profile_type_period_no_overlap_excl
          EXCLUDE USING gist (
            user_id WITH =,
            daterange(effective_start, COALESCE(effective_end, 'infinity'::date), '[]') WITH &&
          )
      );
      CREATE INDEX staff_profile_type_period_lookup_idx
        ON ${STAFF_TYPE_PERIODS} (user_id, effective_start, effective_end);
      CREATE INDEX staff_profile_type_period_type_lookup_idx
        ON ${STAFF_TYPE_PERIODS} (staff_type, effective_start, effective_end);
      CREATE UNIQUE INDEX staff_profile_type_period_open_uidx
        ON ${STAFF_TYPE_PERIODS} (user_id)
        WHERE effective_end IS NULL;`,
      { transaction },
    );

    // These rows deliberately assert only the state observed on migration day.
    // Older membership cannot be reconstructed safely from mutable projections.
    await context.sequelize.query(
      `INSERT INTO ${USER_TYPE_PERIODS} (
         user_id, user_type_id, effective_start, source, metadata
       )
       SELECT
         observed_user.id,
         observed_user."userTypeId",
         (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Warsaw')::date,
         'migration_current_state',
         '{"confidence":"current_only","backfill":"projection"}'::jsonb
       FROM users AS observed_user
       JOIN "userTypes" AS observed_user_type
         ON observed_user_type.id = observed_user."userTypeId"
       ON CONFLICT DO NOTHING;

       INSERT INTO ${SHIFT_ROLE_PERIODS} (
         user_id, shift_role_id, effective_start, source, metadata
       )
       SELECT
         observed_role_link.user_id,
         observed_role_link.shift_role_id,
         (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Warsaw')::date,
         'migration_current_state',
         '{"confidence":"current_only","backfill":"projection"}'::jsonb
       FROM user_shift_roles AS observed_role_link
       JOIN users AS role_user
         ON role_user.id = observed_role_link.user_id
       JOIN shift_roles AS observed_shift_role
         ON observed_shift_role.id = observed_role_link.shift_role_id
       ON CONFLICT DO NOTHING;

       INSERT INTO ${STAFF_TYPE_PERIODS} (
         user_id, staff_type, effective_start, source, metadata
       )
       SELECT
         observed_profile.user_id,
         observed_profile.staff_type::text,
         (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Warsaw')::date,
         'migration_current_state',
         '{"confidence":"current_only","backfill":"projection"}'::jsonb
       FROM staff_profiles AS observed_profile
       JOIN users AS profile_user
         ON profile_user.id = observed_profile.user_id
       WHERE observed_profile.staff_type IS NOT NULL
       ON CONFLICT DO NOTHING;`,
      { transaction },
    );

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function down({ context }: MigrationParams): Promise<void> {
  const transaction: Transaction = await context.sequelize.transaction();
  try {
    await context.sequelize.query(`DROP TABLE IF EXISTS ${STAFF_TYPE_PERIODS};`, { transaction });
    await context.sequelize.query(`DROP TABLE IF EXISTS ${SHIFT_ROLE_PERIODS};`, { transaction });
    await context.sequelize.query(`DROP TABLE IF EXISTS ${USER_TYPE_PERIODS};`, { transaction });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function verify({ context }: MigrationParams): Promise<{ ok: boolean; details: unknown }> {
  const [rows] = await context.sequelize.query(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          '${USER_TYPE_PERIODS}',
          '${SHIFT_ROLE_PERIODS}',
          '${STAFF_TYPE_PERIODS}'
        );`,
  );
  const found = new Set((rows as Array<{ table_name: string }>).map((row) => row.table_name));
  const missing = [USER_TYPE_PERIODS, SHIFT_ROLE_PERIODS, STAFF_TYPE_PERIODS]
    .filter((table) => !found.has(table));
  return { ok: missing.length === 0, details: { missing } };
}
