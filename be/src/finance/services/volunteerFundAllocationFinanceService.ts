import {
  Op,
  col,
  fn,
  where,
  type Transaction as SequelizeTransaction,
} from 'sequelize';
import HttpError from '../../errors/HttpError.js';
import FinanceAccount from '../models/FinanceAccount.js';
import FinanceTransaction from '../models/FinanceTransaction.js';
import type VolunteerFund from '../models/VolunteerFund.js';
import type VolunteerFundEntry from '../models/VolunteerFundEntry.js';
import {
  createFinanceTransfer,
  updateFinanceTransaction,
} from './transactionService.js';

type AllocationFund = Pick<
  VolunteerFund,
  'id' | 'name' | 'currency' | 'linkedAccountId' | 'fundingSourceAccountId'
>;

type AllocationEntry = Pick<
  VolunteerFundEntry,
  | 'id'
  | 'fundId'
  | 'amountMinor'
  | 'currency'
  | 'entryDate'
  | 'idempotencyKey'
  | 'financeTransactionId'
  | 'financeCounterTransactionId'
  | 'sourceSnapshot'
>;

export type VolunteerFundAllocationTransferResult = {
  debitTransactionId: number;
  creditTransactionId: number;
  transferGroupId: string;
  fromAccountId: number;
  toAccountId: number;
};

export type VolunteerFundAllocationTransferReversalResult =
  VolunteerFundAllocationTransferResult & {
    action: 'voided_atomically' | 'already_void';
  };

const normalizeCurrency = (value: unknown): string => String(value ?? '').trim().toUpperCase();

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const getMetaString = (meta: Record<string, unknown> | null, key: string): string =>
  typeof meta?.[key] === 'string' ? String(meta[key]).trim() : '';

const getMetaPositiveInteger = (
  meta: Record<string, unknown> | null,
  key: string,
): number | null => {
  const parsed = Number(meta?.[key] ?? NaN);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

const requireConfiguredAccounts = async (
  fund: AllocationFund,
  transaction: SequelizeTransaction,
): Promise<{ fromAccountId: number; toAccountId: number }> => {
  const fromAccountId = Number(fund.fundingSourceAccountId ?? NaN);
  const toAccountId = Number(fund.linkedAccountId ?? NaN);
  if (!Number.isSafeInteger(fromAccountId) || fromAccountId <= 0) {
    throw new HttpError(
      409,
      `${fund.name} needs a funding source account before compensation can be allocated.`,
    );
  }
  if (!Number.isSafeInteger(toAccountId) || toAccountId <= 0) {
    throw new HttpError(
      409,
      `${fund.name} needs a linked account before compensation can be allocated.`,
    );
  }
  if (fromAccountId === toAccountId) {
    throw new HttpError(
      409,
      `${fund.name} funding source and linked account must be different.`,
    );
  }

  const accounts = await FinanceAccount.findAll({
    where: { id: { [Op.in]: [fromAccountId, toAccountId] } },
    attributes: ['id', 'currency', 'isActive'],
    order: [['id', 'ASC']],
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  const accountById = new Map(accounts.map((account) => [Number(account.id), account] as const));
  const expectedCurrency = normalizeCurrency(fund.currency);
  for (const accountId of [fromAccountId, toAccountId]) {
    const account = accountById.get(accountId);
    if (!account) {
      throw new HttpError(409, `${fund.name} is linked to a Finance account that no longer exists.`);
    }
    if (!account.isActive) {
      throw new HttpError(409, `${fund.name} cannot use an inactive Finance account.`);
    }
    if (normalizeCurrency(account.currency) !== expectedCurrency) {
      throw new HttpError(
        409,
        `${fund.name} and both of its Finance accounts must use ${expectedCurrency}.`,
      );
    }
  }

  return { fromAccountId, toAccountId };
};

export const createVolunteerFundAllocationTransfer = async (params: {
  fund: AllocationFund;
  allocationIdempotencyKey: string;
  amountMinor: number;
  date: string;
  description: string;
  payoutBatchKey: string;
  settlementRequestId: string;
  staffUserId: number;
  sourceKey: string;
  componentId: number | null;
  periodStart: string;
  periodEnd: string;
  actorId: number;
  transaction: SequelizeTransaction;
}): Promise<VolunteerFundAllocationTransferResult> => {
  const amountMinor = Number(params.amountMinor);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new HttpError(409, 'Volunteer Fund allocation amount must be a positive integer.');
  }
  const { fromAccountId, toAccountId } = await requireConfiguredAccounts(
    params.fund,
    params.transaction,
  );

  const commonMeta = {
    source: 'volunteer-fund-allocation',
    volunteerFundId: params.fund.id,
    volunteerFundAllocationIdempotencyKey: params.allocationIdempotencyKey,
    payoutBatchKey: params.payoutBatchKey,
    settlementRequestId: params.settlementRequestId,
    staffUserId: params.staffUserId,
    sourceKey: params.sourceKey,
    componentId: params.componentId,
    periodStart: params.periodStart,
    periodEnd: params.periodEnd,
  };
  const { debit, credit } = await createFinanceTransfer(
    {
      fromAccountId,
      toAccountId,
      amountMinor,
      currency: normalizeCurrency(params.fund.currency),
      status: 'paid',
      date: params.date,
      description: params.description,
      tags: {
        volunteerFundId: params.fund.id,
        volunteerFundAllocation: true,
      },
      meta: commonMeta,
    },
    params.actorId,
    {
      transaction: params.transaction,
      allowVolunteerFundAllocationForFundId: params.fund.id,
    },
  );
  const debitMeta = asRecord(debit.meta);
  const creditMeta = asRecord(credit.meta);
  const transferGroupId = getMetaString(debitMeta, 'transfer_group_id');
  if (
    !transferGroupId
    || transferGroupId !== getMetaString(creditMeta, 'transfer_group_id')
  ) {
    throw new HttpError(500, 'Finance transfer pair could not be linked safely.');
  }

  return {
    debitTransactionId: Number(debit.id),
    creditTransactionId: Number(credit.id),
    transferGroupId,
    fromAccountId,
    toAccountId,
  };
};

const assertPairRow = (params: {
  row: FinanceTransaction;
  original: AllocationEntry;
  fund: AllocationFund;
  transferGroupId: string;
  expectedDirection: 'out' | 'in';
  expectedAccountId: number;
  expectedCounterAccountId: number;
}): void => {
  const meta = asRecord(params.row.meta);
  if (
    params.row.kind !== 'transfer'
    || Number(params.row.amountMinor) !== Number(params.original.amountMinor)
    || normalizeCurrency(params.row.currency) !== normalizeCurrency(params.original.currency)
    || params.row.date !== params.original.entryDate
    || Number(params.row.accountId) !== params.expectedAccountId
    || getMetaString(meta, 'source') !== 'volunteer-fund-allocation'
    || getMetaString(meta, 'transfer_group_id') !== params.transferGroupId
    || getMetaString(meta, 'direction') !== params.expectedDirection
    || getMetaPositiveInteger(meta, 'counter_account_id') !== params.expectedCounterAccountId
    || getMetaPositiveInteger(meta, 'volunteerFundId') !== Number(params.fund.id)
    || getMetaString(meta, 'volunteerFundAllocationIdempotencyKey')
      !== String(params.original.idempotencyKey ?? '')
  ) {
    throw new HttpError(
      409,
      'The Finance transfer linked to this Volunteer Fund allocation no longer matches its ledger entry.',
    );
  }
};

export const reverseVolunteerFundAllocationTransfer = async (params: {
  fund: AllocationFund;
  original: AllocationEntry;
  actorId: number;
  transaction: SequelizeTransaction;
}): Promise<VolunteerFundAllocationTransferReversalResult | null> => {
  if (
    !params.original.financeTransactionId
    && !params.original.financeCounterTransactionId
  ) {
    // Allocations created before automatic Finance transfers remain reversible
    // as ledger-only history. There is no Finance movement to undo for them.
    return null;
  }
  if (
    !params.original.financeTransactionId
    || !params.original.financeCounterTransactionId
  ) {
    throw new HttpError(
      409,
      'This allocation has an incomplete Finance transfer link and cannot be reversed safely.',
    );
  }
  const sourceSnapshot = asRecord(params.original.sourceSnapshot);
  const storedTransfer = asRecord(sourceSnapshot?.financeTransfer);
  const fromAccountId = getMetaPositiveInteger(storedTransfer, 'fromAccountId') ?? NaN;
  const toAccountId = getMetaPositiveInteger(storedTransfer, 'toAccountId') ?? NaN;
  const storedDebitTransactionId = getMetaPositiveInteger(
    storedTransfer,
    'debitTransactionId',
  );
  const storedCreditTransactionId = getMetaPositiveInteger(
    storedTransfer,
    'creditTransactionId',
  );
  const storedTransferGroupId = getMetaString(storedTransfer, 'transferGroupId');
  if (
    !Number.isSafeInteger(fromAccountId)
    || fromAccountId <= 0
    || !Number.isSafeInteger(toAccountId)
    || toAccountId <= 0
    || !storedDebitTransactionId
    || !storedCreditTransactionId
    || !storedTransferGroupId
    || storedDebitTransactionId !== Number(params.original.financeTransactionId)
    || storedCreditTransactionId !== Number(params.original.financeCounterTransactionId)
  ) {
    throw new HttpError(
      409,
      'This allocation is missing its immutable Finance transfer snapshot and cannot be reversed safely.',
    );
  }

  const anchor = await FinanceTransaction.findByPk(params.original.financeTransactionId, {
    attributes: ['id', 'kind', 'status', 'date', 'accountId', 'currency', 'amountMinor', 'meta'],
    transaction: params.transaction,
    lock: params.transaction.LOCK.UPDATE,
  });
  if (!anchor) {
    throw new HttpError(409, 'The Finance transfer linked to this allocation no longer exists.');
  }
  const anchorMeta = asRecord(anchor.meta);
  const transferGroupId = getMetaString(anchorMeta, 'transfer_group_id');
  if (
    !transferGroupId
    || transferGroupId !== storedTransferGroupId
    || Number(anchor.id) !== storedDebitTransactionId
  ) {
    throw new HttpError(409, 'The Finance transfer linked to this allocation has an invalid pair identifier.');
  }

  const pair = await FinanceTransaction.findAll({
    where: {
      [Op.and]: [
        { kind: 'transfer' },
        where(fn('jsonb_extract_path_text', col('meta'), 'transfer_group_id'), transferGroupId),
        where(fn('jsonb_extract_path_text', col('meta'), 'source'), 'volunteer-fund-allocation'),
      ],
    },
    attributes: ['id', 'kind', 'status', 'date', 'accountId', 'currency', 'amountMinor', 'meta'],
    order: [['id', 'ASC']],
    transaction: params.transaction,
    lock: params.transaction.LOCK.UPDATE,
  });
  if (pair.length !== 2) {
    throw new HttpError(409, 'The Finance transfer linked to this allocation does not have one complete pair.');
  }

  const debit = pair.find((row) => getMetaString(asRecord(row.meta), 'direction') === 'out');
  const credit = pair.find((row) => getMetaString(asRecord(row.meta), 'direction') === 'in');
  if (
    !debit
    || !credit
    || debit.id === credit.id
    || Number(anchor.id) !== Number(debit.id)
    || Number(debit.id) !== storedDebitTransactionId
    || Number(credit.id) !== storedCreditTransactionId
  ) {
    throw new HttpError(409, 'The Finance transfer linked to this allocation has an invalid direction pair.');
  }
  assertPairRow({
    row: debit,
    original: params.original,
    fund: params.fund,
    transferGroupId,
    expectedDirection: 'out',
    expectedAccountId: fromAccountId,
    expectedCounterAccountId: toAccountId,
  });
  assertPairRow({
    row: credit,
    original: params.original,
    fund: params.fund,
    transferGroupId,
    expectedDirection: 'in',
    expectedAccountId: toAccountId,
    expectedCounterAccountId: fromAccountId,
  });

  const statuses = new Set(pair.map((row) => row.status));
  if (statuses.size === 1 && statuses.has('void')) {
    return {
      debitTransactionId: Number(debit.id),
      creditTransactionId: Number(credit.id),
      transferGroupId,
      fromAccountId,
      toAccountId,
      action: 'already_void',
    };
  }
  if (statuses.size !== 1 || !statuses.has('paid')) {
    throw new HttpError(
      409,
      'Both sides of the Volunteer Fund allocation transfer must be paid before it can be reversed.',
    );
  }

  for (const row of [debit, credit]) {
    await updateFinanceTransaction(
      Number(row.id),
      { status: 'void' },
      params.actorId,
      {
        transaction: params.transaction,
        allowVolunteerFundAllocationReversal: true,
      },
    );
  }
  return {
    debitTransactionId: Number(debit.id),
    creditTransactionId: Number(credit.id),
    transferGroupId,
    fromAccountId,
    toAccountId,
    action: 'voided_atomically',
  };
};
