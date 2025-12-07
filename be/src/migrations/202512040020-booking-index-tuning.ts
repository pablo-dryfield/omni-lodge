import type { QueryInterface } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE_BOOKINGS = 'bookings';
const TABLE_BOOKING_EMAILS = 'booking_emails';
const TABLE_BOOKING_EVENTS = 'booking_events';

const runSql = (qi: QueryInterface, sql: string): Promise<unknown> => qi.sequelize.query(sql);

const DROP_DUPLICATE_EMAIL_INDEXES = `
DO $$
DECLARE rec RECORD;
BEGIN
  FOR rec IN (
    SELECT conname
    FROM pg_constraint
    WHERE connamespace = 'public'::regnamespace
      AND conrelid = '${TABLE_BOOKING_EMAILS}'::regclass
      AND conname LIKE 'booking_emails_message_id_key%'
  ) LOOP
    EXECUTE format('ALTER TABLE ${TABLE_BOOKING_EMAILS} DROP CONSTRAINT IF EXISTS %I', rec.conname);
  END LOOP;

  FOR rec IN (
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = '${TABLE_BOOKING_EMAILS}'
      AND indexname LIKE 'booking_emails_message_id_key%'
  ) LOOP
    EXECUTE format('DROP INDEX IF EXISTS %I', rec.indexname);
  END LOOP;
END $$;
`;

const ADD_MESSAGE_ID_UNIQUENESS = `
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = '${TABLE_BOOKING_EMAILS}'::regclass
      AND conname = 'booking_emails_message_id_key'
  ) THEN
    ALTER TABLE "${TABLE_BOOKING_EMAILS}" ADD CONSTRAINT booking_emails_message_id_key UNIQUE (message_id);
  END IF;
END $$;
`;

const CREATE_INDEXES_SQL = [
  `CREATE INDEX IF NOT EXISTS booking_emails_received_at_idx ON "${TABLE_BOOKING_EMAILS}" (received_at DESC, id);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS bookings_platform_booking_id_key ON "${TABLE_BOOKINGS}" (platform, platform_booking_id);`,
  `CREATE INDEX IF NOT EXISTS bookings_experience_date_start_idx ON "${TABLE_BOOKINGS}" (experience_date, experience_start_at, id);`,
  `CREATE INDEX IF NOT EXISTS bookings_status_experience_date_idx ON "${TABLE_BOOKINGS}" (status, experience_date);`,
  `CREATE INDEX IF NOT EXISTS bookings_last_email_message_id_idx ON "${TABLE_BOOKINGS}" (last_email_message_id);`,
  `CREATE INDEX IF NOT EXISTS booking_events_booking_created_idx ON "${TABLE_BOOKING_EVENTS}" (booking_id, created_at);`,
  `CREATE INDEX IF NOT EXISTS booking_events_email_idx ON "${TABLE_BOOKING_EVENTS}" (email_id);`,
];

const DROP_INDEXES_SQL = [
  `DROP INDEX IF EXISTS booking_emails_received_at_idx;`,
  `ALTER TABLE "${TABLE_BOOKING_EMAILS}" DROP CONSTRAINT IF EXISTS booking_emails_message_id_key;`,
  `DROP INDEX IF EXISTS bookings_platform_booking_id_key;`,
  `DROP INDEX IF EXISTS bookings_experience_date_start_idx;`,
  `DROP INDEX IF EXISTS bookings_status_experience_date_idx;`,
  `DROP INDEX IF EXISTS bookings_last_email_message_id_idx;`,
  `DROP INDEX IF EXISTS booking_events_booking_created_idx;`,
  `DROP INDEX IF EXISTS booking_events_email_idx;`,
];

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  await runSql(qi, DROP_DUPLICATE_EMAIL_INDEXES);
  await runSql(qi, ADD_MESSAGE_ID_UNIQUENESS);
  for (const statement of CREATE_INDEXES_SQL) {
    await runSql(qi, statement);
  }
}

export async function down({ context }: MigrationParams): Promise<void> {
  const qi = context;
  for (const statement of DROP_INDEXES_SQL) {
    await runSql(qi, statement);
  }
}
