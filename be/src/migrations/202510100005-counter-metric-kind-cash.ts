import type { QueryInterface } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const ENUM_NAME = 'enum_counter_channel_metrics_kind';
const NEW_VALUE = 'cash_payment';

export async function up({ context }: MigrationParams): Promise<void> {
  await context.sequelize.query(
    `
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_enum
        WHERE enumlabel = '${NEW_VALUE}'
          AND enumtypid = (
            SELECT oid
            FROM pg_type
            WHERE typname = '${ENUM_NAME}'
          )
      ) THEN
        ALTER TYPE "${ENUM_NAME}" ADD VALUE '${NEW_VALUE}';
      END IF;
    END$$;
  `,
  );
}

export async function down({ context }: MigrationParams): Promise<void> {
  // PostgreSQL does not support dropping enum values easily without recreating the type.
  // Leaving this migration irreversible.
  await context.sequelize.query('/* no-op */');
}
