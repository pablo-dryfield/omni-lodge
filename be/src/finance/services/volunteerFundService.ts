import dayjs from 'dayjs';
import { Op, type Transaction as SequelizeTransaction } from 'sequelize';
import sequelize from '../../config/database.js';
import HttpError from '../../errors/HttpError.js';
import CompensationComponent from '../../models/CompensationComponent.js';
import CompensationSettlementRule from '../../models/CompensationSettlementRule.js';
import User from '../../models/User.js';
import FinanceAccount from '../models/FinanceAccount.js';
import FinanceCategory from '../models/FinanceCategory.js';
import FinanceTransaction from '../models/FinanceTransaction.js';
import FinanceVendor from '../models/FinanceVendor.js';
import VolunteerFund from '../models/VolunteerFund.js';
import VolunteerFundEntry, { type VolunteerFundEntryType } from '../models/VolunteerFundEntry.js';
import { recordFinanceAuditLog } from './auditLogService.js';
import { createFinanceTransaction, updateFinanceTransaction } from './transactionService.js';
import { reverseVolunteerFundAllocationTransfer } from './volunteerFundAllocationFinanceService.js';

export type VolunteerFundInput = {
  name: string;
  slug: string;
  currency: string;
  description: string | null;
  linkedAccountId: number | null;
  fundingSourceAccountId: number | null;
  expenseCategoryId: number | null;
  isActive: boolean;
};

type ManualEntryInput = {
  amountMinor: number;
  entryDate: string;
  periodStart: string | null;
  periodEnd: string | null;
  description: string;
  attributedStaffUserId: number | null;
  compensationComponentId: number | null;
  sourceKind: string;
  sourceReference: string | null;
  attributionSnapshot: Record<string, unknown>;
  sourceSnapshot: Record<string, unknown>;
  financeTransactionId: number | null;
  spendFinance: {
    accountId: number | null;
    categoryId: number | null;
    vendorId: number | null;
    paymentMethod: string | null;
    invoiceFileId: number | null;
  } | null;
  idempotencyKey: string;
};

type SpendIdempotencyFingerprint =
  | {
      mode: 'existing';
      financeTransactionId: number;
    }
  | {
      mode: 'created';
      accountId: number | null;
      categoryId: number | null;
      vendorId: number | null;
      invoiceFileId: number | null;
      paymentMethod: string | null;
    };

const asRecord = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

const optionalStoredPositiveInteger = (value: unknown): number | null | undefined => {
  if (value === null) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const buildSpendIdempotencyFingerprint = (
  input: ManualEntryInput,
): SpendIdempotencyFingerprint => {
  if (input.financeTransactionId) {
    return {
      mode: 'existing',
      financeTransactionId: input.financeTransactionId,
    };
  }
  return {
    mode: 'created',
    accountId: input.spendFinance?.accountId ?? null,
    categoryId: input.spendFinance?.categoryId ?? null,
    vendorId: input.spendFinance?.vendorId ?? null,
    invoiceFileId: input.spendFinance?.invoiceFileId ?? null,
    paymentMethod: input.spendFinance?.paymentMethod ?? null,
  };
};

const readStoredSpendIdempotencyFingerprint = (
  sourceSnapshot: unknown,
): SpendIdempotencyFingerprint | null => {
  const stored = asRecord(asRecord(sourceSnapshot)?.spendIdempotency);
  if (!stored) {
    return null;
  }
  if (stored.mode === 'existing') {
    const financeTransactionId = optionalStoredPositiveInteger(stored.financeTransactionId);
    return typeof financeTransactionId === 'number'
      ? { mode: 'existing', financeTransactionId }
      : null;
  }
  if (stored.mode !== 'created') {
    return null;
  }
  const accountId = optionalStoredPositiveInteger(stored.accountId);
  const categoryId = optionalStoredPositiveInteger(stored.categoryId);
  const vendorId = optionalStoredPositiveInteger(stored.vendorId);
  const invoiceFileId = optionalStoredPositiveInteger(stored.invoiceFileId);
  const paymentMethod = stored.paymentMethod === null
    ? null
    : typeof stored.paymentMethod === 'string'
      ? stored.paymentMethod
      : undefined;
  if (
    accountId === undefined
    || categoryId === undefined
    || vendorId === undefined
    || invoiceFileId === undefined
    || paymentMethod === undefined
  ) {
    return null;
  }
  return {
    mode: 'created',
    accountId,
    categoryId,
    vendorId,
    invoiceFileId,
    paymentMethod,
  };
};

const spendFingerprintsMatch = (
  left: SpendIdempotencyFingerprint,
  right: SpendIdempotencyFingerprint,
): boolean => {
  if (left.mode !== right.mode) {
    return false;
  }
  if (left.mode === 'existing' && right.mode === 'existing') {
    return left.financeTransactionId === right.financeTransactionId;
  }
  if (left.mode === 'created' && right.mode === 'created') {
    return left.accountId === right.accountId
      && left.categoryId === right.categoryId
      && left.vendorId === right.vendorId
      && left.invoiceFileId === right.invoiceFileId
      && left.paymentMethod === right.paymentMethod;
  }
  return false;
};

const parseOptionalPositiveInteger = (value: unknown, field: string): number | null => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, `${field} must be a positive integer.`);
  }
  return parsed;
};

const parseSignedMinor = (value: unknown, field: string): number => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed === 0) {
    throw new HttpError(400, `${field} must be a non-zero integer in minor currency units.`);
  }
  return parsed;
};

const parsePositiveMinor = (value: unknown, field: string): number => {
  const parsed = parseSignedMinor(value, field);
  if (parsed <= 0) {
    throw new HttpError(400, `${field} must be positive.`);
  }
  return parsed;
};

export const parseFinanceDate = (value: unknown, field: string, fallback?: string): string => {
  const candidate = value === null || value === undefined || value === '' ? fallback : value;
  if (typeof candidate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(candidate.trim())) {
    throw new HttpError(400, `${field} must use YYYY-MM-DD.`);
  }
  const normalized = candidate.trim();
  const parsed = dayjs(normalized);
  if (!parsed.isValid() || parsed.format('YYYY-MM-DD') !== normalized) {
    throw new HttpError(400, `${field} is not a valid date.`);
  }
  return normalized;
};

const parseOptionalFinanceDate = (value: unknown, field: string): string | null => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return parseFinanceDate(value, field);
};

const parseText = (value: unknown, field: string, maxLength: number): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, `${field} is required.`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new HttpError(400, `${field} must be ${maxLength} characters or fewer.`);
  }
  return normalized;
};

const parseOptionalText = (value: unknown, maxLength: number): string | null => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    throw new HttpError(400, 'Text field is invalid.');
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new HttpError(400, `Text field must be ${maxLength} characters or fewer.`);
  }
  return normalized || null;
};

const parseSnapshot = (value: unknown, field: string): Record<string, unknown> => {
  if (value === null || value === undefined) {
    return {};
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, `${field} must be an object.`);
  }
  return { ...(value as Record<string, unknown>) };
};

const slugify = (value: string): string => value
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

const parseBoolean = (value: unknown, fallback: boolean): boolean => {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'boolean') {
    throw new HttpError(400, 'isActive must be a boolean.');
  }
  return value;
};

export const normalizeVolunteerFundInput = (
  raw: Record<string, unknown>,
  fallback?: VolunteerFundInput,
): VolunteerFundInput => {
  const name = parseText(raw.name ?? fallback?.name, 'name', 160);
  const rawSlug = raw.slug === undefined ? (fallback?.slug ?? name) : raw.slug;
  const slug = slugify(parseText(rawSlug, 'slug', 180));
  if (!slug) {
    throw new HttpError(400, 'slug is invalid.');
  }
  const currencyRaw = raw.currency ?? fallback?.currency;
  if (typeof currencyRaw !== 'string' || !/^[A-Za-z]{3}$/.test(currencyRaw.trim())) {
    throw new HttpError(400, 'currency must be a three-letter code.');
  }
  return {
    name,
    slug,
    currency: currencyRaw.trim().toUpperCase(),
    description: raw.description !== undefined
      ? parseOptionalText(raw.description, 4000)
      : (fallback?.description ?? null),
    linkedAccountId: parseOptionalPositiveInteger(
      raw.linkedAccountId !== undefined ? raw.linkedAccountId : fallback?.linkedAccountId,
      'linkedAccountId',
    ),
    fundingSourceAccountId: parseOptionalPositiveInteger(
      raw.fundingSourceAccountId !== undefined
        ? raw.fundingSourceAccountId
        : fallback?.fundingSourceAccountId,
      'fundingSourceAccountId',
    ),
    expenseCategoryId: parseOptionalPositiveInteger(
      raw.expenseCategoryId !== undefined ? raw.expenseCategoryId : fallback?.expenseCategoryId,
      'expenseCategoryId',
    ),
    isActive: parseBoolean(raw.isActive, fallback?.isActive ?? true),
  };
};

const validateFundReferences = async (
  input: VolunteerFundInput,
  transaction: SequelizeTransaction,
): Promise<void> => {
  if (
    input.linkedAccountId
    && input.fundingSourceAccountId
    && input.linkedAccountId === input.fundingSourceAccountId
  ) {
    throw new HttpError(400, 'Funding source account must be different from the linked volunteer fund account.');
  }
  if (input.linkedAccountId) {
    const account = await FinanceAccount.findByPk(input.linkedAccountId, {
      attributes: ['id', 'currency', 'isActive'],
      transaction,
    });
    if (!account) {
      throw new HttpError(400, 'Linked finance account was not found.');
    }
    if (account.currency.toUpperCase() !== input.currency) {
      throw new HttpError(400, 'Linked finance account currency must match the volunteer fund currency.');
    }
    if (input.isActive && !account.isActive) {
      throw new HttpError(400, 'An active volunteer fund cannot use an inactive finance account.');
    }
  }
  if (input.fundingSourceAccountId) {
    const account = await FinanceAccount.findByPk(input.fundingSourceAccountId, {
      attributes: ['id', 'currency', 'isActive'],
      transaction,
    });
    if (!account) {
      throw new HttpError(400, 'Funding source finance account was not found.');
    }
    if (account.currency.toUpperCase() !== input.currency) {
      throw new HttpError(400, 'Funding source account currency must match the volunteer fund currency.');
    }
    if (input.isActive && !account.isActive) {
      throw new HttpError(400, 'An active volunteer fund cannot use an inactive funding source account.');
    }
  }
  if (input.expenseCategoryId) {
    const category = await FinanceCategory.findByPk(input.expenseCategoryId, {
      attributes: ['id', 'kind', 'isActive'],
      transaction,
    });
    if (!category) {
      throw new HttpError(400, 'Expense category was not found.');
    }
    if (category.kind !== 'expense') {
      throw new HttpError(400, 'Volunteer fund category must be an expense category.');
    }
    if (input.isActive && !category.isActive) {
      throw new HttpError(400, 'An active volunteer fund cannot use an inactive expense category.');
    }
  }
};

export const createVolunteerFund = async (
  raw: Record<string, unknown>,
  actorId: number,
): Promise<VolunteerFund> => sequelize.transaction(async (transaction) => {
  const input = normalizeVolunteerFundInput(raw);
  await validateFundReferences(input, transaction);
  const fund = await VolunteerFund.create(
    { ...input, createdBy: actorId, updatedBy: actorId },
    { transaction },
  );
  await recordFinanceAuditLog({
    entity: 'volunteer_fund',
    entityId: fund.id,
    action: 'create',
    performedBy: actorId,
    changes: fund.toJSON() as Record<string, unknown>,
    transaction,
  });
  return fund;
});

const assertLinkedAccountChangeIsSafe = async (
  fund: VolunteerFund,
  nextLinkedAccountId: number | null,
  transaction: SequelizeTransaction,
): Promise<void> => {
  if (nextLinkedAccountId === fund.linkedAccountId) {
    return;
  }

  const financeBackedEntryCount = await VolunteerFundEntry.count({
    where: {
      fundId: fund.id,
      financeTransactionId: { [Op.ne]: null },
    },
    transaction,
  });
  if (financeBackedEntryCount > 0) {
    throw new HttpError(
      409,
      'Linked finance account cannot change after finance-backed Volunteer Fund entries exist.',
    );
  }

  // A legacy ledger-only fund may be linked for the first time even when it
  // already has a balance. Once a fund has a linked account, however, moving a
  // non-zero balance to another account (or unlinking it) without a real
  // Finance transfer would make the two ledgers disagree.
  if (fund.linkedAccountId !== null) {
    const currentBalanceMinor = Number(
      await VolunteerFundEntry.sum('amountMinor', {
        where: { fundId: fund.id },
        transaction,
      }) ?? 0,
    );
    if (!Number.isSafeInteger(currentBalanceMinor)) {
      throw new HttpError(409, 'Volunteer Fund balance could not be verified safely.');
    }
    if (currentBalanceMinor !== 0) {
      throw new HttpError(
        409,
        'Linked finance account cannot change while the Volunteer Fund has a non-zero balance.',
      );
    }
  }
};

export const updateVolunteerFund = async (
  id: number,
  raw: Record<string, unknown>,
  actorId: number,
): Promise<VolunteerFund> => sequelize.transaction(async (transaction) => {
  const fund = await VolunteerFund.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
  if (!fund) {
    throw new HttpError(404, 'Volunteer fund not found.');
  }
  const input = normalizeVolunteerFundInput(raw, {
    name: fund.name,
    slug: fund.slug,
    currency: fund.currency,
    description: fund.description,
    linkedAccountId: fund.linkedAccountId,
    fundingSourceAccountId: fund.fundingSourceAccountId,
    expenseCategoryId: fund.expenseCategoryId,
    isActive: fund.isActive,
  });
  if ((!input.isActive && fund.isActive) || input.currency !== fund.currency) {
    const activeRuleCount = await CompensationSettlementRule.count({
      where: {
        fundId: fund.id,
        isActive: true,
        [Op.or]: [
          { effectiveEnd: null },
          { effectiveEnd: { [Op.gte]: dayjs().format('YYYY-MM-DD') } },
        ],
      },
      transaction,
    });
    if (activeRuleCount > 0) {
      throw new HttpError(
        409,
        input.currency !== fund.currency
          ? 'Volunteer fund currency cannot change while active settlement rules use it.'
          : 'Move or deactivate this fund\'s active settlement rules before deactivating the fund.',
      );
    }
  }
  if (input.currency !== fund.currency) {
    const entryCount = await VolunteerFundEntry.count({ where: { fundId: fund.id }, transaction });
    if (entryCount > 0) {
      throw new HttpError(409, 'Volunteer fund currency cannot change after ledger entries exist.');
    }
  }
  await assertLinkedAccountChangeIsSafe(fund, input.linkedAccountId, transaction);
  await validateFundReferences(input, transaction);
  await fund.update({ ...input, updatedBy: actorId }, { transaction });
  await recordFinanceAuditLog({
    entity: 'volunteer_fund',
    entityId: fund.id,
    action: input.isActive ? 'update' : 'deactivate',
    performedBy: actorId,
    changes: { ...input },
    transaction,
  });
  return fund;
});

export const deactivateVolunteerFund = async (id: number, actorId: number): Promise<VolunteerFund> =>
  updateVolunteerFund(id, { isActive: false }, actorId);

const normalizeManualEntryInput = (
  raw: Record<string, unknown>,
  entryType: 'spend' | 'adjustment',
): ManualEntryInput => {
  const entryDate = parseFinanceDate(raw.entryDate ?? raw.date, 'entryDate', dayjs().format('YYYY-MM-DD'));
  const periodStart = parseOptionalFinanceDate(raw.periodStart, 'periodStart');
  const periodEnd = parseOptionalFinanceDate(raw.periodEnd, 'periodEnd');
  if (Boolean(periodStart) !== Boolean(periodEnd)) {
    throw new HttpError(400, 'periodStart and periodEnd must be provided together.');
  }
  if (periodStart && periodEnd && periodEnd < periodStart) {
    throw new HttpError(400, 'periodEnd must be on or after periodStart.');
  }
  const amountMinor = entryType === 'spend'
    ? -parsePositiveMinor(raw.amountMinor, 'amountMinor')
    : parseSignedMinor(raw.amountMinor, 'amountMinor');
  const sourceKind = parseOptionalText(raw.sourceKind, 64) ?? `manual_${entryType}`;
  if (!/^[A-Za-z0-9][A-Za-z0-9_:-]*$/.test(sourceKind)) {
    throw new HttpError(400, 'sourceKind must be an identifier.');
  }
  const financeTransactionId = parseOptionalPositiveInteger(raw.financeTransactionId, 'financeTransactionId');
  const requestedAccountId = parseOptionalPositiveInteger(raw.accountId, 'accountId');
  const requestedCategoryId = parseOptionalPositiveInteger(raw.categoryId, 'categoryId');
  const requestedVendorId = parseOptionalPositiveInteger(raw.vendorId ?? raw.counterpartyId, 'vendorId');
  const requestedPaymentMethod = parseOptionalText(raw.paymentMethod, 60);
  const requestedInvoiceFileId = parseOptionalPositiveInteger(raw.invoiceFileId, 'invoiceFileId');
  const hasSpendFinanceFields = Boolean(
    requestedAccountId
    || requestedCategoryId
    || requestedVendorId
    || requestedPaymentMethod
    || requestedInvoiceFileId,
  );
  if (entryType !== 'spend' && (financeTransactionId || hasSpendFinanceFields)) {
    throw new HttpError(
      400,
      'Fund adjustments are non-cash corrections and cannot link or create a Finance transaction.',
    );
  }
  if (financeTransactionId && hasSpendFinanceFields) {
    throw new HttpError(400, 'Provide financeTransactionId or expense fields, not both.');
  }
  if (entryType === 'spend' && !financeTransactionId && !requestedVendorId) {
    throw new HttpError(
      400,
      'A Volunteer Fund spend must link an existing paid Finance expense or provide a vendor to create one.',
    );
  }
  return {
    amountMinor,
    entryDate,
    periodStart,
    periodEnd,
    description: parseText(raw.description, 'description', 4000),
    attributedStaffUserId: parseOptionalPositiveInteger(
      raw.attributedStaffUserId ?? raw.staffUserId,
      'attributedStaffUserId',
    ),
    compensationComponentId: parseOptionalPositiveInteger(
      raw.compensationComponentId ?? raw.componentId,
      'compensationComponentId',
    ),
    sourceKind,
    sourceReference: parseOptionalText(raw.sourceReference, 255),
    attributionSnapshot: parseSnapshot(raw.attributionSnapshot, 'attributionSnapshot'),
    sourceSnapshot: parseSnapshot(raw.sourceSnapshot, 'sourceSnapshot'),
    financeTransactionId,
    spendFinance: entryType === 'spend' && !financeTransactionId
      ? {
          accountId: requestedAccountId,
          categoryId: requestedCategoryId,
          vendorId: requestedVendorId,
          paymentMethod: requestedPaymentMethod,
          invoiceFileId: requestedInvoiceFileId,
        }
      : null,
    idempotencyKey: parseText(raw.idempotencyKey, 'idempotencyKey', 180),
  };
};

const createLinkedSpendTransaction = async (
  fund: VolunteerFund,
  input: ManualEntryInput,
  actorId: number,
  transaction: SequelizeTransaction,
): Promise<number> => {
  if (input.financeTransactionId) {
    return input.financeTransactionId;
  }
  if (!input.spendFinance) {
    throw new HttpError(
      400,
      'A Volunteer Fund spend must link an existing paid Finance expense or create one.',
    );
  }
  const accountId = input.spendFinance.accountId ?? fund.linkedAccountId;
  const categoryId = input.spendFinance.categoryId ?? fund.expenseCategoryId;
  const vendorId = input.spendFinance.vendorId;
  if (!accountId || !categoryId || !vendorId) {
    throw new HttpError(
      400,
      'Spend expense creation requires accountId, categoryId, and vendorId (fund defaults may supply account/category).',
    );
  }
  const [account, category, vendor] = await Promise.all([
    FinanceAccount.findByPk(accountId, {
      attributes: ['id', 'currency', 'isActive'],
      transaction,
      lock: transaction.LOCK.UPDATE,
    }),
    FinanceCategory.findByPk(categoryId, {
      attributes: ['id', 'kind', 'isActive'],
      transaction,
      lock: transaction.LOCK.UPDATE,
    }),
    FinanceVendor.findByPk(vendorId, { attributes: ['id'], transaction }),
  ]);
  if (!account || !account.isActive) {
    throw new HttpError(400, 'Spend account was not found or is inactive.');
  }
  if (account.currency.toUpperCase() !== fund.currency) {
    throw new HttpError(400, 'Spend account currency must match the volunteer fund.');
  }
  if (fund.linkedAccountId && account.id !== fund.linkedAccountId) {
    throw new HttpError(400, 'Spend account must match the account linked to this volunteer fund.');
  }
  if (!category || !category.isActive || category.kind !== 'expense') {
    throw new HttpError(400, 'Spend category was not found or is not an active expense category.');
  }
  if (!vendor) {
    throw new HttpError(400, 'Spend vendor was not found.');
  }
  const financeTransaction = await createFinanceTransaction(
    {
      kind: 'expense',
      date: input.entryDate,
      accountId,
      currency: fund.currency,
      amountMinor: Math.abs(input.amountMinor),
      categoryId,
      counterpartyType: 'vendor',
      counterpartyId: vendorId,
      paymentMethod: input.spendFinance.paymentMethod,
      invoiceFileId: input.spendFinance.invoiceFileId,
      status: 'paid',
      description: input.description,
      tags: { volunteerFundId: fund.id },
      meta: {
        source: 'volunteer-fund',
        volunteerFundId: fund.id,
        volunteerFundEntryIdempotencyKey: input.idempotencyKey,
      },
    },
    actorId,
    { transaction, allowVolunteerFundSpendForFundId: fund.id },
  );
  return financeTransaction.id;
};

const validateEntryReferences = async (
  fund: VolunteerFund,
  input: ManualEntryInput,
  entryType: VolunteerFundEntryType,
  transaction: SequelizeTransaction,
): Promise<void> => {
  if (entryType === 'spend' && !input.financeTransactionId) {
    throw new HttpError(
      400,
      'A Volunteer Fund spend must link an existing paid Finance expense or create one.',
    );
  }
  if (input.attributedStaffUserId) {
    const user = await User.findByPk(input.attributedStaffUserId, { attributes: ['id'], transaction });
    if (!user) {
      throw new HttpError(400, 'Attributed staff user was not found.');
    }
  }
  if (input.compensationComponentId) {
    const component = await CompensationComponent.findByPk(input.compensationComponentId, {
      attributes: ['id'],
      transaction,
    });
    if (!component) {
      throw new HttpError(400, 'Compensation component was not found.');
    }
  }
  if (input.financeTransactionId) {
    const financeTransaction = await FinanceTransaction.findByPk(input.financeTransactionId, {
      attributes: [
        'id',
        'kind',
        'status',
        'date',
        'accountId',
        'categoryId',
        'currency',
        'amountMinor',
      ],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!financeTransaction) {
      throw new HttpError(400, 'Finance transaction was not found.');
    }
    if (financeTransaction.currency.toUpperCase() !== fund.currency) {
      throw new HttpError(400, 'Finance transaction currency must match the volunteer fund.');
    }
    if (Math.abs(financeTransaction.amountMinor) !== Math.abs(input.amountMinor)) {
      throw new HttpError(400, 'Finance transaction amount must match the volunteer fund entry.');
    }
    if (entryType === 'spend') {
      if (financeTransaction.kind !== 'expense' || financeTransaction.status !== 'paid') {
        throw new HttpError(
          400,
          'A Volunteer Fund spend can only link to a paid Finance expense transaction.',
        );
      }
      if (financeTransaction.date !== input.entryDate) {
        throw new HttpError(400, 'Finance expense date must match the Volunteer Fund spend date.');
      }
      if (
        fund.expenseCategoryId
        && financeTransaction.categoryId !== fund.expenseCategoryId
      ) {
        throw new HttpError(
          400,
          'Finance expense category must match the category configured for this Volunteer Fund.',
        );
      }
    } else if (financeTransaction.status === 'void') {
      throw new HttpError(400, 'A void finance transaction cannot be linked to a volunteer fund entry.');
    }
    if (fund.linkedAccountId && financeTransaction.accountId !== fund.linkedAccountId) {
      throw new HttpError(400, 'Finance transaction must use the account linked to this volunteer fund.');
    }
  }
};

const assertIdempotentEntryMatches = (
  existing: VolunteerFundEntry,
  entryType: 'spend' | 'adjustment',
  input: ManualEntryInput,
): void => {
  if (
    existing.entryType !== entryType
    || Number(existing.amountMinor) !== input.amountMinor
    || existing.entryDate !== input.entryDate
    || existing.description !== input.description
  ) {
    throw new HttpError(409, 'idempotencyKey is already used by a different volunteer fund entry.');
  }
  if (entryType !== 'spend') {
    return;
  }

  const requestedFingerprint = buildSpendIdempotencyFingerprint(input);
  const sourceSnapshot = asRecord(existing.sourceSnapshot);
  const storedFingerprint = readStoredSpendIdempotencyFingerprint(sourceSnapshot);
  if (storedFingerprint) {
    if (!spendFingerprintsMatch(storedFingerprint, requestedFingerprint)) {
      throw new HttpError(409, 'idempotencyKey is already used by a different volunteer fund spend request.');
    }
    return;
  }

  // Compatibility for entries created before fingerprints were persisted.
  // When legacy metadata identifies a mode, keep enforcing it. Existing-link
  // retries can also be checked safely against the stored transaction id.
  const legacyMode = sourceSnapshot?.financeLinkMode;
  if (
    (legacyMode === 'created' || legacyMode === 'existing')
    && legacyMode !== requestedFingerprint.mode
  ) {
    throw new HttpError(409, 'idempotencyKey is already used by a different volunteer fund spend request.');
  }
  if (
    requestedFingerprint.mode === 'existing'
    && Number(existing.financeTransactionId) !== requestedFingerprint.financeTransactionId
  ) {
    throw new HttpError(409, 'idempotencyKey is already used by a different volunteer fund spend request.');
  }
};

export const createManualVolunteerFundEntry = async (
  fundId: number,
  entryType: 'spend' | 'adjustment',
  raw: Record<string, unknown>,
  actorId: number,
): Promise<{ entry: VolunteerFundEntry; duplicated: boolean }> => sequelize.transaction(async (transaction) => {
  const fund = await VolunteerFund.findByPk(fundId, { transaction, lock: transaction.LOCK.UPDATE });
  if (!fund) {
    throw new HttpError(404, 'Volunteer fund not found.');
  }
  if (!fund.isActive) {
    throw new HttpError(409, 'New entries cannot be added to an inactive volunteer fund.');
  }
  const input = normalizeManualEntryInput(raw, entryType);
  const existing = await VolunteerFundEntry.findOne({
    where: { fundId, idempotencyKey: input.idempotencyKey },
    transaction,
  });
  if (existing) {
    assertIdempotentEntryMatches(existing, entryType, input);
    return { entry: existing, duplicated: true };
  }
  if (input.amountMinor < 0) {
    // The fund row is already locked above, so manual spends/adjustments through
    // this service cannot race one another between the balance check and insert.
    const currentBalanceMinor = Number(
      await VolunteerFundEntry.sum('amountMinor', { where: { fundId }, transaction }) ?? 0,
    );
    if (!Number.isSafeInteger(currentBalanceMinor)) {
      throw new HttpError(409, 'Volunteer Fund balance could not be verified safely.');
    }
    if (currentBalanceMinor + input.amountMinor < 0) {
      throw new HttpError(
        409,
        `This entry exceeds the available Volunteer Fund balance of ${(currentBalanceMinor / 100).toFixed(2)} ${fund.currency}.`,
      );
    }
  }
  const financeLinkMode = entryType === 'spend'
    ? input.financeTransactionId
      ? 'existing'
      : 'created'
    : null;
  const spendIdempotency = entryType === 'spend'
    ? buildSpendIdempotencyFingerprint(input)
    : null;
  if (entryType === 'spend') {
    input.financeTransactionId = await createLinkedSpendTransaction(
      fund,
      input,
      actorId,
      transaction,
    );
  }
  await validateEntryReferences(fund, input, entryType, transaction);
  const entry = await VolunteerFundEntry.create(
    {
      fundId,
      entryType,
      amountMinor: input.amountMinor,
      currency: fund.currency,
      entryDate: input.entryDate,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      description: input.description,
      attributedStaffUserId: input.attributedStaffUserId,
      compensationComponentId: input.compensationComponentId,
      sourceKind: input.sourceKind,
      sourceReference: input.sourceReference,
      attributionSnapshot: input.attributionSnapshot,
      sourceSnapshot: financeLinkMode
        ? {
            ...input.sourceSnapshot,
            financeLinkMode,
            spendIdempotency,
          }
        : input.sourceSnapshot,
      financeTransactionId: input.financeTransactionId,
      idempotencyKey: input.idempotencyKey,
      reversalOfEntryId: null,
      createdBy: actorId,
    },
    { transaction },
  );
  await recordFinanceAuditLog({
    entity: 'volunteer_fund_entry',
    entityId: entry.id,
    action: entryType,
    performedBy: actorId,
    changes: entry.toJSON() as Record<string, unknown>,
    transaction,
  });
  return { entry, duplicated: false };
});

type SpendFinanceReversalResult = {
  financeTransactionId: number;
  action: 'voided_atomically' | 'already_void';
};

const reverseLinkedSpendFinance = async (
  fund: VolunteerFund,
  original: VolunteerFundEntry,
  actorId: number,
  transaction: SequelizeTransaction,
): Promise<SpendFinanceReversalResult | null> => {
  if (original.entryType !== 'spend') {
    return null;
  }
  if (!original.financeTransactionId) {
    throw new HttpError(
      409,
      'This legacy spend has no linked Finance expense and cannot be reversed safely.',
    );
  }

  const financeTransaction = await FinanceTransaction.findByPk(original.financeTransactionId, {
    attributes: ['id', 'kind', 'status', 'meta'],
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (!financeTransaction) {
    throw new HttpError(409, 'The Finance expense linked to this spend no longer exists.');
  }

  if (financeTransaction.kind !== 'expense') {
    throw new HttpError(409, 'The Finance record linked to this fund spend is no longer an expense.');
  }
  if (financeTransaction.status === 'void') {
    return {
      financeTransactionId: financeTransaction.id,
      action: 'already_void',
    };
  }
  if (financeTransaction.status !== 'paid') {
    throw new HttpError(
      409,
      'The Finance expense linked to this fund spend is no longer paid and must be repaired before reversal.',
    );
  }

  await updateFinanceTransaction(
    financeTransaction.id,
    { status: 'void' },
    actorId,
    { transaction, allowVolunteerFundSpendReversal: true },
  );
  return {
    financeTransactionId: financeTransaction.id,
    action: 'voided_atomically',
  };
};

export const reverseVolunteerFundEntry = async (
  fundId: number,
  entryId: number,
  raw: Record<string, unknown>,
  actorId: number,
): Promise<{ entry: VolunteerFundEntry; duplicated: boolean }> => sequelize.transaction(async (transaction) => {
  const fund = await VolunteerFund.findByPk(fundId, { transaction, lock: transaction.LOCK.UPDATE });
  if (!fund) {
    throw new HttpError(404, 'Volunteer fund not found.');
  }
  const original = await VolunteerFundEntry.findOne({
    where: { id: entryId, fundId },
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (!original) {
    throw new HttpError(404, 'Volunteer fund entry not found.');
  }
  if (original.entryType === 'reversal') {
    throw new HttpError(409, 'A reversal entry cannot itself be reversed.');
  }
  const existing = await VolunteerFundEntry.findOne({
    where: { reversalOfEntryId: original.id },
    transaction,
  });
  if (existing) {
    return { entry: existing, duplicated: true };
  }
  const entryDate = parseFinanceDate(raw.entryDate ?? raw.date, 'entryDate', dayjs().format('YYYY-MM-DD'));
  const description = parseOptionalText(raw.description, 4000)
    ?? `Reversal of volunteer fund entry #${original.id}: ${original.description}`;
  const financeTransactionId = parseOptionalPositiveInteger(raw.financeTransactionId, 'financeTransactionId');
  if (financeTransactionId) {
    throw new HttpError(
      400,
      'Volunteer Fund reversals cannot link a new Finance transaction. Linked Finance records are managed automatically.',
    );
  }
  if (original.entryType === 'allocation' && !original.sourceKind) {
    throw new HttpError(
      409,
      'This allocation is missing its compensation source and cannot be safely reversed.',
    );
  }
  const reversalAmountMinor = -Number(original.amountMinor);
  if (!Number.isSafeInteger(reversalAmountMinor)) {
    throw new HttpError(409, 'The reversal amount could not be verified safely.');
  }
  if (reversalAmountMinor < 0) {
    const currentBalanceMinor = Number(
      await VolunteerFundEntry.sum('amountMinor', { where: { fundId }, transaction }) ?? 0,
    );
    if (
      !Number.isSafeInteger(currentBalanceMinor)
      || currentBalanceMinor + reversalAmountMinor < 0
    ) {
      throw new HttpError(
        409,
        'This reversal would make the Volunteer Fund balance negative. Reverse related spending or correct the balance first.',
      );
    }
  }
  const spendFinanceReversal = await reverseLinkedSpendFinance(
    fund,
    original,
    actorId,
    transaction,
  );
  const allocationFinanceReversal = original.entryType === 'allocation'
    ? await reverseVolunteerFundAllocationTransfer({
        fund,
        original,
        actorId,
        transaction,
      })
    : null;
  const reversalInput: ManualEntryInput = {
    amountMinor: reversalAmountMinor,
    entryDate,
    periodStart: original.periodStart,
    periodEnd: original.periodEnd,
    description,
    attributedStaffUserId: original.attributedStaffUserId,
    compensationComponentId: original.compensationComponentId,
    // Keep the original attribution keys on the compensating entry. Pays
    // groups allocation + reversal rows by source/component, so changing the
    // source to a generic "reversal" bucket would leave the original staff
    // compensation looking allocated after it had been reversed.
    sourceKind: original.sourceKind ?? 'reversal',
    sourceReference: original.sourceReference,
    attributionSnapshot: { ...(original.attributionSnapshot ?? {}) },
    sourceSnapshot: {
      reversedEntryId: original.id,
      originalEntryType: original.entryType,
      originalSourceSnapshot: original.sourceSnapshot ?? {},
      reason: parseOptionalText(raw.reason, 2000),
      ...(spendFinanceReversal ? { financeReversal: spendFinanceReversal } : {}),
      ...(allocationFinanceReversal
        ? { financeTransferReversal: allocationFinanceReversal }
        : {}),
    },
    financeTransactionId: null,
    spendFinance: null,
    idempotencyKey: `reversal:${original.id}`,
  };
  await validateEntryReferences(fund, reversalInput, 'reversal', transaction);
  const reversal = await VolunteerFundEntry.create(
    {
      fundId,
      entryType: 'reversal',
      amountMinor: reversalInput.amountMinor,
      currency: original.currency,
      entryDate: reversalInput.entryDate,
      periodStart: reversalInput.periodStart,
      periodEnd: reversalInput.periodEnd,
      description: reversalInput.description,
      attributedStaffUserId: reversalInput.attributedStaffUserId,
      compensationComponentId: reversalInput.compensationComponentId,
      sourceKind: reversalInput.sourceKind,
      sourceReference: reversalInput.sourceReference,
      attributionSnapshot: reversalInput.attributionSnapshot,
      sourceSnapshot: reversalInput.sourceSnapshot,
      financeTransactionId: reversalInput.financeTransactionId,
      idempotencyKey: reversalInput.idempotencyKey,
      reversalOfEntryId: original.id,
      createdBy: actorId,
    },
    { transaction },
  );
  await recordFinanceAuditLog({
    entity: 'volunteer_fund_entry',
    entityId: reversal.id,
    action: 'reversal',
    performedBy: actorId,
    changes: reversal.toJSON() as Record<string, unknown>,
    metadata: { reversedEntryId: original.id },
    transaction,
  });
  return { entry: reversal, duplicated: false };
});
