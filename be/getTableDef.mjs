import dotenv from 'dotenv';
import pkg from 'pg';
dotenv.config({ path: '.env.dev' });
const { Client } = pkg;
const table = process.argv[2];
const client = new Client({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? '5432'),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});
await client.connect();
const res = await client.query(`SELECT pg_catalog.pg_get_tabledef('${table}'::regclass) AS ddl`);
console.log(res.rows[0]?.ddl);
await client.end();
