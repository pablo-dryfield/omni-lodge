import dotenv from 'dotenv';
import pkg from 'pg';
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'warn';
dotenv.config({ path: '.env.dev' });
const { Client } = pkg;
const { processBookingEmail } = await import('../dist/services/bookings/bookingIngestionService.js');

const client = new Client({
  host: process.env.DB_HOST,
  port: +(process.env.DB_PORT ?? '5432'),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});
await client.connect();
const limit = Number(process.argv[2] ?? '250');
const offset = Number(process.argv[3] ?? '0');

const { rows } = await client.query(
  `
  SELECT DISTINCT last_email_message_id, experience_start_at
  FROM bookings
  WHERE platform = 'fareharbor'
    AND last_email_message_id IS NOT NULL
    AND experience_start_at >= TIMESTAMP '2025-01-01 00:00:00+00'
  ORDER BY experience_start_at ASC, last_email_message_id ASC
  OFFSET $1 LIMIT $2;
`,
  [offset, limit],
);
await client.end();

let processed = 0;
for (const row of rows) {
  const messageId = row.last_email_message_id;
  try {
    const result = await processBookingEmail(messageId, { force: true });
    if (processed % 25 === 0) {
      console.log(`processed ${processed + 1}/${rows.length} -> ${result}`);
    }
  } catch (error) {
    console.error(`failed ${messageId}`, error);
  }
  processed += 1;
}
console.log(`Reprocessed ${processed} FareHarbor emails`);
