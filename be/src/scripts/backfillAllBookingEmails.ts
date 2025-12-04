import dotenv from 'dotenv';
import logger from '../utils/logger.js';
import { ingestAllBookingEmails } from '../services/bookings/bookingIngestionService.js';

const environment = (process.env.NODE_ENV || 'development').trim();
const envFile = environment === 'production' ? '.env.prod' : '.env.dev';
dotenv.config({ path: envFile });

const args = process.argv.slice(2);
let explicitQuery: string | undefined;
let explicitBatch: number | undefined;
let receivedAfter: string | undefined;
let receivedBefore: string | undefined;

args.forEach((arg) => {
  if (arg === '--all') {
    explicitQuery = '';
    return;
  }
  if (arg.startsWith('--query=')) {
    explicitQuery = arg.slice('--query='.length);
    return;
  }
  if (arg.startsWith('--batch=')) {
    const parsed = Number.parseInt(arg.slice('--batch='.length), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      explicitBatch = parsed;
    }
    return;
  }
  if (arg.startsWith('--after=')) {
    receivedAfter = arg.slice('--after='.length);
    return;
  }
  if (arg.startsWith('--before=')) {
    receivedBefore = arg.slice('--before='.length);
    return;
  }
  const numeric = Number.parseInt(arg, 10);
  if (!Number.isNaN(numeric) && explicitBatch === undefined) {
    explicitBatch = numeric;
    return;
  }
  if (explicitQuery === undefined) {
    explicitQuery = arg;
  }
});

const envQuery = process.env.BOOKING_BACKFILL_QUERY;
const queryArg = explicitQuery !== undefined ? explicitQuery : envQuery !== undefined ? envQuery : undefined;
const batchSize = explicitBatch ?? undefined;
if (receivedAfter || receivedBefore) {
  logger.info(
    `[booking-email] Date filters: ${receivedAfter ? `from ${receivedAfter}` : ''}${
      receivedAfter && receivedBefore ? ' ' : ''
    }${receivedBefore ? `until ${receivedBefore}` : ''}`,
  );
}

(async () => {
  logger.info(
    `[booking-email] Starting full Gmail ingestion run (query="${
      queryArg === undefined ? '(default)' : queryArg === '' ? '(all messages)' : queryArg
    }", after=${receivedAfter ?? 'none'}, before=${receivedBefore ?? 'none'})`,
  );
  await ingestAllBookingEmails({
    query: queryArg,
    batchSize,
    receivedAfter,
    receivedBefore,
  });
  logger.info('[booking-email] Full Gmail ingestion script finished.');
})();
