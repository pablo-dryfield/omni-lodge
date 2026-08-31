import crypto from 'crypto';
import { Op, Transaction as SequelizeTransaction } from 'sequelize';
import sequelize from '../../config/database.js';
import FinanceTransaction, {
  FinanceTransactionKind,
  FinanceTransactionStatus,
  FinanceTransactionCounterpartyType,
} from '../models/FinanceTransaction.js';
import FinanceFile from '../models/FinanceFile.js';
import VolunteerFund from '../models/VolunteerFund.js';
import VolunteerFundEntry from '../models/VolunteerFundEntry.js';
import { recordFinanceAuditLog } from './auditLogService.js';
import {
  assertCounterpartyIsNotStaffPayment,
  assertFinanceTransactionIsNotReceiptProtected,
} from '../../services/staffPayoutReceiptProtectionService.js';

export type FinanceTransactionInput = {
  kind: FinanceTransactionKind;
  date: string;
  accountId: number;
  currency: string;
  amountMinor: number;
  fxRate?: number | string | null;
  baseAmountMinor?: number | null;
  categoryId?: number | null;
  counterpartyType?: FinanceTransactionCounterpartyType;
  counterpartyId?: number | null;
  paymentMethod?: string | null;
  status?: FinanceTransactionStatus;
  description?: string | null;
  nightReportId?: number | null;
  productId?: number | null;
  serviceDate?: string | null;
  tags?: Record<string, unknown> | null;
  meta?: Record<string, unknown> | null;
  invoiceFileId?: number | null;
  receiptGroupKey?: string | null;
  receiptTotalMinor?: number | null;
  receiptCurrency?: string | null;
  receiptAllocationNote?: string | null;
  receiptLineOrder?: number | null;
  approvedBy?: number | null;
};

export type FinanceTransactionServiceOptions = {
  transaction?: SequelizeTransaction;
  allowStaffPayoutReceiptFlow?: boolean;
  allowVolunteerFundSpendForFundId?: number;
  allowVolunteerFundAllocationForFundId?: number;
  allowVolunteerFundSpendReversal?: boolean;
  allowVolunteerFundAllocationReversal?: boolean;
};

type VolunteerFundAccountOperation = FinanceTransactionKind;

const assertVolunteerFundAccountUse = async (params: {
  accountIds: Array<number | null | undefined>;
  operation: VolunteerFundAccountOperation;
  trustedFundId?: number;
  transaction?: SequelizeTransaction;
}): Promise<void> => {
  const accountIds = [...new Set(
    params.accountIds
      .map(Number)
      .filter((id) => Number.isSafeInteger(id) && id > 0),
  )];
  if (accountIds.length === 0) {
    return;
  }

  // Use all matches rather than findOne: a legacy/shared account configuration
  // must fail closed instead of allowing whichever Volunteer Fund happens to be
  // returned first.
  const linkedFunds = await VolunteerFund.findAll({
    attributes: ['id', 'name', 'linkedAccountId'],
    where: {
      isActive: true,
      linkedAccountId: { [Op.in]: accountIds },
    },
    order: [['id', 'ASC']],
    transaction: params.transaction,
  });
  if (linkedFunds.length === 0) {
    return;
  }

  const linkedFundIds = [...new Set(linkedFunds.map((fund) => Number(fund.id)))];
  const trustedFundId = Number(params.trustedFundId ?? NaN);
  if (
    Number.isSafeInteger(trustedFundId)
    && trustedFundId > 0
    && linkedFundIds.length === 1
    && linkedFundIds[0] === trustedFundId
  ) {
    return;
  }

  if (linkedFundIds.length > 1) {
    throw new Error(
      'These Finance accounts are linked to multiple active Volunteer Funds. Resolve the account configuration before recording this operation.',
    );
  }
  if (params.trustedFundId !== undefined) {
    throw new Error(
      'The trusted Volunteer Fund operation does not match the active fund linked to this Finance account.',
    );
  }

  const fundName = String(linkedFunds[0]?.name ?? '').trim();
  const fundLabel = fundName ? ` "${fundName}"` : '';
  if (params.operation === 'expense') {
    throw new Error(
      `This Finance account is linked to active Volunteer Fund${fundLabel}. Record the expense through the Volunteer Fund spend flow so both ledgers stay synchronized.`,
    );
  }
  if (params.operation === 'transfer') {
    throw new Error(
      `This transfer uses an account linked to active Volunteer Fund${fundLabel}. Use the Volunteer Fund allocation flow so both ledgers stay synchronized.`,
    );
  }
  throw new Error(
    `This ${params.operation} uses an account linked to active Volunteer Fund${fundLabel}. Fund-linked accounts can only change through trusted Volunteer Fund workflows.`,
  );
};

const assertGeneralInvoiceFile = async (
  invoiceFileId: number | null | undefined,
  transaction?: SequelizeTransaction,
): Promise<void> => {
  if (invoiceFileId == null) {
    return;
  }
  const normalizedId = Number(invoiceFileId);
  if (!Number.isInteger(normalizedId) || normalizedId <= 0) {
    throw new Error('Invoice file not found');
  }
  const file = await FinanceFile.findOne({
    attributes: ['id'],
    where: { id: normalizedId, purpose: 'general' },
    transaction,
  });
  if (!file) {
    throw new Error('Invoice file not found');
  }
};

function calculateBaseAmount(amountMinor: number, fxRate: number | string | null | undefined): number {
  const rate = fxRate == null ? 1 : Number(fxRate);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error('Invalid fxRate value');
  }
  return Math.round(amountMinor * rate);
}

function normalizeCounterparty(input: FinanceTransactionInput): {
  counterpartyType: FinanceTransactionCounterpartyType;
  counterpartyId: number | null;
} {
  const providedType = input.counterpartyType ?? 'none';
  const providedId = input.counterpartyId ?? null;

  if (input.kind === 'expense') {
    if (!providedId) {
      throw new Error('Expense transactions require a vendor counterparty');
    }
    return { counterpartyType: 'vendor', counterpartyId: providedId };
  }

  if (input.kind === 'income') {
    if (!providedId) {
      throw new Error('Income transactions require a client counterparty');
    }
    return { counterpartyType: 'client', counterpartyId: providedId };
  }

  if (input.kind === 'transfer') {
    return { counterpartyType: 'none', counterpartyId: null };
  }

  return { counterpartyType: providedType, counterpartyId: providedId };
}

function ensureMeta(meta: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!meta) {
    return null;
  }
  return { ...meta };
}

export async function createFinanceTransaction(
  data: FinanceTransactionInput,
  userId: number,
  options?: FinanceTransactionServiceOptions,
): Promise<FinanceTransaction> {
  const amountMinor = Number(data.amountMinor);
  if (!Number.isFinite(amountMinor)) {
    throw new Error('amountMinor must be a finite number');
  }

  const fxRate = data.fxRate ?? 1;
  const baseAmountMinor = data.baseAmountMinor ?? calculateBaseAmount(amountMinor, fxRate);
  const { counterpartyType, counterpartyId } = normalizeCounterparty(data);

  await assertVolunteerFundAccountUse({
    accountIds: [data.accountId],
    operation: data.kind,
    trustedFundId: data.kind === 'expense'
      ? options?.allowVolunteerFundSpendForFundId
      : data.kind === 'transfer'
        ? options?.allowVolunteerFundAllocationForFundId
        : undefined,
    transaction: options?.transaction,
  });

  if (!options?.allowStaffPayoutReceiptFlow) {
    await assertCounterpartyIsNotStaffPayment({
      kind: data.kind,
      status: data.status ?? 'planned',
      counterpartyId,
      transaction: options?.transaction,
    });
  }
  await assertGeneralInvoiceFile(data.invoiceFileId, options?.transaction);

  const meta = ensureMeta(data.meta);

  const record = await FinanceTransaction.create(
    {
      kind: data.kind,
      date: data.date,
      accountId: data.accountId,
      currency: data.currency,
      amountMinor,
      fxRate: String(fxRate ?? 1),
      baseAmountMinor,
      categoryId: data.categoryId ?? null,
      counterpartyType,
      counterpartyId,
      paymentMethod: data.paymentMethod ?? null,
      status: data.status ?? 'planned',
      description: data.description ?? null,
      nightReportId: data.nightReportId ?? null,
      productId: data.productId ?? null,
      serviceDate: data.serviceDate ?? null,
      tags: data.tags ?? null,
      meta,
      invoiceFileId: data.invoiceFileId ?? null,
      receiptGroupKey: data.receiptGroupKey?.trim() || null,
      receiptTotalMinor: data.receiptTotalMinor ?? null,
      receiptCurrency: data.receiptCurrency?.trim().toUpperCase() || null,
      receiptAllocationNote: data.receiptAllocationNote?.trim() || null,
      receiptLineOrder: data.receiptLineOrder ?? null,
      createdBy: userId,
      approvedBy: data.approvedBy ?? null,
    },
    {
      transaction: options?.transaction,
    },
  );

  await recordFinanceAuditLog({
    entity: 'finance_transaction',
    entityId: record.id,
    action: 'create',
    performedBy: userId,
    changes: record.toJSON() as Record<string, unknown>,
    transaction: options?.transaction,
  });

  return record;
}

export async function updateFinanceTransaction(
  id: number,
  changes: Partial<FinanceTransactionInput>,
  userId: number,
  options?: FinanceTransactionServiceOptions,
): Promise<FinanceTransaction> {
  if (!options?.transaction) {
    return sequelize.transaction((transaction) =>
      updateFinanceTransaction(id, changes, userId, {
        transaction,
        allowStaffPayoutReceiptFlow: options?.allowStaffPayoutReceiptFlow,
        allowVolunteerFundSpendForFundId: options?.allowVolunteerFundSpendForFundId,
        allowVolunteerFundAllocationForFundId: options?.allowVolunteerFundAllocationForFundId,
        allowVolunteerFundSpendReversal: options?.allowVolunteerFundSpendReversal,
        allowVolunteerFundAllocationReversal: options?.allowVolunteerFundAllocationReversal,
      }),
    );
  }

  const transaction = options.transaction;
  const record = await FinanceTransaction.findByPk(id, {
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (!record) {
    throw new Error('Transaction not found');
  }

  const volunteerFundEntry = await VolunteerFundEntry.findOne({
    attributes: ['id', 'entryType'],
    where: {
      [Op.or]: [
        { financeTransactionId: record.id },
        { financeCounterTransactionId: record.id },
      ],
    },
    transaction,
  });
  const recordMeta = record.meta && typeof record.meta === 'object'
    ? record.meta as Record<string, unknown>
    : null;
  const isVolunteerFundAllocationTransfer = volunteerFundEntry?.entryType === 'allocation'
    || recordMeta?.source === 'volunteer-fund-allocation';
  if (volunteerFundEntry?.entryType === 'spend') {
    const changedFields = Object.entries(changes)
      .filter(([, value]) => value !== undefined)
      .map(([field]) => field);
    const isFundReversalVoid = options.allowVolunteerFundSpendReversal === true
      && changedFields.length === 1
      && changedFields[0] === 'status'
      && changes.status === 'void';
    if (!isFundReversalVoid) {
      throw new Error(
        'This Finance expense backs a Volunteer Fund spend and can only be voided through that fund entry reversal.',
      );
    }
  }
  if (isVolunteerFundAllocationTransfer) {
    const changedFields = Object.entries(changes)
      .filter(([, value]) => value !== undefined)
      .map(([field]) => field);
    const isFundAllocationReversalVoid = options.allowVolunteerFundAllocationReversal === true
      && changedFields.length === 1
      && changedFields[0] === 'status'
      && changes.status === 'void';
    if (!isFundAllocationReversalVoid) {
      throw new Error(
        'This Finance transfer backs a Volunteer Fund allocation and can only be voided through that fund entry reversal.',
      );
    }
  }

  const nextKind = changes.kind ?? record.kind;
  const nextAccountId = changes.accountId ?? record.accountId;
  const isLedgerProtectedVolunteerFundRecord = volunteerFundEntry?.entryType === 'spend'
    || isVolunteerFundAllocationTransfer;
  if (
    !isLedgerProtectedVolunteerFundRecord
  ) {
    // This also protects legacy ordinary rows already sitting on a fund-linked
    // account. They may be moved to an ordinary account, but cannot otherwise
    // keep changing the Finance balance without a corresponding fund entry.
    await assertVolunteerFundAccountUse({
      accountIds: [nextAccountId],
      operation: nextKind,
      trustedFundId: nextKind === 'expense'
        ? options.allowVolunteerFundSpendForFundId
        : nextKind === 'transfer'
          ? options.allowVolunteerFundAllocationForFundId
          : undefined,
      transaction,
    });
  }

  await assertFinanceTransactionIsNotReceiptProtected(record.id, transaction);

  const nextCounterparty = changes.kind
    ? normalizeCounterparty({ ...record.toJSON(), ...changes } as FinanceTransactionInput)
    : {
        counterpartyType: record.counterpartyType,
        counterpartyId: record.counterpartyId,
      };

  if (!options.allowStaffPayoutReceiptFlow) {
    await assertCounterpartyIsNotStaffPayment({
      kind: changes.kind ?? record.kind,
      status: changes.status ?? record.status,
      counterpartyId: nextCounterparty.counterpartyId,
      transaction,
    });
  }
  if ('invoiceFileId' in changes) {
    await assertGeneralInvoiceFile(changes.invoiceFileId, transaction);
  }

  const nextAmountMinor =
    'amountMinor' in changes && changes.amountMinor != null ? Number(changes.amountMinor) : record.amountMinor;
  const nextFxRate = 'fxRate' in changes ? changes.fxRate ?? record.fxRate : record.fxRate;

  const payload: Partial<FinanceTransaction> = {
    ...('kind' in changes ? { kind: changes.kind } : {}),
    ...('date' in changes ? { date: changes.date } : {}),
    ...('accountId' in changes ? { accountId: changes.accountId } : {}),
    ...('currency' in changes ? { currency: changes.currency } : {}),
    ...('amountMinor' in changes ? { amountMinor: changes.amountMinor } : {}),
    ...('fxRate' in changes ? { fxRate: String(changes.fxRate ?? record.fxRate) } : {}),
    ...('baseAmountMinor' in changes
      ? { baseAmountMinor: changes.baseAmountMinor ?? calculateBaseAmount(nextAmountMinor, nextFxRate) }
      : 'amountMinor' in changes || 'fxRate' in changes
        ? { baseAmountMinor: calculateBaseAmount(nextAmountMinor, nextFxRate) }
        : {}),
    ...('categoryId' in changes ? { categoryId: changes.categoryId ?? null } : {}),
    counterpartyType: nextCounterparty.counterpartyType,
    counterpartyId: nextCounterparty.counterpartyId,
    ...('paymentMethod' in changes ? { paymentMethod: changes.paymentMethod ?? null } : {}),
    ...('status' in changes ? { status: changes.status } : {}),
    ...('description' in changes ? { description: changes.description ?? null } : {}),
    ...('nightReportId' in changes ? { nightReportId: changes.nightReportId ?? null } : {}),
    ...('productId' in changes ? { productId: changes.productId ?? null } : {}),
    ...('serviceDate' in changes ? { serviceDate: changes.serviceDate ?? null } : {}),
    ...('tags' in changes ? { tags: changes.tags ?? null } : {}),
    ...('meta' in changes ? { meta: ensureMeta(changes.meta) } : {}),
    ...('invoiceFileId' in changes ? { invoiceFileId: changes.invoiceFileId ?? null } : {}),
    ...('receiptGroupKey' in changes ? { receiptGroupKey: changes.receiptGroupKey?.trim() || null } : {}),
    ...('receiptTotalMinor' in changes ? { receiptTotalMinor: changes.receiptTotalMinor ?? null } : {}),
    ...('receiptCurrency' in changes ? { receiptCurrency: changes.receiptCurrency?.trim().toUpperCase() || null } : {}),
    ...('receiptAllocationNote' in changes ? { receiptAllocationNote: changes.receiptAllocationNote?.trim() || null } : {}),
    ...('receiptLineOrder' in changes ? { receiptLineOrder: changes.receiptLineOrder ?? null } : {}),
    ...('approvedBy' in changes ? { approvedBy: changes.approvedBy ?? null } : {}),
  };

  await record.update(payload, { transaction });

  await recordFinanceAuditLog({
    entity: 'finance_transaction',
    entityId: record.id,
    action: 'update',
    performedBy: userId,
    changes: payload as Record<string, unknown>,
    transaction,
  });

  return record;
}

type TransferInput = {
  fromAccountId: number;
  toAccountId: number;
  amountMinor: number;
  currency: string;
  fxRate?: number | string | null;
  description?: string | null;
  tags?: Record<string, unknown> | null;
  meta?: Record<string, unknown> | null;
  status?: FinanceTransactionStatus;
  date: string;
};

export async function createFinanceTransfer(
  data: TransferInput,
  userId: number,
  options?: Pick<
    FinanceTransactionServiceOptions,
    'transaction' | 'allowVolunteerFundAllocationForFundId'
  >,
): Promise<{ debit: FinanceTransaction; credit: FinanceTransaction }> {
  if (data.fromAccountId === data.toAccountId) {
    throw new Error('Transfer accounts must be different');
  }

  const amountMinor = Number(data.amountMinor);
  if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
    throw new Error('Transfer amount must be positive');
  }

  const fxRate = data.fxRate ?? 1;
  const baseAmountMinor = calculateBaseAmount(amountMinor, fxRate);
  const transferGroupId = crypto.randomUUID();

  const createPair = async (transaction: SequelizeTransaction) => {
    await assertVolunteerFundAccountUse({
      accountIds: [data.fromAccountId, data.toAccountId],
      operation: 'transfer',
      trustedFundId: options?.allowVolunteerFundAllocationForFundId,
      transaction,
    });
    const debitMeta = {
      ...(data.meta ?? {}),
      direction: 'out',
      transfer_group_id: transferGroupId,
      counter_account_id: data.toAccountId,
    };

    const creditMeta = {
      ...(data.meta ?? {}),
      direction: 'in',
      transfer_group_id: transferGroupId,
      counter_account_id: data.fromAccountId,
    };

    const debit = await createFinanceTransaction(
      {
        kind: 'transfer',
        date: data.date,
        accountId: data.fromAccountId,
        currency: data.currency,
        amountMinor,
        fxRate,
        baseAmountMinor,
        categoryId: null,
        counterpartyType: 'none',
        counterpartyId: null,
        paymentMethod: null,
        status: data.status ?? 'planned',
        description: data.description ?? null,
        tags: data.tags ?? null,
        meta: debitMeta,
      },
      userId,
      {
        transaction,
        allowVolunteerFundAllocationForFundId: options?.allowVolunteerFundAllocationForFundId,
      },
    );

    const credit = await createFinanceTransaction(
      {
        kind: 'transfer',
        date: data.date,
        accountId: data.toAccountId,
        currency: data.currency,
        amountMinor,
        fxRate,
        baseAmountMinor,
        categoryId: null,
        counterpartyType: 'none',
        counterpartyId: null,
        paymentMethod: null,
        status: data.status ?? 'planned',
        description: data.description ?? null,
        tags: data.tags ?? null,
        meta: creditMeta,
      },
      userId,
      {
        transaction,
        allowVolunteerFundAllocationForFundId: options?.allowVolunteerFundAllocationForFundId,
      },
    );

    return { debit, credit };
  };

  return options?.transaction
    ? createPair(options.transaction)
    : sequelize.transaction(createPair);
}
