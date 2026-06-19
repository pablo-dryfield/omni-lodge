import FinanceFile from '../models/FinanceFile.js';
import FinanceTransaction from '../models/FinanceTransaction.js';
import logger from '../../utils/logger.js';
import { deleteFinanceFileFromDrive } from './driveService.js';

export async function cleanupInvoiceFileIfOrphan(invoiceFileId: number | null): Promise<void> {
  if (!invoiceFileId) {
    return;
  }

  const remainingReferences = await FinanceTransaction.count({
    where: { invoiceFileId },
  });
  if (remainingReferences > 0) {
    return;
  }

  const invoiceFile = await FinanceFile.findByPk(invoiceFileId);
  if (!invoiceFile) {
    return;
  }

  try {
    await deleteFinanceFileFromDrive(invoiceFile.driveFileId);
  } catch (error) {
    logger.error(
      `Failed to remove orphaned finance invoice file #${invoiceFileId}: ${String(
        (error as Error).message,
      )}`,
    );
    return;
  }

  await FinanceFile.destroy({ where: { id: invoiceFileId } });
}

export async function deleteFinanceTransactionAndCleanupInvoice(
  transaction: FinanceTransaction,
): Promise<void> {
  const invoiceFileId = transaction.invoiceFileId ?? null;

  await FinanceTransaction.destroy({ where: { id: transaction.id } });

  await cleanupInvoiceFileIfOrphan(invoiceFileId);
}
