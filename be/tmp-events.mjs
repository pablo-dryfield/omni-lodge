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
const res = await client.query('SELECT * FROM booking_events WHERE booking_id=111 ORDER BY id;');
console.log(res.rows);
await client.end();
