import crypto from 'crypto';
import type { Response } from 'express';
import dayjs from 'dayjs';
import { Op, col, fn, where, type Transaction as SequelizeTransaction } from 'sequelize';
import sequelize from '../config/database.js';
import StaffPayoutCollectionLog from '../models/StaffPayoutCollectionLog.js';
import StaffProfile from '../models/StaffProfile.js';
import AffiliatePayoutLog from '../models/AffiliatePayoutLog.js';
import StaffPayoutReceipt from '../models/StaffPayoutReceipt.js';
import StaffPayoutReceiptItem from '../models/StaffPayoutReceiptItem.js';
import RequiredAction from '../models/RequiredAction.js';
import User from '../models/User.js';
import FinanceAccount from '../finance/models/FinanceAccount.js';
import FinanceCategory from '../finance/models/FinanceCategory.js';
import FinanceTransaction from '../finance/models/FinanceTransaction.js';
import { createFinanceTransaction, updateFinanceTransaction } from '../finance/services/transactionService.js';
import HttpError from '../errors/HttpError.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import { getConfigValue } from '../services/configService.js';
import { getAffiliateOverview } from '../services/affiliateService.js';
import {
  createStaffPayoutReceipt,
  type StaffPayoutReceiptSourceItem,
} from '../services/staffPayoutReceiptService.js';
import { buildStaffPayoutReceiptReissueItems } from '../services/staffPayoutReceiptDeletionService.js';
import { groupStaffPayoutReceiptItemsByCurrency } from '../services/staffPayoutReceiptValidation.js';
import {
  assertStaffPayoutDirectionDetails,
  assertUniqueStaffAffiliatePayoutClaims,
  deriveStaffPayoutReimbursementAmount,
  parseStrictStaffPayoutDate,
  validateStaffPayoutFinanceSelections,
} from '../services/staffPayoutBatchValidation.js';

const resolveDefaultCurrency = (): string =>
  String(getConfigValue('FINANCE_BASE_CURRENCY') ?? 'PLN')
    .trim()
    .toUpperCase();

const parseAmountToMinor = (value: unknown): number => {
  if (value === null || value === undefined || value === '') {
    return 0;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new HttpError(400, 'Amount must be a positive number.');
  }
  return Math.round(parsed * 100);
};

const requireActorId = (req: AuthenticatedRequest): number => {
  const actorId = req.authContext?.id;
  if (!actorId) {
    throw new HttpError(401, 'Unauthorized');
  }
  return actorId;
};

type StaffPayoutBatchLinePayload = {
  label?: unknown;
  componentId?: unknown;
  amount?: unknown;
  categoryId?: unknown;
  accountId?: unknown;
  currency?: unknown;
  description?: unknown;
  affiliatePayout?: unknown;
};

type StaffPayoutBatchReimbursementEntry = {
  transactionId?: unknown;
  amount?: unknown;
};

type NormalizedStaffPayoutBatchLine = {
  label: string;
  componentId: number | null;
  amountMinor: number;
  categoryId: number;
  accountId: number;
  currency: string | null;
  description: string | null;
  affiliatePayout: {
    affiliateUserId: number;
    bookingIds: number[];
  } | null;
};

type NormalizedStaffPayoutBatchReimbursement = {
  amountMinor: number;
  accountId: number;
  categoryId: number;
  transactionIds: number[];
  description: string | null;
};

const parseOptionalString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parsePositiveInteger = (value: unknown, field: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, `${field} must be a positive integer.`);
  }
  return parsed;
};

const parseOptionalPositiveInteger = (value: unknown, field: string): number | null => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return parsePositiveInteger(value, field);
};

const normalizeCurrencyCode = (value: unknown, fallback = resolveDefaultCurrency()): string => {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim().toUpperCase();
  }
  return fallback;
};

const ensureCanonicalMonthRange = (rangeStartRaw: string, rangeEndRaw: string): { rangeStart: dayjs.Dayjs; rangeEnd: dayjs.Dayjs } => {
  const rangeStart = dayjs(rangeStartRaw).startOf('day');
  const rangeEnd = dayjs(rangeEndRaw).endOf('day');
  if (!rangeStart.isValid() || !rangeEnd.isValid() || rangeEnd.isBefore(rangeStart)) {
    throw new HttpError(400, 'Provide a valid rangeStart and rangeEnd.');
  }
  const isCanonicalRange =
    rangeStart.isSame(rangeStart.startOf('month'), 'day') &&
    rangeEnd.isSame(rangeStart.endOf('month'), 'day') &&
    rangeStart.isSame(rangeEnd, 'month') &&
    rangeStart.year() === rangeEnd.year();
  if (!isCanonicalRange) {
    throw new HttpError(400, 'Payouts can only be recorded for full calendar months.');
  }
  return { rangeStart, rangeEnd };
};

const normalizeBatchLines = (rawLines: unknown): NormalizedStaffPayoutBatchLine[] => {
  if (!Array.isArray(rawLines)) {
    throw new HttpError(400, 'lines must be an array.');
  }
  const normalized = rawLines
    .map((entry, index) => {
      if (!entry || typeof entry !== 'object') {
        throw new HttpError(400, `lines[${index}] is invalid.`);
      }
      const line = entry as StaffPayoutBatchLinePayload;
      const amountMinor = parseAmountToMinor(line.amount);
      const categoryId = parsePositiveInteger(line.categoryId, `lines[${index}].categoryId`);
      const accountId = parsePositiveInteger(line.accountId, `lines[${index}].accountId`);
      const affiliatePayout =
        line.affiliatePayout && typeof line.affiliatePayout === 'object'
          ? (() => {
              const input = line.affiliatePayout as { affiliateUserId?: unknown; bookingIds?: unknown };
              const affiliateUserId = parsePositiveInteger(input.affiliateUserId, `lines[${index}].affiliatePayout.affiliateUserId`);
              if (!Array.isArray(input.bookingIds)) {
                throw new HttpError(400, `lines[${index}].affiliatePayout.bookingIds must be an array.`);
              }
              const bookingIds = Array.from(
                new Set(
                  input.bookingIds.map((bookingId, bookingIndex) =>
                    parsePositiveInteger(bookingId, `lines[${index}].affiliatePayout.bookingIds[${bookingIndex}]`),
                  ),
                ),
              );
              if (bookingIds.length === 0) {
                throw new HttpError(400, `lines[${index}].affiliatePayout.bookingIds must include at least one booking.`);
              }
              return { affiliateUserId, bookingIds };
            })()
          : null;
      return {
        label: parseOptionalString(line.label) ?? `Line ${index + 1}`,
        componentId: parseOptionalPositiveInteger(line.componentId, `lines[${index}].componentId`),
        amountMinor,
        categoryId,
        accountId,
        currency: parseOptionalString(line.currency)?.toUpperCase() ?? null,
        description: parseOptionalString(line.description),
        affiliatePayout,
      };
    })
    .filter((line) => line.amountMinor > 0);

  return normalized;
};

const normalizeReimbursementPayload = (raw: unknown): NormalizedStaffPayoutBatchReimbursement | null => {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const input = raw as {
    amount?: unknown;
    accountId?: unknown;
    categoryId?: unknown;
    description?: unknown;
    entries?: unknown;
  };
  const amountMinor = parseAmountToMinor(input.amount);
  if (amountMinor <= 0) {
    return null;
  }
  const accountId = parsePositiveInteger(input.accountId, 'reimbursement.accountId');
  const categoryId = parsePositiveInteger(input.categoryId, 'reimbursement.categoryId');
  const entries = Array.isArray(input.entries) ? input.entries : [];
  const transactionIds = entries
    .map((entry, index) => {
      if (!entry || typeof entry !== 'object') {
        throw new HttpError(400, `reimbursement.entries[${index}] is invalid.`);
      }
      return parsePositiveInteger((entry as StaffPayoutBatchReimbursementEntry).transactionId, `reimbursement.entries[${index}].transactionId`);
    });
  return {
    amountMinor,
    accountId,
    categoryId,
    transactionIds,
    description: parseOptionalString(input.description) ?? 'Staff reimbursements payout',
  };
};

type StaffPayoutBatchKeyParams = {
  staffProfileId: number;
  direction: 'receivable' | 'payable';
  counterpartyId: number;
  paidDate: string;
  rangeStart: string;
  rangeEnd: string;
  lines: NormalizedStaffPayoutBatchLine[];
  reimbursement: NormalizedStaffPayoutBatchReimbursement | null;
};

const buildStaffPayoutBatchKeyBase = (params: StaffPayoutBatchKeyParams) => ({
    staffProfileId: params.staffProfileId,
    rangeStart: params.rangeStart,
    rangeEnd: params.rangeEnd,
    lines: [...params.lines]
      .map((line) => ({
        label: line.label,
        componentId: line.componentId,
        amountMinor: line.amountMinor,
        categoryId: line.categoryId,
        accountId: line.accountId,
        currency: line.currency ?? null,
        description: line.description ?? null,
        affiliatePayout: line.affiliatePayout
          ? {
              affiliateUserId: line.affiliatePayout.affiliateUserId,
              bookingIds: [...line.affiliatePayout.bookingIds].sort((a, b) => a - b),
            }
          : null,
      }))
      .sort((a, b) =>
        JSON.stringify([a.label, a.amountMinor, a.categoryId, a.accountId, a.currency, a.description]).localeCompare(
          JSON.stringify([b.label, b.amountMinor, b.categoryId, b.accountId, b.currency, b.description]),
        ),
      ),
    reimbursement: params.reimbursement
      ? {
          amountMinor: params.reimbursement.amountMinor,
          accountId: params.reimbursement.accountId,
          categoryId: params.reimbursement.categoryId,
          description: params.reimbursement.description ?? null,
          transactionIds: [...params.reimbursement.transactionIds].sort((a, b) => a - b),
        }
      : null,
});

const hashStaffPayoutBatchKey = (value: unknown): string =>
  crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

const buildLegacyStaffPayoutBatchKey = (params: StaffPayoutBatchKeyParams): string =>
  hashStaffPayoutBatchKey(buildStaffPayoutBatchKeyBase(params));

const buildStaffPayoutBatchKey = (params: StaffPayoutBatchKeyParams): string =>
  hashStaffPayoutBatchKey({
    version: 2,
    direction: params.direction,
    counterpartyId: params.counterpartyId,
    paidDate: params.paidDate,
    ...buildStaffPayoutBatchKeyBase(params),
  });

const findExistingBatchTransaction = async (batchKey: string, transaction?: SequelizeTransaction): Promise<FinanceTransaction | null> =>
  FinanceTransaction.findOne({
    where: {
      [Op.and]: [
        where(fn('jsonb_extract_path_text', col('meta'), 'source'), 'staff-payments'),
        where(fn('jsonb_extract_path_text', col('meta'), 'payoutBatchKey'), batchKey),
      ],
    },
    transaction,
  });

const findExistingCompatibleStaffPayoutBatch = async (params: {
  batchKey: string;
  legacyBatchKey: string;
  direction: 'receivable' | 'payable';
  counterpartyId: number;
  paidDate: string;
  transaction?: SequelizeTransaction;
}): Promise<FinanceTransaction | null> => {
  const current = await findExistingBatchTransaction(params.batchKey, params.transaction);
  if (current) {
    return current;
  }
  const legacy = await findExistingBatchTransaction(params.legacyBatchKey, params.transaction);
  const expectedKind = params.direction === 'payable' ? 'expense' : 'income';
  return legacy
    && legacy.kind === expectedKind
    && Number(legacy.counterpartyId) === params.counterpartyId
    && legacy.date === params.paidDate
    ? legacy
    : null;
};

const getStoredStaffPayoutBatchKey = (
  financeTransaction: FinanceTransaction,
  fallback: string,
): string => {
  const meta = financeTransaction.meta && typeof financeTransaction.meta === 'object'
    ? financeTransaction.meta as Record<string, unknown>
    : null;
  const stored = typeof meta?.payoutBatchKey === 'string' ? meta.payoutBatchKey.trim() : '';
  return stored || fallback;
};

const listActiveBatchReceipts = async (
  batchKey: string,
  transaction?: SequelizeTransaction,
): Promise<StaffPayoutReceipt[]> =>
  StaffPayoutReceipt.findAll({
    where: {
      payoutBatchKey: { [Op.like]: `${batchKey}:%` },
      status: { [Op.in]: ['pending', 'completed'] },
    },
    order: [['id', 'ASC']],
    transaction,
  });

const serializeReceiptReferences = (receipts: StaffPayoutReceipt[]) =>
  receipts.map((receipt) => ({
    id: receipt.id,
    actionId: receipt.requiredActionId,
    status: receipt.status,
    payoutBatchKey: receipt.payoutBatchKey,
  }));

const createPayoutCollectionLog = async (
  params: {
    staffProfileId: number;
    direction: 'receivable' | 'payable';
    currency: string;
    amountMinor: number;
    rangeStart: string;
    rangeEnd: string;
    financeTransactionId: number | null;
    note: string | null;
    actorId: number;
  },
  transaction: SequelizeTransaction,
): Promise<StaffPayoutCollectionLog> =>
  StaffPayoutCollectionLog.create(
    {
      staffProfileId: params.staffProfileId,
      direction: params.direction,
      currencyCode: params.currency,
      amountMinor: params.amountMinor,
      rangeStart: params.rangeStart,
      rangeEnd: params.rangeEnd,
      financeTransactionId: params.financeTransactionId,
      note: params.note,
      createdBy: params.actorId,
    },
    { transaction },
  );

const createAffiliatePayoutLogForStaffLine = async (
  params: {
    staffProfileId: number;
    rangeStart: string;
    rangeEnd: string;
    paidDate: string;
    amountMinor: number;
    currency: string;
    financeTransactionId: number;
    note: string | null;
    actorId: number;
    affiliatePayout: {
      affiliateUserId: number;
      bookingIds: number[];
    };
  },
  transaction: SequelizeTransaction,
): Promise<void> => {
  if (params.affiliatePayout.affiliateUserId !== params.staffProfileId) {
    throw new HttpError(400, 'Affiliate payout user must match the staff payout user.');
  }

  const overview = await getAffiliateOverview({
    startDate: params.rangeStart,
    endDate: params.rangeEnd,
    selectedAffiliateUserId: params.staffProfileId,
    currentUserId: params.actorId,
    currentRoleSlug: 'manager',
    includeStaffAffiliateAssignments: true,
  });

  const selectedBookingIds = new Set(params.affiliatePayout.bookingIds);
  const selectedBookings = overview.bookings.filter((booking) => selectedBookingIds.has(booking.id));
  if (selectedBookings.length !== selectedBookingIds.size) {
    throw new HttpError(400, 'One or more affiliate bookings are no longer available for this staff member.');
  }
  const alreadyPaid = selectedBookings.filter((booking) => booking.isCommissionPaid);
  if (alreadyPaid.length > 0) {
    throw new HttpError(400, 'One or more affiliate bookings have already been paid.');
  }

  const currencySet = new Set(
    selectedBookings
      .map((booking) => booking.currency?.trim().toUpperCase())
      .filter((value): value is string => Boolean(value)),
  );
  if (currencySet.size !== 1) {
    throw new HttpError(400, 'Affiliate payout requires all selected bookings to use the same currency.');
  }
  const bookingCurrency = Array.from(currencySet)[0];
  if (bookingCurrency !== params.currency.trim().toUpperCase()) {
    throw new HttpError(400, `Selected payout account currency must match affiliate booking currency ${bookingCurrency}.`);
  }

  const expectedAmountMinor = Math.round(
    selectedBookings.reduce((sum, booking) => sum + booking.affiliateCommissionAmount, 0) * 100,
  );
  if (expectedAmountMinor <= 0) {
    throw new HttpError(400, 'Affiliate payout amount must be positive.');
  }
  if (expectedAmountMinor !== params.amountMinor) {
    throw new HttpError(400, 'Affiliate payout line amount no longer matches selected bookings.');
  }

  await AffiliatePayoutLog.create(
    {
      affiliateUserId: params.staffProfileId,
      currencyCode: bookingCurrency,
      amountMinor: params.amountMinor,
      rangeStart: params.rangeStart,
      rangeEnd: params.rangeEnd,
      paidDate: params.paidDate,
      bookingIds: Array.from(selectedBookingIds.values()),
      financeTransactionId: params.financeTransactionId,
      note: params.note,
      createdBy: params.actorId,
    },
    { transaction },
  );
};

const parseEntryIds = (raw: unknown): number[] => {
  if (!Array.isArray(raw)) {
    throw new HttpError(400, 'entryIds must be an array.');
  }
  const unique = Array.from(
    new Set(raw.map((value, index) => parsePositiveInteger(value, `entryIds[${index}]`))),
  );
  if (unique.length === 0) {
    throw new HttpError(400, 'Select at least one paid entry.');
  }
  return unique;
};

const looksLikeReimbursementEntry = (params: {
  meta?: Record<string, unknown> | null;
  description?: string | null;
  note?: string | null;
}): boolean => {
  const metaLineLabel =
    typeof params.meta?.lineLabel === 'string' ? params.meta.lineLabel.trim() : '';
  const description = typeof params.description === 'string' ? params.description.trim() : '';
  const note = typeof params.note === 'string' ? params.note.trim() : '';
  return [metaLineLabel, description, note].some((value) => value.toLowerCase().includes('reimbursement'));
};

export const createStaffPayoutCollectionLog = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const actorId = requireActorId(req);
    const staffProfileId = Number(req.body.staffProfileId);
    if (!Number.isInteger(staffProfileId) || staffProfileId <= 0) {
      throw new HttpError(400, 'A valid staffProfileId is required.');
    }

    const directionInput = typeof req.body.direction === 'string' ? req.body.direction.toLowerCase() : 'payable';
    const direction: 'receivable' | 'payable' =
      directionInput === 'receivable' || directionInput === 'payable' ? directionInput : 'payable';

    const currency =
      typeof req.body.currency === 'string' && req.body.currency.trim().length > 0
        ? req.body.currency.trim().toUpperCase()
        : resolveDefaultCurrency();

    const amountMinor = parseAmountToMinor(req.body.amount);
    const rangeStartRaw = typeof req.body.rangeStart === 'string' ? req.body.rangeStart : '';
    const rangeEndRaw = typeof req.body.rangeEnd === 'string' ? req.body.rangeEnd : '';

    const rangeStart = dayjs(rangeStartRaw).startOf('day');
    const rangeEnd = dayjs(rangeEndRaw).endOf('day');
    if (!rangeStart.isValid() || !rangeEnd.isValid() || rangeEnd.isBefore(rangeStart)) {
      throw new HttpError(400, 'Provide a valid rangeStart and rangeEnd.');
    }

    const isCanonicalRange =
      rangeStart.isSame(rangeStart.startOf('month'), 'day') &&
      rangeEnd.isSame(rangeStart.endOf('month'), 'day') &&
      rangeStart.isSame(rangeEnd, 'month') &&
      rangeStart.year() === rangeEnd.year();
    if (!isCanonicalRange) {
      throw new HttpError(400, 'Payouts can only be recorded for full calendar months.');
    }

    const staffProfile = await StaffProfile.findOne({
      where: { userId: staffProfileId },
      attributes: ['userId', 'financeVendorId', 'financeClientId'],
    });
    if (!staffProfile) {
      throw new HttpError(404, 'Staff profile not found.');
    }

    if (direction === 'payable' && !staffProfile.financeVendorId) {
      throw new HttpError(400, 'This staff profile is not linked to a finance vendor.');
    }
    if (direction === 'receivable' && !staffProfile.financeClientId) {
      throw new HttpError(400, 'This staff profile is not linked to a finance client.');
    }

    const financeTransactionIdRaw =
      req.body.financeTransactionId !== undefined ? Number(req.body.financeTransactionId) : null;
    let financeTransactionId: number | null = null;
    if (financeTransactionIdRaw !== null && financeTransactionIdRaw !== 0) {
      if (!Number.isInteger(financeTransactionIdRaw) || financeTransactionIdRaw <= 0) {
        throw new HttpError(400, 'financeTransactionId must be a positive integer.');
      }
      const transactionExists = await FinanceTransaction.count({ where: { id: financeTransactionIdRaw } });
      if (!transactionExists) {
        throw new HttpError(400, 'Finance transaction not found.');
      }
      financeTransactionId = financeTransactionIdRaw;
    }

    const note = typeof req.body.note === 'string' && req.body.note.trim().length > 0 ? req.body.note.trim() : null;

    const record = await StaffPayoutCollectionLog.create({
      staffProfileId,
      direction,
      currencyCode: currency,
      amountMinor,
      rangeStart: rangeStart.format('YYYY-MM-DD'),
      rangeEnd: rangeEnd.format('YYYY-MM-DD'),
      financeTransactionId,
      note,
      createdBy: actorId,
    });

    res.status(201).json([record]);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json([{ message: error.message }]);
      return;
    }
    res.status(500).json([{ message: 'Failed to record staff payout' }]);
  }
};

export const createStaffPayoutBatch = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const actorId = requireActorId(req);
    const staffProfileId = parsePositiveInteger(req.body.staffProfileId, 'staffProfileId');
    const directionInput = typeof req.body.direction === 'string' ? req.body.direction.toLowerCase() : 'payable';
    const direction: 'receivable' | 'payable' =
      directionInput === 'receivable' || directionInput === 'payable' ? directionInput : 'payable';
    const rangeStartRaw = typeof req.body.rangeStart === 'string' ? req.body.rangeStart : '';
    const rangeEndRaw = typeof req.body.rangeEnd === 'string' ? req.body.rangeEnd : '';
    const { rangeStart, rangeEnd } = ensureCanonicalMonthRange(rangeStartRaw, rangeEndRaw);
    const payoutDate = parseStrictStaffPayoutDate(req.body.date);

    const staffProfile = await StaffProfile.findOne({
      where: { userId: staffProfileId },
      attributes: ['userId', 'financeVendorId', 'financeClientId'],
    });
    if (!staffProfile) {
      throw new HttpError(404, 'Staff profile not found.');
    }
    if (direction === 'payable' && !staffProfile.financeVendorId) {
      throw new HttpError(400, 'This staff profile is not linked to a finance vendor.');
    }
    if (direction === 'receivable' && !staffProfile.financeClientId) {
      throw new HttpError(400, 'This staff profile is not linked to a finance client.');
    }

    const linkedCounterpartyId = direction === 'payable'
      ? Number(staffProfile.financeVendorId)
      : Number(staffProfile.financeClientId);
    const counterpartyId = parsePositiveInteger(linkedCounterpartyId, 'counterpartyId');
    if (req.body.counterpartyId !== undefined && req.body.counterpartyId !== null) {
      const requestedCounterpartyId = parsePositiveInteger(req.body.counterpartyId, 'counterpartyId');
      if (requestedCounterpartyId !== counterpartyId) {
        throw new HttpError(
          400,
          direction === 'payable'
            ? 'counterpartyId must match the finance vendor linked to this staff profile.'
            : 'counterpartyId must match the finance client linked to this staff profile.',
        );
      }
    }
    const normalizedLines = normalizeBatchLines(req.body.lines);
    const normalizedReimbursement = normalizeReimbursementPayload(req.body.reimbursement);
    if (normalizedLines.length === 0 && !normalizedReimbursement) {
      throw new HttpError(400, 'Select at least one payout line or reimbursement.');
    }
    assertStaffPayoutDirectionDetails({
      direction,
      hasReimbursement: Boolean(normalizedReimbursement),
      hasAffiliatePayout: normalizedLines.some((line) => Boolean(line.affiliatePayout)),
    });
    assertUniqueStaffAffiliatePayoutClaims({
      staffUserId: staffProfileId,
      claims: normalizedLines
        .map((line) => line.affiliatePayout)
        .filter((claim): claim is NonNullable<typeof claim> => Boolean(claim)),
    });

    const accountIds = Array.from(
      new Set([
        ...normalizedLines.map((line) => line.accountId),
        ...(normalizedReimbursement ? [normalizedReimbursement.accountId] : []),
      ]),
    );
    const categoryIds = Array.from(
      new Set([
        ...normalizedLines.map((line) => line.categoryId),
        ...(normalizedReimbursement ? [normalizedReimbursement.categoryId] : []),
      ]),
    );
    const [accounts, categories] = await Promise.all([
      FinanceAccount.findAll({
        where: { id: { [Op.in]: accountIds } },
        attributes: ['id', 'currency', 'isActive'],
      }),
      FinanceCategory.findAll({
        where: { id: { [Op.in]: categoryIds } },
        attributes: ['id', 'kind', 'isActive'],
      }),
    ]);
    const financeSelections = validateStaffPayoutFinanceSelections({
      direction,
      lines: normalizedLines,
      reimbursement: normalizedReimbursement,
      accounts,
      categories,
      baseCurrency: resolveDefaultCurrency(),
    });
    const lines = normalizedLines.map((line, index) => ({
      ...line,
      currency: financeSelections.lineCurrencies[index],
    }));

    let reimbursement = normalizedReimbursement;
    if (normalizedReimbursement) {
      const sourceRows = await FinanceTransaction.findAll({
        where: { id: { [Op.in]: normalizedReimbursement.transactionIds } },
        attributes: [
          'id',
          'kind',
          'status',
          'date',
          'currency',
          'amountMinor',
          'baseAmountMinor',
          'counterpartyId',
          'meta',
        ],
      });
      const amountMinor = deriveStaffPayoutReimbursementAmount({
        requestedTransactionIds: normalizedReimbursement.transactionIds,
        requestedAmountMinor: normalizedReimbursement.amountMinor,
        sourceRows,
        staffUserId: staffProfileId,
        staffVendorId: Number(staffProfile.financeVendorId),
        rangeStart: rangeStart.format('YYYY-MM-DD'),
        rangeEnd: rangeEnd.format('YYYY-MM-DD'),
        baseCurrency: financeSelections.reimbursementCurrency ?? resolveDefaultCurrency(),
        requireAwaitingStatus: false,
      });
      reimbursement = { ...normalizedReimbursement, amountMinor };
    }
    const batchKeyParams: StaffPayoutBatchKeyParams = {
      staffProfileId,
      direction,
      counterpartyId,
      paidDate: payoutDate,
      rangeStart: rangeStart.format('YYYY-MM-DD'),
      rangeEnd: rangeEnd.format('YYYY-MM-DD'),
      lines,
      reimbursement,
    };
    const batchKey = buildStaffPayoutBatchKey(batchKeyParams);
    const legacyBatchKey = buildLegacyStaffPayoutBatchKey(batchKeyParams);

    const existing = await findExistingCompatibleStaffPayoutBatch({
      batchKey,
      legacyBatchKey,
      direction,
      counterpartyId,
      paidDate: payoutDate,
    });
    if (existing) {
      const storedBatchKey = getStoredStaffPayoutBatchKey(existing, batchKey);
      const receipts = await listActiveBatchReceipts(storedBatchKey);
      res.status(200).json({
        duplicated: true,
        batchKey: storedBatchKey,
        financeTransactionId: existing.id,
        receipts: serializeReceiptReferences(receipts),
      });
      return;
    }

    const batchResult = await sequelize.transaction(async (transaction) => {
      // Use the same affiliate/staff user lock as the direct Affiliates payout
      // flow. Any fresh affiliate-booking eligibility read below therefore
      // happens after competing Pays/Affiliates payouts have committed.
      const lockedStaffUser = await User.findByPk(staffProfileId, {
        attributes: ['id'],
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!lockedStaffUser) {
        throw new HttpError(404, 'Staff user not found.');
      }

      const lockedStaffProfile = await StaffProfile.findOne({
        where: { userId: staffProfileId },
        attributes: ['userId', 'financeVendorId', 'financeClientId'],
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      const lockedCounterpartyId = direction === 'payable'
        ? Number(lockedStaffProfile?.financeVendorId)
        : Number(lockedStaffProfile?.financeClientId);
      if (!lockedStaffProfile || lockedCounterpartyId !== counterpartyId) {
        throw new HttpError(409, 'The staff finance link changed. Refresh Pays and try again.');
      }

      const duplicateInsideTx = await findExistingCompatibleStaffPayoutBatch({
        batchKey,
        legacyBatchKey,
        direction,
        counterpartyId,
        paidDate: payoutDate,
        transaction,
      });
      if (duplicateInsideTx) {
        const receipts = await listActiveBatchReceipts(
          getStoredStaffPayoutBatchKey(duplicateInsideTx, batchKey),
          transaction,
        );
        return { duplicated: true as const, receipts };
      }

      const [lockedAccounts, lockedCategories] = await Promise.all([
        FinanceAccount.findAll({
          where: { id: { [Op.in]: accountIds } },
          attributes: ['id', 'currency', 'isActive'],
          transaction,
          lock: transaction.LOCK.UPDATE,
        }),
        FinanceCategory.findAll({
          where: { id: { [Op.in]: categoryIds } },
          attributes: ['id', 'kind', 'isActive'],
          transaction,
          lock: transaction.LOCK.UPDATE,
        }),
      ]);
      validateStaffPayoutFinanceSelections({
        direction,
        lines,
        reimbursement,
        accounts: lockedAccounts,
        categories: lockedCategories,
        baseCurrency: resolveDefaultCurrency(),
      });

      if (reimbursement) {
        const lockedSourceRows = await FinanceTransaction.findAll({
          where: { id: { [Op.in]: reimbursement.transactionIds } },
          attributes: [
            'id',
            'kind',
            'status',
            'date',
            'currency',
            'amountMinor',
            'baseAmountMinor',
            'counterpartyId',
            'meta',
          ],
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
        deriveStaffPayoutReimbursementAmount({
          requestedTransactionIds: reimbursement.transactionIds,
          requestedAmountMinor: reimbursement.amountMinor,
          sourceRows: lockedSourceRows,
          staffUserId: staffProfileId,
          staffVendorId: Number(lockedStaffProfile.financeVendorId),
          rangeStart: rangeStart.format('YYYY-MM-DD'),
          rangeEnd: rangeEnd.format('YYYY-MM-DD'),
          baseCurrency: financeSelections.reimbursementCurrency ?? resolveDefaultCurrency(),
        });
      }

      const receiptItems: StaffPayoutReceiptSourceItem[] = [];
      const addReceiptItem = (item: StaffPayoutReceiptSourceItem) => {
        receiptItems.push(item);
      };

      for (const line of lines) {
        const currency = normalizeCurrencyCode(line.currency);
        const financeTransaction = await createFinanceTransaction(
          {
            kind: direction === 'payable' ? 'expense' : 'income',
            date: payoutDate,
            accountId: line.accountId,
            currency,
            amountMinor: line.amountMinor,
            categoryId: line.categoryId,
            counterpartyType: direction === 'payable' ? 'vendor' : 'client',
            counterpartyId,
            status: 'paid',
            description: line.description ?? `${line.label} payout`,
            meta: {
              source: 'staff-payments',
              rangeStart: rangeStart.format('YYYY-MM-DD'),
              rangeEnd: rangeEnd.format('YYYY-MM-DD'),
              staffUserId: staffProfileId,
              lineLabel: line.label,
              ...(line.componentId ? { componentId: line.componentId } : {}),
              payoutBatchKey: batchKey,
              ...(line.affiliatePayout
                ? {
                    affiliatePayout: true,
                    affiliateUserId: line.affiliatePayout.affiliateUserId,
                    bookingIds: line.affiliatePayout.bookingIds,
                    bookingCount: line.affiliatePayout.bookingIds.length,
                  }
                : {}),
            },
          },
          actorId,
          { transaction, allowStaffPayoutReceiptFlow: true },
        );

        const collectionLog = await createPayoutCollectionLog(
          {
            staffProfileId,
            direction,
            currency,
            amountMinor: line.amountMinor,
            rangeStart: rangeStart.format('YYYY-MM-DD'),
            rangeEnd: rangeEnd.format('YYYY-MM-DD'),
            financeTransactionId: financeTransaction.id,
            note: line.description,
            actorId,
          },
          transaction,
        );

        if (direction === 'payable') {
          addReceiptItem({
            collectionLogId: collectionLog.id,
            financeTransactionId: financeTransaction.id,
            label: line.label,
            amountMinor: line.amountMinor,
            currencyCode: currency,
          });
        }

        if (line.affiliatePayout) {
          await createAffiliatePayoutLogForStaffLine(
            {
              staffProfileId,
              rangeStart: rangeStart.format('YYYY-MM-DD'),
              rangeEnd: rangeEnd.format('YYYY-MM-DD'),
              paidDate: payoutDate,
              amountMinor: line.amountMinor,
              currency,
              financeTransactionId: financeTransaction.id,
              note: line.description,
              actorId,
              affiliatePayout: line.affiliatePayout,
            },
            transaction,
          );
        }
      }

      if (reimbursement && reimbursement.amountMinor > 0) {
        const currency = financeSelections.reimbursementCurrency ?? resolveDefaultCurrency();
        const reimbursementTransaction = await createFinanceTransaction(
          {
            kind: 'expense',
            date: payoutDate,
            accountId: reimbursement.accountId,
            currency,
            amountMinor: reimbursement.amountMinor,
            categoryId: reimbursement.categoryId,
            counterpartyType: 'vendor',
            counterpartyId,
            status: 'paid',
            description: reimbursement.description ?? 'Staff reimbursements payout',
            meta: {
              source: 'staff-payments',
              rangeStart: rangeStart.format('YYYY-MM-DD'),
              rangeEnd: rangeEnd.format('YYYY-MM-DD'),
              staffUserId: staffProfileId,
              lineLabel: 'Reimbursements',
              payoutBatchKey: batchKey,
            },
          },
          actorId,
          { transaction, allowStaffPayoutReceiptFlow: true },
        );

        const reimbursementCollectionLog = await createPayoutCollectionLog(
          {
            staffProfileId,
            direction: 'payable',
            currency,
            amountMinor: reimbursement.amountMinor,
            rangeStart: rangeStart.format('YYYY-MM-DD'),
            rangeEnd: rangeEnd.format('YYYY-MM-DD'),
            financeTransactionId: reimbursementTransaction.id,
            note: reimbursement.description,
            actorId,
          },
          transaction,
        );

        addReceiptItem({
          collectionLogId: reimbursementCollectionLog.id,
          financeTransactionId: reimbursementTransaction.id,
          label: 'Reimbursements',
          amountMinor: reimbursement.amountMinor,
          currencyCode: currency,
        });

        for (const transactionId of reimbursement.transactionIds) {
          await updateFinanceTransaction(
            transactionId,
            { status: 'reimbursed' },
            actorId,
            { transaction, allowStaffPayoutReceiptFlow: true },
          );
        }
      }

      const receipts: StaffPayoutReceipt[] = [];
      for (const currencyGroup of groupStaffPayoutReceiptItemsByCurrency(receiptItems)) {
        receipts.push(
          await createStaffPayoutReceipt({
            staffUserId: staffProfileId,
            payoutBatchKey: `${batchKey}:${currencyGroup.currency}`,
            rangeStart: rangeStart.format('YYYY-MM-DD'),
            rangeEnd: rangeEnd.format('YYYY-MM-DD'),
            paidDate: payoutDate,
            createdBy: actorId,
            items: currencyGroup.items,
            transaction,
          }),
        );
      }

      return { duplicated: false as const, receipts };
    });

    res.status(batchResult.duplicated ? 200 : 201).json({
      duplicated: batchResult.duplicated,
      batchKey,
      lineCount: lines.length,
      reimbursementIncluded: Boolean(reimbursement && reimbursement.amountMinor > 0),
      receipts: serializeReceiptReferences(batchResult.receipts),
    });
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json([{ message: error.message }]);
      return;
    }
    res.status(500).json([{ message: 'Failed to record payout batch' }]);
  }
};

export const deleteStaffPayoutEntries = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const actorId = requireActorId(req);
    const staffProfileId = parsePositiveInteger(req.body.staffProfileId, 'staffProfileId');
    const rangeStartRaw = typeof req.body.rangeStart === 'string' ? req.body.rangeStart : '';
    const rangeEndRaw = typeof req.body.rangeEnd === 'string' ? req.body.rangeEnd : '';
    const { rangeStart, rangeEnd } = ensureCanonicalMonthRange(rangeStartRaw, rangeEndRaw);
    const entryIds = parseEntryIds(req.body.entryIds);

    const deletionResult = await sequelize.transaction(async (transaction) => {
      // Every deletion for a staff member takes the same row lock before it reads
      // payout logs or receipt links. This matters when two requests remove
      // different entries from one receipt: the second request must see the
      // replacement receipt created by the first request, not the cancelled one
      // it was linked to before waiting for a lock.
      const lockedStaffProfile = await StaffProfile.findOne({
        where: { userId: staffProfileId },
        attributes: ['userId'],
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!lockedStaffProfile) {
        throw new HttpError(404, 'Staff profile not found.');
      }

      const logs = await StaffPayoutCollectionLog.findAll({
        where: {
          id: { [Op.in]: entryIds },
          staffProfileId,
          direction: 'payable',
          rangeStart: rangeStart.format('YYYY-MM-DD'),
          rangeEnd: rangeEnd.format('YYYY-MM-DD'),
        },
        order: [['id', 'ASC']],
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (logs.length !== entryIds.length) {
        throw new HttpError(404, 'Some selected paid entries could not be found for this staff member and month.');
      }

      const financeTransactionIds = Array.from(
        new Set(
          logs
            .map((log) => log.financeTransactionId)
            .filter((value): value is number => Number.isInteger(value) && Number(value) > 0),
        ),
      );

      const financeTransactions =
        financeTransactionIds.length > 0
          ? await FinanceTransaction.findAll({
              attributes: ['id', 'description', 'meta'],
              where: { id: { [Op.in]: financeTransactionIds } },
              transaction,
              lock: transaction.LOCK.UPDATE,
            })
          : [];
      const financeTransactionsById = new Map(
        financeTransactions.map((financeTransaction) => [financeTransaction.id, financeTransaction]),
      );

      const reimbursementEntries = logs.filter((log) => {
        const linkedTransaction =
          log.financeTransactionId && Number.isInteger(log.financeTransactionId)
            ? financeTransactionsById.get(log.financeTransactionId)
            : null;
        const meta =
          linkedTransaction?.meta && typeof linkedTransaction.meta === 'object'
            ? (linkedTransaction.meta as Record<string, unknown>)
            : null;
        return looksLikeReimbursementEntry({
          meta,
          description: linkedTransaction?.description ?? null,
          note: log.note ?? null,
        });
      });

      if (reimbursementEntries.length > 0) {
        throw new HttpError(400, 'Reimbursement payouts cannot be deleted from this action.');
      }

      const selectedReceiptItems = await StaffPayoutReceiptItem.findAll({
        where: { collectionLogId: { [Op.in]: entryIds } },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      const affectedReceiptIds = Array.from(new Set(selectedReceiptItems.map((item) => item.receiptId)));
      if (affectedReceiptIds.length > 0) {
        const affectedReceipts = await StaffPayoutReceipt.findAll({
          where: { id: { [Op.in]: affectedReceiptIds } },
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
        const allReceiptItems = await StaffPayoutReceiptItem.findAll({
          where: { receiptId: { [Op.in]: affectedReceiptIds } },
          transaction,
          order: [['id', 'ASC']],
          lock: transaction.LOCK.UPDATE,
        });
        const selectedEntryIds = new Set(entryIds);
        for (const receipt of affectedReceipts.filter((entry) => entry.status === 'pending' || entry.status === 'completed')) {
          const receiptItems = allReceiptItems.filter((item) => item.receiptId === receipt.id);
          const remainingItems = buildStaffPayoutReceiptReissueItems(receiptItems, selectedEntryIds);
          await receipt.update(
            {
              status: 'cancelled',
              cancelledAt: new Date(),
              cancelledBy: actorId,
              cancelReason: 'The recorded payout was edited or removed after the receipt request was created.',
            },
            { transaction },
          );
          if (receipt.requiredActionId) {
            await RequiredAction.update(
              { status: false, updatedBy: actorId },
              { where: { id: receipt.requiredActionId }, transaction },
            );
          }
          await StaffPayoutReceiptItem.update(
            { collectionLogId: null, financeTransactionId: null },
            { where: { receiptId: receipt.id }, transaction },
          );

          if (remainingItems.length > 0) {
            await createStaffPayoutReceipt({
              staffUserId: receipt.staffUserId,
              payoutBatchKey: receipt.payoutBatchKey,
              rangeStart: receipt.rangeStart,
              rangeEnd: receipt.rangeEnd,
              paidDate: receipt.paidDate,
              createdBy: receipt.createdBy,
              items: remainingItems,
              transaction,
            });
          }
        }
      }

      if (financeTransactionIds.length > 0) {
        const reusedTransactionCount = await StaffPayoutCollectionLog.count({
          where: {
            financeTransactionId: { [Op.in]: financeTransactionIds },
            id: { [Op.notIn]: entryIds },
          },
          transaction,
        });

        if (reusedTransactionCount > 0) {
          throw new HttpError(400, 'One or more finance transactions are linked to other payout logs.');
        }
      }

      await StaffPayoutCollectionLog.destroy({
        where: { id: { [Op.in]: entryIds } },
        transaction,
      });

      if (financeTransactionIds.length > 0) {
        await AffiliatePayoutLog.destroy({
          where: { financeTransactionId: { [Op.in]: financeTransactionIds } },
          transaction,
        });

        await FinanceTransaction.destroy({
          where: { id: { [Op.in]: financeTransactionIds } },
          transaction,
        });
      }

      return { financeTransactionIds };
    });

    res.status(200).json({
      deletedEntryIds: entryIds,
      deletedCount: entryIds.length,
      deletedFinanceTransactionIds: deletionResult.financeTransactionIds,
    });
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json([{ message: error.message }]);
      return;
    }
    res.status(500).json([{ message: 'Failed to delete paid entries' }]);
  }
};
