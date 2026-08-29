import FinanceFile from '../models/FinanceFile.js';
import FinanceTransaction from '../models/FinanceTransaction.js';
import logger from '../../utils/logger.js';
import { deleteFinanceFileFromDrive } from './driveService.js';
import sequelize from '../../config/database.js';
import { assertFinanceTransactionIsNotReceiptProtected } from '../../services/staffPayoutReceiptProtectionService.js';

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
  if (!invoiceFile || invoiceFile.purpose !== 'general') {
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
  let invoiceFileId: number | null = null;

  await sequelize.transaction(async (databaseTransaction) => {
    const lockedTransaction = await FinanceTransaction.findByPk(transaction.id, {
      transaction: databaseTransaction,
      lock: databaseTransaction.LOCK.UPDATE,
    });
    if (!lockedTransaction) {
      throw new Error('Transaction not found');
    }

    await assertFinanceTransactionIsNotReceiptProtected(
      lockedTransaction.id,
      databaseTransaction,
    );
    invoiceFileId = lockedTransaction.invoiceFileId ?? null;
    await FinanceTransaction.destroy({
      where: { id: lockedTransaction.id },
      transaction: databaseTransaction,
    });
  });

  await cleanupInvoiceFileIfOrphan(invoiceFileId);
}
