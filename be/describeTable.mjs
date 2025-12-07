import dotenv from 'dotenv';
import pkg from 'pg';
dotenv.config({ path: '.env.dev' });
const { Client } = pkg;
const table = process.argv[2];
if (!table) {
  throw new Error('table name required');
}
const client = new Client({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? '5432'),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});
await client.connect();
const res = await client.query(`SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name='${table}' ORDER BY ordinal_position`);
console.log(res.rows);
await client.end();
