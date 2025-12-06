import dotenv from 'dotenv';
import pkg from 'pg';
dotenv.config({ path: '.env.dev' });
const { Client } = pkg;
const client = new Client({host:process.env.DB_HOST,port:+(process.env.DB_PORT??'5432'),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
await client.connect();
const res = await client.query("SELECT raw_payload FROM booking_emails WHERE message_id='19ada231b14c8f3b';");
if (res.rows.length) {
  const payload = JSON.parse(res.rows[0].raw_payload);
  const queue = [...(payload.payload?.parts ?? [])];
  let html = '';
  while (queue.length) {
    const part = queue.shift();
    if (!part) continue;
    if (part.mimeType === 'text/html' && part.body?.data) {
      html = Buffer.from(part.body.data, 'base64').toString('utf8');
      break;
    }
    if (part.parts) {
      queue.push(...part.parts);
    }
  }
  if (html) {
    const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
    const idx = text.indexOf('Booking #');
    console.log(text.slice(idx, idx + 400));
  }
}
await client.end();
