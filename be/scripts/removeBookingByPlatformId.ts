import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const { Client } = pg;

async function main() {
  const targetPlatformBookingId = process.argv[2];
  if (!targetPlatformBookingId) {
    console.error('Usage: tsx scripts/removeBookingByPlatformId.ts <platformBookingId>');
    process.exit(1);
  }

  const environment = (process.env.NODE_ENV || 'development').trim();
  const envFile = environment === 'production' ? '.env.prod' : '.env.dev';
  dotenv.config({ path: path.resolve(__dirname, '..', envFile) });

  const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD } = process.env;
  if (!DB_HOST || !DB_PORT || !DB_NAME || !DB_USER) {
    throw new Error('Database credentials are not fully configured.');
  }

  const client = new Client({
    host: DB_HOST,
    port: Number.parseInt(DB_PORT, 10),
    database: DB_NAME,
    user: DB_USER,
    password: DB_PASSWORD,
  });

  await client.connect();

  try {
    await client.query('BEGIN');

    const bookingResult = await client.query<{
      id: number;
      platform: string;
      status: string;
      experience_date: string | null;
      product_name: string | null;
    }>(
      `SELECT id, platform, status, experience_date, product_name
       FROM bookings
       WHERE platform_booking_id = $1
       FOR UPDATE`,
      [targetPlatformBookingId],
    );

    if (bookingResult.rowCount === 0) {
      await client.query('ROLLBACK');
      console.log(`No booking found for platform_booking_id=${targetPlatformBookingId}`);
      return;
    }

    const bookingIds = bookingResult.rows.map((row) => row.id);
    const bookingSummary = bookingResult.rows
      .map(
        (row) =>
          `  - DB id ${row.id} | platform ${row.platform} | status ${row.status} | product ${row.product_name ?? 'n/a'} | date ${row.experience_date ?? 'n/a'}`,
      )
      .join('\n');
    console.log(`Removing ${bookingIds.length} booking record(s):\n${bookingSummary}`);

    const addonsCount = await client.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM booking_addons WHERE booking_id = ANY($1::bigint[])',
      [bookingIds],
    );
    const eventsCount = await client.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM booking_events WHERE booking_id = ANY($1::bigint[])',
      [bookingIds],
    );

    console.log(
      `Found ${addonsCount.rows[0].count} related booking_addons row(s) and ${eventsCount.rows[0].count} booking_events row(s).`,
    );

    const deleteAddons = await client.query(
      'DELETE FROM booking_addons WHERE booking_id = ANY($1::bigint[])',
      [bookingIds],
    );
    const deleteEvents = await client.query(
      'DELETE FROM booking_events WHERE booking_id = ANY($1::bigint[])',
      [bookingIds],
    );
    const deleteBookings = await client.query(
      'DELETE FROM bookings WHERE id = ANY($1::bigint[])',
      [bookingIds],
    );

    await client.query('COMMIT');

    console.log(
      `Deleted rows => bookings: ${deleteBookings.rowCount}, booking_addons: ${deleteAddons.rowCount}, booking_events: ${deleteEvents.rowCount}.`,
    );
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to remove booking records:', error);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('Unexpected failure while removing booking data:', error);
  process.exit(1);
});
