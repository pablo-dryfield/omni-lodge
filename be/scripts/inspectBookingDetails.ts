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
    console.error('Usage: tsx scripts/inspectBookingDetails.ts <platformBookingId>');
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
    const bookingRes = await client.query(
      `SELECT id, platform, status, product_name, product_variant, addons_snapshot, experience_date,
              party_size_total, base_amount, addons_amount, last_email_message_id, created_at, updated_at
       FROM bookings
       WHERE platform_booking_id = $1`,
      [targetPlatformBookingId],
    );

    if (bookingRes.rowCount === 0) {
      console.log(`No booking found for platform_booking_id=${targetPlatformBookingId}`);
      return;
    }

    for (const booking of bookingRes.rows) {
      console.log('Booking:');
      console.log(JSON.stringify(booking, null, 2));

      const addonsRes = await client.query(
        `SELECT id, platform_addon_id, platform_addon_name, quantity, unit_price, total_price, currency, metadata
         FROM booking_addons
         WHERE booking_id = $1
         ORDER BY id`,
        [booking.id],
      );
      console.log(`\nAssociated booking_addons (count=${addonsRes.rowCount}):`);
      for (const addon of addonsRes.rows) {
        console.log(JSON.stringify(addon, null, 2));
      }

      const eventsRes = await client.query(
        `SELECT id, event_type, status_after, event_payload, occurred_at, ingested_at, processed_at
         FROM booking_events
         WHERE booking_id = $1
         ORDER BY id`,
        [booking.id],
      );
      console.log(`\nAssociated booking_events (count=${eventsRes.rowCount}):`);
      for (const event of eventsRes.rows) {
        console.log(JSON.stringify(event, null, 2));
      }

      if (booking.last_email_message_id) {
        const emailRes = await client.query(
          `SELECT id, message_id, subject, snippet, received_at
           FROM booking_emails
           WHERE message_id = $1`,
          [booking.last_email_message_id],
        );
        console.log(`\nLast email record (count=${emailRes.rowCount}):`);
        for (const email of emailRes.rows) {
          console.log(JSON.stringify(email, null, 2));
        }
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('Failed to inspect booking details:', error);
  process.exit(1);
});
