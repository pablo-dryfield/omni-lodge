import crypto from 'crypto';
import { Transaction as SequelizeTransaction } from 'sequelize';
import sequelize from '../../config/database.js';
import FinanceTransaction, {
  FinanceTransactionKind,
  FinanceTransactionStatus,
  FinanceTransactionCounterpartyType,
} from '../models/FinanceTransaction.js';
import { recordFinanceAuditLog } from './auditLogService.js';

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
  tags?: Record<string, unknown> | null;
  meta?: Record<string, unknown> | null;
  invoiceFileId?: number | null;
  approvedBy?: number | null;
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
  options?: { transaction?: SequelizeTransaction },
): Promise<FinanceTransaction> {
  const amountMinor = Number(data.amountMinor);
  if (!Number.isFinite(amountMinor)) {
    throw new Error('amountMinor must be a finite number');
  }

  const fxRate = data.fxRate ?? 1;
  const baseAmountMinor = data.baseAmountMinor ?? calculateBaseAmount(amountMinor, fxRate);
  const { counterpartyType, counterpartyId } = normalizeCounterparty(data);

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
      tags: data.tags ?? null,
      meta,
      invoiceFileId: data.invoiceFileId ?? null,
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
  });

  return record;
}

export async function updateFinanceTransaction(
  id: number,
  changes: Partial<FinanceTransactionInput>,
  userId: number,
  options?: { transaction?: SequelizeTransaction },
): Promise<FinanceTransaction> {
  const record = await FinanceTransaction.findByPk(id, { transaction: options?.transaction });
  if (!record) {
    throw new Error('Transaction not found');
  }

  const lockedStatuses: FinanceTransactionStatus[] = ['paid'];
  if (lockedStatuses.includes(record.status)) {
    const forbiddenFields: (keyof FinanceTransactionInput)[] = ['amountMinor', 'currency', 'fxRate'];
    for (const field of forbiddenFields) {
      if (field in changes && changes[field] !== undefined) {
        throw new Error('Cannot modify amount, currency, or fxRate once transaction is paid');
      }
    }
  }

  const nextCounterparty = changes.kind
    ? normalizeCounterparty({ ...record.toJSON(), ...changes } as FinanceTransactionInput)
    : {
        counterpartyType: record.counterpartyType,
        counterpartyId: record.counterpartyId,
      };

  const payload: Partial<FinanceTransaction> = {
    ...('kind' in changes ? { kind: changes.kind } : {}),
    ...('date' in changes ? { date: changes.date } : {}),
    ...('accountId' in changes ? { accountId: changes.accountId } : {}),
    ...('currency' in changes ? { currency: changes.currency } : {}),
    ...('amountMinor' in changes ? { amountMinor: changes.amountMinor } : {}),
    ...('fxRate' in changes ? { fxRate: String(changes.fxRate ?? record.fxRate) } : {}),
    ...('baseAmountMinor' in changes
      ? { baseAmountMinor: changes.baseAmountMinor ?? calculateBaseAmount(record.amountMinor, record.fxRate) }
      : {}),
    ...('categoryId' in changes ? { categoryId: changes.categoryId ?? null } : {}),
    counterpartyType: nextCounterparty.counterpartyType,
    counterpartyId: nextCounterparty.counterpartyId,
    ...('paymentMethod' in changes ? { paymentMethod: changes.paymentMethod ?? null } : {}),
    ...('status' in changes ? { status: changes.status } : {}),
    ...('description' in changes ? { description: changes.description ?? null } : {}),
    ...('tags' in changes ? { tags: changes.tags ?? null } : {}),
    ...('meta' in changes ? { meta: ensureMeta(changes.meta) } : {}),
    ...('invoiceFileId' in changes ? { invoiceFileId: changes.invoiceFileId ?? null } : {}),
    ...('approvedBy' in changes ? { approvedBy: changes.approvedBy ?? null } : {}),
  };

  await record.update(payload, { transaction: options?.transaction });

  await recordFinanceAuditLog({
    entity: 'finance_transaction',
    entityId: record.id,
    action: 'update',
    performedBy: userId,
    changes: payload as Record<string, unknown>,
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

  return sequelize.transaction(async (transaction) => {
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
      { transaction },
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
      { transaction },
    );

    return { debit, credit };
  });
}

