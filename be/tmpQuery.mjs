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
const res = await client.query(`SELECT raw_payload FROM booking_emails WHERE message_id = '19adb3e630ce6673'`);
console.log(res.rows[0]?.raw_payload?.slice(0,200));
await client.end();
