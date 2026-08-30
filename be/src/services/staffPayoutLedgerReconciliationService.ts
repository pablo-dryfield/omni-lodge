import { type Transaction as SequelizeTransaction } from 'sequelize';
import HttpError from '../errors/HttpError.js';
import AffiliatePayoutLog from '../models/AffiliatePayoutLog.js';
import StaffPayoutCollectionLog from '../models/StaffPayoutCollectionLog.js';
import StaffPayoutLedger from '../models/StaffPayoutLedger.js';
import { getCanonicalPayablePaidMinor } from './staffPayoutAffiliateAccountingService.js';

const assertSafeLedgerMinor = (value: unknown): number => {
  const normalized = Number(value ?? 0);
  if (!Number.isSafeInteger(normalized)) {
    throw new HttpError(409, 'The persisted staff payout ledger could not be reconciled safely.');
  }
  return normalized;
};

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

const assertPayoutLogRange = (
  payoutLog: AffiliatePayoutLog,
): { rangeStart: string; rangeEnd: string } => {
  const rangeStart = String(payoutLog.rangeStart ?? '');
  const rangeEnd = String(payoutLog.rangeEnd ?? '');
  if (
    !DATE_ONLY_PATTERN.test(rangeStart)
    || !DATE_ONLY_PATTERN.test(rangeEnd)
    || rangeEnd < rangeStart
  ) {
    throw new HttpError(409, `Affiliate payout log #${payoutLog.id} has an invalid accounting range.`);
  }
  return { rangeStart, rangeEnd };
};

export const loadImmutableUncollectedAffiliatePaidMinor = async (params: {
  staffUserId: number;
  rangeStart: string;
  rangeEnd: string;
  currencyCode: string;
  collectedFinanceTransactionIds: ReadonlySet<number>;
  transaction?: SequelizeTransaction;
}): Promise<number> => {
  const currencyCode = params.currencyCode.trim().toUpperCase();
  const payoutLogs = await AffiliatePayoutLog.findAll({
    attributes: [
      'id',
      'amountMinor',
      'rangeStart',
      'rangeEnd',
      'financeTransactionId',
      'paidDate',
    ],
    where: { affiliateUserId: params.staffUserId, currencyCode },
    order: [['paidDate', 'DESC'], ['id', 'DESC']],
    transaction: params.transaction,
  });
  let totalMinor = 0;
  for (const payoutLog of payoutLogs) {
    const financeTransactionId = Number(payoutLog.financeTransactionId ?? NaN);
    if (
      Number.isSafeInteger(financeTransactionId)
      && financeTransactionId > 0
      && params.collectedFinanceTransactionIds.has(financeTransactionId)
    ) {
      continue;
    }
    const logRange = assertPayoutLogRange(payoutLog);
    if (logRange.rangeEnd < params.rangeStart || logRange.rangeStart > params.rangeEnd) {
      continue;
    }
    if (logRange.rangeStart < params.rangeStart || logRange.rangeEnd > params.rangeEnd) {
      throw new HttpError(
        409,
        `Affiliate payout log #${payoutLog.id} spans more than one payout ledger period. Its immutable period allocation must be reconciled before staff pay can continue.`,
      );
    }
    const amountMinor = assertSafeLedgerMinor(payoutLog.amountMinor);
    if (amountMinor <= 0) {
      throw new HttpError(409, `Affiliate payout log #${payoutLog.id} has an invalid amount.`);
    }
    totalMinor += amountMinor;
    if (!Number.isSafeInteger(totalMinor)) {
      throw new HttpError(409, 'Affiliate payout total exceeds safe currency limits.');
    }
  }
  return totalMinor;
};

export const loadCanonicalStaffPayablePaidMinor = async (params: {
  staffUserId: number;
  rangeStart: string;
  rangeEnd: string;
  currencyCode: string;
  transaction?: SequelizeTransaction;
}): Promise<number> => {
  const collectionRows = await StaffPayoutCollectionLog.findAll({
    attributes: ['amountMinor', 'financeTransactionId'],
    where: {
      staffProfileId: params.staffUserId,
      direction: 'payable',
      currencyCode: params.currencyCode.trim().toUpperCase(),
      rangeStart: params.rangeStart,
      rangeEnd: params.rangeEnd,
    },
    transaction: params.transaction,
  });
  const collectedPayableMinor = collectionRows.reduce(
    (sum, row) => sum + assertSafeLedgerMinor(row.amountMinor),
    0,
  );
  if (!Number.isSafeInteger(collectedPayableMinor) || collectedPayableMinor < 0) {
    throw new HttpError(409, 'The persisted staff payout ledger could not be reconciled safely.');
  }
  const collectedFinanceTransactionIds = new Set(
    collectionRows
      .map((row) => Number(row.financeTransactionId ?? NaN))
      .filter((id) => Number.isSafeInteger(id) && id > 0),
  );

  const uncollectedAffiliatePaidMinor = await loadImmutableUncollectedAffiliatePaidMinor({
    staffUserId: params.staffUserId,
    rangeStart: params.rangeStart,
    rangeEnd: params.rangeEnd,
    currencyCode: params.currencyCode,
    collectedFinanceTransactionIds,
    transaction: params.transaction,
  });

  try {
    return getCanonicalPayablePaidMinor({
      collectedPayableMinor,
      uncollectedAffiliatePaidMinor,
    });
  } catch (error) {
    throw new HttpError(
      409,
      error instanceof Error && error.message
        ? `The persisted staff payout ledger could not be reconciled: ${error.message}`
        : 'The persisted staff payout ledger could not be reconciled.',
    );
  }
};

/**
 * Reconciles the first ledger period touched by a payout range and cascades its
 * new closing balance through every later period. Carry-forward reads the
 * latest stored closing balance, so repairing only the directly affected row
 * would leave later opening/closing balances stale.
 */
export const reconcilePersistedStaffPayoutLedgers = async (params: {
  staffUserId: number;
  affectedRangeStart: string;
  affectedRangeEnd: string;
  transaction: SequelizeTransaction;
}): Promise<void> => {
  const ledgers = await StaffPayoutLedger.findAll({
    where: { staffUserId: params.staffUserId },
    order: [['rangeStart', 'ASC'], ['id', 'ASC']],
    transaction: params.transaction,
    lock: params.transaction.LOCK.UPDATE,
  });

  const firstAffectedIndex = ledgers.findIndex(
    (ledger) => (
      ledger.rangeStart <= params.affectedRangeEnd
      && ledger.rangeEnd >= params.affectedRangeStart
    ),
  );
  if (firstAffectedIndex < 0) {
    return;
  }

  const cascadeCurrency = ledgers[firstAffectedIndex].currencyCode.trim().toUpperCase();
  const currencyMismatch = ledgers
    .slice(Math.max(firstAffectedIndex - 1, 0))
    .some((ledger) => ledger.currencyCode.trim().toUpperCase() !== cascadeCurrency);
  if (currencyMismatch) {
    throw new HttpError(409, 'Staff payout carry cannot cross ledger currencies.');
  }
  let runningBalanceMinor = firstAffectedIndex > 0
    ? assertSafeLedgerMinor(ledgers[firstAffectedIndex - 1].closingBalanceMinor)
    : 0;
  for (const ledger of ledgers.slice(firstAffectedIndex)) {
    const paidAmountMinor = await loadCanonicalStaffPayablePaidMinor({
      staffUserId: ledger.staffUserId,
      rangeStart: ledger.rangeStart,
      rangeEnd: ledger.rangeEnd,
      currencyCode: ledger.currencyCode,
      transaction: params.transaction,
    });
    const openingBalanceMinor = runningBalanceMinor;
    const dueAmountMinor = assertSafeLedgerMinor(ledger.dueAmountMinor);
    const closingBalanceMinor = openingBalanceMinor + dueAmountMinor - paidAmountMinor;
    if (!Number.isSafeInteger(closingBalanceMinor)) {
      throw new HttpError(409, 'The persisted staff payout ledger could not be reconciled safely.');
    }
    await ledger.update(
      { openingBalanceMinor, paidAmountMinor, closingBalanceMinor },
      { transaction: params.transaction },
    );
    runningBalanceMinor = closingBalanceMinor;
  }
};
