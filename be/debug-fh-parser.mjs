import dotenv from 'dotenv';
import pkg from 'pg';
import { FareHarborBookingParser } from './dist/services/bookings/parsers/fareHarborBookingParser.js';
dotenv.config({ path: '.env.dev' });
const { Client } = pkg;
const client = new Client({host:process.env.DB_HOST,port:+(process.env.DB_PORT??'5432'),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
await client.connect();
const { rows } = await client.query("SELECT * FROM booking_emails WHERE message_id='19ada231b14c8f3b';");
await client.end();
if (rows.length === 0) {
  console.error('Email not found');
  process.exit(1);
}
const record = rows[0];
const payload = JSON.parse(record.raw_payload);
const extractPart = (mime) => {
  const stack = [payload.payload];
  while (stack.length) {
    const part = stack.pop();
    if (!part) continue;
    if (part.mimeType === mime && part.body?.data) {
      return Buffer.from(part.body.data, 'base64').toString('utf8');
    }
    if (part.parts) {
      stack.push(...part.parts);
    }
  }
  return '';
};
const html = extractPart('text/html');
let text = extractPart('text/plain');
if (!text && html) {
  text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
}
const parser = new FareHarborBookingParser();
const context = {
  messageId: record.message_id,
  threadId: record.thread_id,
  historyId: record.history_id,
  subject: record.subject,
  snippet: record.snippet,
  from: record.from_address,
  to: record.to_addresses,
  cc: record.cc_addresses,
  receivedAt: record.received_at,
  internalDate: record.internal_date,
  headers: record.headers,
  textBody: text,
  rawTextBody: text,
  htmlBody: html,
};
const result = await parser.parse(context);
if (!result) {
  console.error('Parser returned null');
  process.exit(1);
}
console.log({
  platformBookingId: result.platformBookingId,
  productName: result.bookingFields?.productName,
  experienceDate: result.bookingFields?.experienceDate,
  experienceStartAt: result.bookingFields?.experienceStartAt,
});
