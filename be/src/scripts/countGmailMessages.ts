import dotenv from 'dotenv';
const environment = (process.env.NODE_ENV || 'development').trim();
const envFile = environment === 'production' ? '.env.prod' : '.env.dev';
dotenv.config({ path: envFile });

const loggerModule = await import('../utils/logger.js');
const gmailClientModule = await import('../services/bookings/gmailClient.js');
const logger = loggerModule.default;
const { listMessages } = gmailClientModule;

const DEFAULT_BATCH = 500;
const batchArg = Number.parseInt(process.argv[2] ?? '', 10);
const batchSize = Number.isFinite(batchArg) && batchArg > 0 ? batchArg : DEFAULT_BATCH;
const queryArg = process.argv.length > 3 ? process.argv[3] : '';

const run = async (): Promise<void> => {
  let total = 0;
  let pageToken: string | null = null;
  let totalEstimate: number | null = null;

  logger.info(`[gmail-count] Starting mailbox count (batch=${batchSize}, query="${queryArg || 'ALL'}")`);

  do {
    const { messages, nextPageToken, totalSizeEstimate } = await listMessages({
      query: queryArg,
      maxResults: batchSize,
      pageToken,
    });

    if (totalEstimate === null && totalSizeEstimate !== null) {
      totalEstimate = totalSizeEstimate;
      logger.info(`[gmail-count] Gmail reported estimate ${totalEstimate}`);
    }

    const batchCount = messages.length;
    total += batchCount;
    if (totalEstimate) {
      const completion = Math.min((total / totalEstimate) * 100, 100);
      logger.debug(
        `[gmail-count] Retrieved ${batchCount} messages (running total ${total}, ~${completion.toFixed(2)}%)`,
      );
    } else {
      logger.debug(`[gmail-count] Retrieved ${batchCount} messages (running total ${total})`);
    }
    pageToken = nextPageToken;
  } while (pageToken);

  logger.info(`[gmail-count] Exact Gmail message total: ${total}`);
};

run().catch((error) => {
  logger.error(`[gmail-count] Failed to count mailbox: ${(error as Error).message}`);
  process.exit(1);
});
