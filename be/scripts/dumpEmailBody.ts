import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const { Client } = pg;

type GmailMessage = {
  payload?: GmailMessagePart;
};

type GmailMessagePart = {
  mimeType?: string;
  filename?: string;
  body?: { size?: number; data?: string | null };
  parts?: GmailMessagePart[];
};

const decodeBase64Url = (input: string): string => {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4;
  const padded = padding === 0 ? normalized : normalized + '='.repeat(4 - padding);
  return Buffer.from(padded, 'base64').toString('utf-8');
};

const stripHtmlToText = (html: string): string => {
  if (!html) {
    return '';
  }
  const withoutBlocks = html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<\/(p|div|li|tr|td)>/gi, '$&\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return withoutBlocks.replace(/\s+/g, ' ').trim();
};

const collectMessageBodies = (payload?: GmailMessagePart): { textBody: string | null; htmlBody: string | null } => {
  if (!payload) {
    return { textBody: null, htmlBody: null };
  }
  const texts: string[] = [];
  const htmls: string[] = [];

  const traverse = (part?: GmailMessagePart): void => {
    if (!part) {
      return;
    }
    const data = part.body?.data;
    if (data && part.mimeType) {
      const decoded = decodeBase64Url(data);
      if (part.mimeType.startsWith('text/plain')) {
        texts.push(decoded);
      } else if (part.mimeType.startsWith('text/html')) {
        htmls.push(decoded);
      }
    }
    if (part.parts) {
      for (const child of part.parts) {
        traverse(child);
      }
    }
  };

  traverse(payload);
  return {
    textBody: texts.length > 0 ? texts.join('\n') : null,
    htmlBody: htmls.length > 0 ? htmls.join('\n') : null,
  };
};

async function main() {
  const messageId = process.argv[2];
  if (!messageId) {
    console.error('Usage: tsx scripts/dumpEmailBody.ts <messageId>');
    process.exit(1);
  }

  const environment = (process.env.NODE_ENV || 'development').trim();
  const envFile = environment === 'production' ? '.env.prod' : '.env.dev';
  dotenv.config({ path: path.resolve(__dirname, '..', envFile) });

  const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD } = process.env;
  if (!DB_HOST || !DB_PORT || !DB_NAME || !DB_USER) {
    throw new Error('Database credentials are not fully configured.');
  }

  const client = new Client({
    host: DB_HOST,
    port: Number.parseInt(DB_PORT, 10),
    database: DB_NAME,
    user: DB_USER,
    password: DB_PASSWORD,
  });

  await client.connect();

  try {
    const emailRes = await client.query(
      `SELECT id, message_id, subject, snippet, raw_payload
       FROM booking_emails
       WHERE message_id = $1`,
      [messageId],
    );
    if (emailRes.rowCount === 0) {
      console.log(`No booking email found for message_id=${messageId}`);
      return;
    }
    const email = emailRes.rows[0];
    console.log('Email metadata:', JSON.stringify({ id: email.id, message_id: email.message_id, subject: email.subject }, null, 2));

    let message: GmailMessage | null = null;
    if (email.raw_payload) {
      try {
        message = JSON.parse(email.raw_payload) as GmailMessage;
      } catch (error) {
        console.error('Failed to parse raw_payload JSON:', error);
      }
    }
    if (!message?.payload) {
      console.log('No payload found in stored message.');
      return;
    }

    const bodies = collectMessageBodies(message.payload);
    if (bodies.textBody) {
      console.log('\n---- TEXT BODY ----\n');
      console.log(bodies.textBody);
    }
    if (bodies.htmlBody) {
      console.log('\n---- HTML BODY (stripped) ----\n');
      console.log(stripHtmlToText(bodies.htmlBody));
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('Failed to dump email body:', error);
  process.exit(1);
});
