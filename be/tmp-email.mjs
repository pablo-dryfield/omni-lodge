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
const res = await client.query("SELECT subject, snippet, raw_payload FROM booking_emails WHERE message_id='19a929c809d84a48';");
const row = res.rows[0];
console.log(row.subject);
console.log(row.snippet);
const payload = JSON.parse(row.raw_payload);
const stack = [payload.payload];
let html = '';
let text = '';
while (stack.length) {
  const part = stack.pop();
  if (!part) continue;
  if (part.mimeType === 'text/plain' && part.body?.data) {
    text = Buffer.from(part.body.data, 'base64').toString('utf8');
  }
  if (part.mimeType === 'text/html' && part.body?.data) {
    html = Buffer.from(part.body.data, 'base64').toString('utf8');
  }
  if (part.parts) {
    stack.push(...part.parts);
  }
}
const plain = text || html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi,' ').replace(/\s+/g,' ').trim();
console.log(plain.slice(0,800));
await client.end();
