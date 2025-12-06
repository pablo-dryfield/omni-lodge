import dotenv from 'dotenv';
import pkg from 'pg';
dotenv.config({ path: '.env.dev' });
const { Client } = pkg;
const client = new Client({
  host: process.env.DB_HOST,
  port: +(process.env.DB_PORT ?? '5432'),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});
await client.connect();
const res = await client.query(`
  UPDATE bookings
     SET experience_start_at = experience_start_at + INTERVAL '1 hour',
         experience_end_at = CASE
           WHEN experience_end_at IS NOT NULL THEN experience_end_at + INTERVAL '1 hour'
           ELSE NULL
         END
   WHERE platform = 'fareharbor'
     AND experience_start_at >= TIMESTAMP '2025-08-01 00:00:00+00';
`);
console.log('Rows updated:', res.rowCount);
await client.end();
