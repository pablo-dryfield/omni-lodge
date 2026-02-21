import type { QueryInterface } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const KNOWN_PLATFORMS = [
  'fareharbor',
  'ecwid',
  'viator',
  'getyourguide',
  'freetour',
  'xperiencepoland',
  'airbnb',
  'manual',
  'unknown',
] as const;

const quoteList = KNOWN_PLATFORMS.map((value) => `'${value}'`).join(', ');

export async function up({ context }: MigrationParams): Promise<void> {
  await context.sequelize.query(`
    ALTER TABLE "bookings"
    ALTER COLUMN "platform" TYPE VARCHAR(64)
    USING "platform"::text;
  `);

  await context.sequelize.query(`
    ALTER TABLE "booking_events"
    ALTER COLUMN "platform" TYPE VARCHAR(64)
    USING "platform"::text;
  `);

  await context.sequelize.query('DROP TYPE IF EXISTS "enum_bookings_platform";');
  await context.sequelize.query('DROP TYPE IF EXISTS "enum_booking_events_platform";');
}

export async function down({ context }: MigrationParams): Promise<void> {
  await context.sequelize.query(`
    CREATE TYPE "enum_bookings_platform" AS ENUM (${quoteList});
  `);
  await context.sequelize.query(`
    CREATE TYPE "enum_booking_events_platform" AS ENUM (${quoteList});
  `);

  await context.sequelize.query(`
    ALTER TABLE "bookings"
    ALTER COLUMN "platform" TYPE "enum_bookings_platform"
    USING (
      CASE
        WHEN "platform" IN (${quoteList}) THEN "platform"::"enum_bookings_platform"
        ELSE 'unknown'::"enum_bookings_platform"
      END
    );
  `);

  await context.sequelize.query(`
    ALTER TABLE "booking_events"
    ALTER COLUMN "platform" TYPE "enum_booking_events_platform"
    USING (
      CASE
        WHEN "platform" IN (${quoteList}) THEN "platform"::"enum_booking_events_platform"
        ELSE 'unknown'::"enum_booking_events_platform"
      END
    );
  `);
}
