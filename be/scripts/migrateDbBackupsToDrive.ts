import 'dotenv/config';
import logger from '../src/utils/logger.js';
import { syncLocalBackupsToDrive } from '../src/services/dbBackupService.js';

async function main(): Promise<void> {
  const mode = (process.env.DB_BACKUP_STORAGE ?? 'local').toLowerCase();
  if (mode !== 'drive') {
    logger.warn('DB_BACKUP_STORAGE is not set to "drive". Set it before running the migration.');
  }

  logger.info('Starting one-time migration of local backups to Google Drive...');
  const { uploaded, skipped } = await syncLocalBackupsToDrive({
    deleteAfterUpload: true,
    skipExisting: true,
  });

  logger.info(`Backup migration completed. Uploaded=${uploaded.length}, skipped=${skipped.length}`);
  if (uploaded.length) {
    uploaded.forEach((filename) => logger.info(`Uploaded: ${filename}`));
  }
  if (skipped.length) {
    skipped.forEach((filename) => logger.info(`Skipped (already on Drive): ${filename}`));
  }
}

main().catch((error) => {
  console.error('Backup migration failed', error);
  process.exitCode = 1;
});
