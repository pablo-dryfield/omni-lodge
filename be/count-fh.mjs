import dotenv from 'dotenv';
import pkg from 'pg';
dotenv.config({ path: '.env.dev' });
const { Client } = pkg;
const client = new Client({host:process.env.DB_HOST,port:+(process.env.DB_PORT ?? '5432'),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
await client.connect();
const res = await client.query("SELECT COUNT(DISTINCT last_email_message_id) AS total FROM bookings WHERE platform='fareharbor' AND last_email_message_id IS NOT NULL AND experience_start_at >= TIMESTAMP '2025-01-01 00:00:00+00';");
console.log(res.rows[0]);
await client.end();
