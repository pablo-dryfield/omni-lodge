import dotenv from 'dotenv';
import pkg from 'pg';
dotenv.config({ path: '.env.dev' });
const { Client } = pkg;
const client = new Client({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? '5432'),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});
await client.connect();
const bookingId = process.argv[2];
const { rows } = await client.query("SELECT id, platform, platform_booking_id, experience_start_at, last_email_message_id FROM bookings WHERE platform_booking_id = $1 ORDER BY id DESC", [bookingId]);
console.log(rows);
await client.end();
