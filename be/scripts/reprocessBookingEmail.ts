import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const environment = (process.env.NODE_ENV || 'development').trim();
const envFile = environment === 'production' ? '.env.prod' : '.env.dev';
dotenv.config({ path: path.resolve(__dirname, '..', envFile) });

await import('../src/models/defineAssociations.js');
await import('../src/config/database.js');
const { processBookingEmail } = await import('../src/services/bookings/bookingIngestionService.js');

async function main() {
  const messageId = process.argv[2];
  if (!messageId) {
    console.error('Usage: tsx scripts/reprocessBookingEmail.ts <messageId>');
    process.exit(1);
  }

  try {
    const result = await processBookingEmail(messageId, { force: true });
    console.log(`Reprocessed message ${messageId} with result=${result}`);
  } catch (error) {
    console.error(`Failed to reprocess ${messageId}:`, error);
    process.exitCode = 1;
  }
}

main();
