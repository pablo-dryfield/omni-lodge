import type { QueryInterface } from "sequelize";

type MigrationParams = { context: QueryInterface };
const STATUS_ENUM = "enum_finance_transactions_status";
const NEW_STATUS = "awaiting_reimbursement";

export async function up({ context }: MigrationParams): Promise<void> {
  await context.sequelize.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_type typ
        JOIN pg_enum enum_value ON enum_value.enumtypid = typ.oid
        WHERE typ.typname = '${STATUS_ENUM}'
          AND enum_value.enumlabel = '${NEW_STATUS}'
      ) THEN
        ALTER TYPE ${STATUS_ENUM} ADD VALUE '${NEW_STATUS}';
      END IF;
    END
    $$;
  `);
}

export async function down(): Promise<void> {
  // Postgres cannot easily remove enum values without dropping dependent data.
  // This down migration is intentionally left empty.
}
