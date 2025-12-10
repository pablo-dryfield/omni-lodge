import type { QueryInterface } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const ADD_PLATFORM_SQL = (typeName: string, value: string): string => `
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = '${typeName}' AND e.enumlabel = '${value}'
  ) THEN
    ALTER TYPE "${typeName}" ADD VALUE '${value}';
  END IF;
END $$;
`;

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  await qi.sequelize.query(ADD_PLATFORM_SQL('enum_bookings_platform', 'xperiencepoland'));
  await qi.sequelize.query(ADD_PLATFORM_SQL('enum_booking_events_platform', 'xperiencepoland'));
}

export async function down(): Promise<void> {
  // Removing enum values safely is destructive; leave as no-op.
}
