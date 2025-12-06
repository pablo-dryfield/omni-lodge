import dotenv from 'dotenv';
import pkg from 'pg';
dotenv.config({ path: '.env.dev' });
const { Client } = pkg;
const client = new Client({ host: process.env.DB_HOST, port: +(process.env.DB_PORT ?? '5432'), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
await client.connect();
const res = await client.query("SELECT platform_booking_id, experience_start_at FROM bookings WHERE platform='fareharbor' AND to_char(experience_start_at,'HH24:MI')='20:00' ORDER BY experience_start_at LIMIT 50;");
console.log(res.rows);
await client.end();
