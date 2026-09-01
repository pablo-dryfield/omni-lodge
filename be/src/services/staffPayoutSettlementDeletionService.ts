import type { Transaction as SequelizeTransaction } from 'sequelize';
import { Op, col, fn, where } from 'sequelize';
import FinanceTransaction from '../finance/models/FinanceTransaction.js';
import VolunteerFundEntry from '../finance/models/VolunteerFundEntry.js';
import { reverseVolunteerFundEntryInTransaction } from '../finance/services/volunteerFundService.js';
import StaffPayoutReceipt from '../models/StaffPayoutReceipt.js';
import StaffPayoutReceiptItem from '../models/StaffPayoutReceiptItem.js';
import StaffPayoutSettlementRequest from '../models/StaffPayoutSettlementRequest.js';

type FinanceTransactionWithMeta = Pick<FinanceTransaction, 'meta'>;

const asRecord = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

const normalizeBatchKey = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 128 ? normalized : null;
};

const RECEIPT_BATCH_KEY_PATTERN = /^([a-f0-9]{64}):[A-Z]{3}$/iu;

export const getPayoutBatchKeyFromReceiptKey = (value: unknown): string | null => {
  const normalized = normalizeBatchKey(value);
  if (!normalized) {
    return null;
  }
  return normalized.match(RECEIPT_BATCH_KEY_PATTERN)?.[1]?.toLowerCase() ?? null;
};

/**
 * Reads a batch key only from a Finance row that still matches the staff and
 * accounting month being deleted. A generic transaction carrying an
 * unrelated `payoutBatchKey` must never authorize Volunteer Fund reversal.
 */
export const getStaffPayoutBatchKeyForDeletion = (
  financeTransaction: FinanceTransactionWithMeta,
  expected: { staffUserId: number; rangeStart: string; rangeEnd: string },
): string | null => {
  const meta = asRecord(financeTransaction.meta);
  if (
    !meta
    || meta.source !== 'staff-payments'
    || Number(meta.staffUserId) !== expected.staffUserId
    || meta.rangeStart !== expected.rangeStart
    || meta.rangeEnd !== expected.rangeEnd
  ) {
    return null;
  }
  return normalizeBatchKey(meta.payoutBatchKey);
};

const getFundAllocationBatchKey = (entry: VolunteerFundEntry): string | null =>
  normalizeBatchKey(asRecord(entry.sourceSnapshot)?.payoutBatchKey);

const staffBatchIdentity = (staffUserId: number, batchKey: string): string =>
  `${staffUserId}:${batchKey}`;

export const findRecoverableInterruptedPayoutBatches = async (params: {
  staffUserIds: Iterable<number>;
  rangeStart: string;
  rangeEnd: string;
  transaction?: SequelizeTransaction;
}): Promise<Map<number, string[]>> => {
  const staffUserIds = Array.from(new Set(Array.from(params.staffUserIds).filter(
    (value) => Number.isSafeInteger(value) && value > 0,
  )));
  if (staffUserIds.length === 0) {
    return new Map();
  }
  const lockOptions = params.transaction
    ? { transaction: params.transaction, lock: params.transaction.LOCK.UPDATE }
    : {};

  const cancelledReceipts = await StaffPayoutReceipt.findAll({
    attributes: ['id', 'staffUserId', 'payoutBatchKey'],
    where: {
      staffUserId: { [Op.in]: staffUserIds },
      rangeStart: params.rangeStart,
      rangeEnd: params.rangeEnd,
      status: 'cancelled',
    },
    ...lockOptions,
  });
  const cancelledReceiptIds = cancelledReceipts.map((receipt) => receipt.id);
  if (cancelledReceiptIds.length === 0) {
    return new Map();
  }
  const cancelledItems = await StaffPayoutReceiptItem.findAll({
    attributes: ['receiptId', 'collectionLogId'],
    where: { receiptId: { [Op.in]: cancelledReceiptIds } },
    ...lockOptions,
  });
  const itemsByReceiptId = new Map<number, StaffPayoutReceiptItem[]>();
  cancelledItems.forEach((item) => {
    const items = itemsByReceiptId.get(Number(item.receiptId)) ?? [];
    items.push(item);
    itemsByReceiptId.set(Number(item.receiptId), items);
  });

  const candidateIdentities = new Map<string, { staffUserId: number; batchKey: string }>();
  cancelledReceipts.forEach((receipt) => {
    const batchKey = getPayoutBatchKeyFromReceiptKey(receipt.payoutBatchKey);
    const items = itemsByReceiptId.get(Number(receipt.id)) ?? [];
    if (!batchKey || items.length === 0 || items.some((item) => item.collectionLogId !== null)) {
      return;
    }
    candidateIdentities.set(staffBatchIdentity(Number(receipt.staffUserId), batchKey), {
      staffUserId: Number(receipt.staffUserId),
      batchKey,
    });
  });
  if (candidateIdentities.size === 0) {
    return new Map();
  }

  const [activeReceipts, settlementRequests, remainingPersonalTransactions, allocations] = await Promise.all([
    StaffPayoutReceipt.findAll({
      attributes: ['staffUserId', 'payoutBatchKey'],
      where: {
        staffUserId: { [Op.in]: staffUserIds },
        rangeStart: params.rangeStart,
        rangeEnd: params.rangeEnd,
        status: ['pending', 'completed'],
      },
      ...lockOptions,
    }),
    StaffPayoutSettlementRequest.findAll({
      attributes: ['staffUserId', 'payoutBatchKey'],
      where: { staffUserId: { [Op.in]: staffUserIds } },
      ...lockOptions,
    }),
    FinanceTransaction.findAll({
      attributes: ['id', 'meta'],
      where: {
        [Op.and]: [
          where(fn('jsonb_extract_path_text', col('meta'), 'source'), 'staff-payments'),
          where(fn('jsonb_extract_path_text', col('meta'), 'rangeStart'), params.rangeStart),
          where(fn('jsonb_extract_path_text', col('meta'), 'rangeEnd'), params.rangeEnd),
        ],
      },
      ...lockOptions,
    }),
    VolunteerFundEntry.findAll({
      attributes: ['id', 'attributedStaffUserId', 'sourceSnapshot'],
      where: {
        entryType: 'allocation',
        attributedStaffUserId: { [Op.in]: staffUserIds },
        periodStart: params.rangeStart,
        periodEnd: params.rangeEnd,
      },
      ...lockOptions,
    }),
  ]);

  const activeReceiptIdentities = new Set(activeReceipts.flatMap((receipt) => {
    const batchKey = getPayoutBatchKeyFromReceiptKey(receipt.payoutBatchKey);
    return batchKey ? [staffBatchIdentity(Number(receipt.staffUserId), batchKey)] : [];
  }));
  const requestIdentities = new Set(settlementRequests.flatMap((request) => {
    const batchKey = normalizeBatchKey(request.payoutBatchKey);
    return batchKey ? [staffBatchIdentity(Number(request.staffUserId), batchKey)] : [];
  }));
  const remainingPersonalIdentities = new Set(remainingPersonalTransactions.flatMap((financeTransaction) => {
    const meta = asRecord(financeTransaction.meta);
    const staffUserId = Number(meta?.staffUserId);
    if (!Number.isSafeInteger(staffUserId) || !staffUserIds.includes(staffUserId)) {
      return [];
    }
    const batchKey = getStaffPayoutBatchKeyForDeletion(financeTransaction, {
      staffUserId,
      rangeStart: params.rangeStart,
      rangeEnd: params.rangeEnd,
    });
    return batchKey ? [staffBatchIdentity(staffUserId, batchKey)] : [];
  }));

  const allocationIds = allocations.map((entry) => entry.id);
  const allocationReversals = allocationIds.length > 0
    ? await VolunteerFundEntry.findAll({
        attributes: ['reversalOfEntryId'],
        where: {
          entryType: 'reversal',
          reversalOfEntryId: { [Op.in]: allocationIds },
        },
        ...lockOptions,
      })
    : [];
  const reversedAllocationIds = new Set(
    allocationReversals
      .map((entry) => Number(entry.reversalOfEntryId))
      .filter((value) => Number.isSafeInteger(value) && value > 0),
  );
  const activeAllocationIdentities = new Set(allocations.flatMap((entry) => {
    if (reversedAllocationIds.has(Number(entry.id))) {
      return [];
    }
    const staffUserId = Number(entry.attributedStaffUserId);
    const batchKey = getFundAllocationBatchKey(entry);
    return batchKey ? [staffBatchIdentity(staffUserId, batchKey)] : [];
  }));

  const recoverableByUserId = new Map<number, string[]>();
  candidateIdentities.forEach(({ staffUserId, batchKey }, identity) => {
    if (
      activeReceiptIdentities.has(identity)
      || !requestIdentities.has(identity)
      || remainingPersonalIdentities.has(identity)
      || !activeAllocationIdentities.has(identity)
    ) {
      return;
    }
    const batches = recoverableByUserId.get(staffUserId) ?? [];
    batches.push(batchKey);
    recoverableByUserId.set(staffUserId, batches);
  });
  return recoverableByUserId;
};

export type ReversedDeletedSettlementAllocations = {
  reversedAllocationCount: number;
  reversedBatchKeys: string[];
};

/**
 * Once every personal Finance row from a payout batch has been deleted, its
 * linked Volunteer Fund allocations belong to the same abandoned settlement
 * and must be reversed in the same database transaction. Partial deletion
 * deliberately keeps the allocations intact while the remaining payment rows
 * and replacement receipt continue to represent that batch.
 */
export const reverseFundAllocationsForFullyDeletedPayoutBatches = async (params: {
  staffUserId: number;
  rangeStart: string;
  rangeEnd: string;
  candidateBatchKeys: Iterable<string>;
  actorId: number;
  reversalDate: string;
  transaction: SequelizeTransaction;
}): Promise<ReversedDeletedSettlementAllocations> => {
  const candidateBatchKeys = Array.from(
    new Set(Array.from(params.candidateBatchKeys).map(normalizeBatchKey).filter(
      (value): value is string => Boolean(value),
    )),
  );
  if (candidateBatchKeys.length === 0) {
    return { reversedAllocationCount: 0, reversedBatchKeys: [] };
  }

  const remainingPersonalTransactions = await FinanceTransaction.findAll({
    attributes: ['id', 'meta'],
    where: {
      [Op.and]: [
        where(fn('jsonb_extract_path_text', col('meta'), 'source'), 'staff-payments'),
        where(
          fn('jsonb_extract_path_text', col('meta'), 'staffUserId'),
          String(params.staffUserId),
        ),
        where(fn('jsonb_extract_path_text', col('meta'), 'rangeStart'), params.rangeStart),
        where(fn('jsonb_extract_path_text', col('meta'), 'rangeEnd'), params.rangeEnd),
      ],
    },
    transaction: params.transaction,
    lock: params.transaction.LOCK.UPDATE,
  });
  const remainingBatchKeys = new Set(
    remainingPersonalTransactions
      .map((financeTransaction) => getStaffPayoutBatchKeyForDeletion(financeTransaction, params))
      .filter((value): value is string => Boolean(value)),
  );
  const fullyDeletedBatchKeys = candidateBatchKeys.filter(
    (batchKey) => !remainingBatchKeys.has(batchKey),
  );
  if (fullyDeletedBatchKeys.length === 0) {
    return { reversedAllocationCount: 0, reversedBatchKeys: [] };
  }

  const allocations = await VolunteerFundEntry.findAll({
    attributes: ['id', 'fundId', 'sourceSnapshot'],
    where: {
      entryType: 'allocation',
      attributedStaffUserId: params.staffUserId,
      periodStart: params.rangeStart,
      periodEnd: params.rangeEnd,
    },
    order: [['id', 'ASC']],
    transaction: params.transaction,
    lock: params.transaction.LOCK.UPDATE,
  });
  const matchingAllocations = allocations.filter((entry) => {
    const batchKey = getFundAllocationBatchKey(entry);
    return batchKey !== null && fullyDeletedBatchKeys.includes(batchKey);
  });
  const allocationIds = matchingAllocations.map((entry) => entry.id);
  const existingReversals = allocationIds.length > 0
    ? await VolunteerFundEntry.findAll({
        attributes: ['reversalOfEntryId'],
        where: {
          entryType: 'reversal',
          reversalOfEntryId: { [Op.in]: allocationIds },
        },
        transaction: params.transaction,
        lock: params.transaction.LOCK.UPDATE,
      })
    : [];
  const alreadyReversedIds = new Set(
    existingReversals
      .map((entry) => Number(entry.reversalOfEntryId))
      .filter((value) => Number.isSafeInteger(value) && value > 0),
  );
  const activeAllocations = matchingAllocations.filter(
    (entry) => !alreadyReversedIds.has(Number(entry.id)),
  );

  const reversedBatchKeys = new Set<string>();
  for (const allocation of activeAllocations) {
    await reverseVolunteerFundEntryInTransaction(
      Number(allocation.fundId),
      Number(allocation.id),
      {
        entryDate: params.reversalDate,
        reason: 'Linked staff payout batch was removed before its settlement was completed.',
      },
      params.actorId,
      params.transaction,
    );
    const batchKey = getFundAllocationBatchKey(allocation);
    if (batchKey) {
      reversedBatchKeys.add(batchKey);
    }
  }

  return {
    reversedAllocationCount: activeAllocations.length,
    reversedBatchKeys: Array.from(reversedBatchKeys),
  };
};
