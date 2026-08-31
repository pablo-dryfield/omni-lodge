import crypto from 'crypto';
import type { Response } from 'express';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { Op, col, fn, where, type Transaction as SequelizeTransaction } from 'sequelize';
import sequelize from '../config/database.js';
import StaffPayoutCollectionLog from '../models/StaffPayoutCollectionLog.js';
import StaffPayoutLedger, {
  type StaffPayoutSettlementSnapshotSource,
} from '../models/StaffPayoutLedger.js';
import StaffProfile from '../models/StaffProfile.js';
import StaffProfileTypePeriod from '../models/StaffProfileTypePeriod.js';
import AffiliatePayoutLog from '../models/AffiliatePayoutLog.js';
import StaffPayoutReceipt from '../models/StaffPayoutReceipt.js';
import StaffPayoutReceiptItem from '../models/StaffPayoutReceiptItem.js';
import RequiredAction from '../models/RequiredAction.js';
import User from '../models/User.js';
import CompensationComponent from '../models/CompensationComponent.js';
import FinanceAccount from '../finance/models/FinanceAccount.js';
import FinanceCategory from '../finance/models/FinanceCategory.js';
import FinanceTransaction from '../finance/models/FinanceTransaction.js';
import VolunteerFund from '../finance/models/VolunteerFund.js';
import VolunteerFundEntry from '../finance/models/VolunteerFundEntry.js';
import { createFinanceTransaction, updateFinanceTransaction } from '../finance/services/transactionService.js';
import { createVolunteerFundAllocationTransfer } from '../finance/services/volunteerFundAllocationFinanceService.js';
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
  assertStaffPayoutSettlementIntentDirections,
  assertUniqueStaffAffiliatePayoutClaims,
  deriveStaffPayoutReimbursementAmount,
  parseStrictStaffPayoutDate,
  validateStaffPayoutFinanceSelections,
} from '../services/staffPayoutBatchValidation.js';
import { loadCompensationSettlementRouter } from '../services/compensationSettlementRoutingService.js';
import {
  isSegmentedCompensationSettlementIntent,
  verifyCompensationSettlementIntent,
  type CompensationSettlementIntentPayload,
} from '../services/compensationSettlementIntentService.js';
import { reconcilePersistedStaffPayoutLedgers } from '../services/staffPayoutLedgerReconciliationService.js';
import {
  assertStaffPayoutSettlementRequestBinding,
  createStaffPayoutSettlementRequestBinding,
} from '../services/staffPayoutSettlementRequestService.js';

dayjs.extend(utc);
dayjs.extend(timezone);

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
  sourceKey?: unknown;
  amount?: unknown;
  categoryId?: unknown;
  accountId?: unknown;
  currency?: unknown;
  description?: unknown;
  affiliatePayout?: unknown;
  settlementIntent?: unknown;
};

type StaffPayoutBatchReimbursementEntry = {
  transactionId?: unknown;
  amount?: unknown;
};

type NormalizedStaffPayoutBatchLine = {
  label: string;
  componentId: number | null;
  sourceKey: string;
  amountMinor: number;
  categoryId: number;
  accountId: number;
  currency: string | null;
  description: string | null;
  affiliatePayout: {
    affiliateUserId: number;
    bookingIds: number[];
  } | null;
  settlementIntent: string | null;
  verifiedIntent: CompensationSettlementIntentPayload | null;
};

type StaffPayoutFundAllocationPayload = {
  label?: unknown;
  componentId?: unknown;
  sourceKey?: unknown;
  amount?: unknown;
  fundId?: unknown;
  description?: unknown;
  settlementIntent?: unknown;
};

type NormalizedStaffPayoutFundAllocation = {
  label: string;
  componentId: number | null;
  sourceKey: string;
  amountMinor: number;
  fundId: number;
  description: string | null;
  settlementIntent: string;
  verifiedIntent: CompensationSettlementIntentPayload;
};

type NormalizedStaffPayoutBatchReimbursement = {
  amountMinor: number;
  accountId: number;
  categoryId: number;
  transactionIds: number[];
  description: string | null;
};

const assertSettlementIntentsMatchLedgerSnapshot = (params: {
  ledger: StaffPayoutLedger;
  lines: NormalizedStaffPayoutBatchLine[];
  fundAllocations: NormalizedStaffPayoutFundAllocation[];
}): void => {
  const intents = [
    ...params.lines
      .map((line) => line.verifiedIntent)
      .filter((intent): intent is CompensationSettlementIntentPayload => Boolean(intent)),
    ...params.fundAllocations.map((line) => line.verifiedIntent),
  ];
  if (intents.length === 0) {
    return;
  }
  const snapshot = params.ledger.settlementSnapshot;
  if (!snapshot || (snapshot.version !== 1 && snapshot.version !== 2) || !Array.isArray(snapshot.sources)) {
    throw new HttpError(
      409,
      'The payout source snapshot is not ready. Refresh Pays before processing compensation.',
    );
  }
  for (const intent of intents) {
    const segmentedIntent = isSegmentedCompensationSettlementIntent(intent);
    if (segmentedIntent && snapshot.version !== 2) {
      throw new HttpError(
        409,
        'The segmented payout source snapshot is not ready. Refresh Pays before processing compensation.',
      );
    }
    const candidates = snapshot.sources.filter((source) => (
      source.sourceKey === intent.sourceKey
      && source.componentId === intent.componentId
      && (
        segmentedIntent
          ? 'segmentKey' in source && source.segmentKey === intent.segmentKey
          : snapshot.version === 1
      )
    ));
    const source: StaffPayoutSettlementSnapshotSource | undefined = candidates[0];
    if (
      candidates.length !== 1
      || !source
      || source.category !== intent.category
      || Number(source.grossAmountMinor) !== intent.grossAmountMinor
      || source.destination !== intent.destination
      || source.fundId !== intent.fundId
      || Number(source.ruleId) !== intent.ruleId
      || source.currency.trim().toUpperCase() !== intent.currency
      || (
        segmentedIntent
        && (
          source.segmentKey !== intent.segmentKey
          || source.earningStart !== intent.earningStart
          || source.earningEnd !== intent.earningEnd
          || Number(source.staffTypePeriodId) !== intent.staffTypePeriodId
          || source.staffType !== intent.staffType
          || source.legacyExtrapolation !== intent.legacyExtrapolation
        )
      )
    ) {
      throw new HttpError(
        409,
        'The saved payout source breakdown changed. Refresh Pays or reconcile the historical payout ledger.',
      );
    }
  }
};

const parseOptionalString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseSettlementRequestId = (value: unknown): string => {
  const requestId = parseOptionalString(value);
  if (!requestId || !/^[A-Za-z0-9_-]{16,128}$/.test(requestId)) {
    throw new HttpError(400, 'requestId is required and must be a valid settlement request identifier.');
  }
  return requestId;
};

const normalizeSettlementSourceKey = (value: unknown, fallback = 'manual_adjustment'): string => {
  const source = typeof value === 'string' ? value : fallback;
  const normalized = source
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || fallback;
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

const getSettlementIntentSegmentKey = (
  intent: CompensationSettlementIntentPayload | null | undefined,
): string | null => (
  intent && isSegmentedCompensationSettlementIntent(intent)
    ? intent.segmentKey
    : null
);

const buildCalculatedSettlementIdentity = (params: {
  sourceKey: string;
  componentId: number | null;
  intent?: CompensationSettlementIntentPayload | null;
}): string => [
  params.sourceKey,
  params.componentId ?? 0,
  getSettlementIntentSegmentKey(params.intent) ?? 'legacy',
].join(':');

const assertStaffPayoutLedgerCurrencies = (
  direction: 'receivable' | 'payable',
  currencies: string[],
): void => {
  if (direction !== 'payable') {
    return;
  }
  const ledgerCurrency = resolveDefaultCurrency();
  if (currencies.some((currency) => currency.trim().toUpperCase() !== ledgerCurrency)) {
    throw new HttpError(
      400,
      `Staff payments must use the payout ledger currency (${ledgerCurrency}).`,
    );
  }
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
      const componentId = parseOptionalPositiveInteger(
        line.componentId,
        `lines[${index}].componentId`,
      );
      if (affiliatePayout && componentId) {
        throw new HttpError(
          400,
          `lines[${index}] cannot combine a compensation component with Promotion Sales evidence.`,
        );
      }
      const requestedSourceKey = normalizeSettlementSourceKey(line.sourceKey);
      const sourceKey = affiliatePayout
        ? 'promotion_sales'
        : componentId
          ? 'compensation_component'
          : requestedSourceKey === 'carry_forward_personal'
            ? 'carry_forward_personal'
            : requestedSourceKey === 'guide_commission'
              ? 'guide_commission'
              : 'manual_adjustment';
      const settlementIntent = parseOptionalString(line.settlementIntent);
      const requiresCalculatedIntent = Boolean(componentId || affiliatePayout || sourceKey === 'guide_commission');
      if (requiresCalculatedIntent && !settlementIntent) {
        throw new HttpError(
          400,
          `lines[${index}].settlementIntent is required for calculated compensation. Refresh Pays and try again.`,
        );
      }
      const verifiedIntent = settlementIntent
        ? verifyCompensationSettlementIntent(settlementIntent, { allowExpired: true })
        : null;
      return {
        label: parseOptionalString(line.label) ?? `Line ${index + 1}`,
        componentId,
        // Exceptional direct-to-staff sources are established by server-
        // validated evidence, never by a client-provided label. Component
        // routing is resolved from the component itself; every other generic
        // line remains a manual adjustment.
        sourceKey,
        amountMinor,
        categoryId,
        accountId,
        currency: parseOptionalString(line.currency)?.toUpperCase() ?? null,
        description: parseOptionalString(line.description),
        affiliatePayout,
        settlementIntent,
        verifiedIntent,
      };
    })
    .filter((line) => line.amountMinor > 0);

  return normalized;
};

const normalizeFundAllocations = (rawLines: unknown): NormalizedStaffPayoutFundAllocation[] => {
  if (rawLines === null || rawLines === undefined) {
    return [];
  }
  if (!Array.isArray(rawLines)) {
    throw new HttpError(400, 'fundAllocations must be an array.');
  }
  return rawLines
    .map((entry, index) => {
      if (!entry || typeof entry !== 'object') {
        throw new HttpError(400, `fundAllocations[${index}] is invalid.`);
      }
      const line = entry as StaffPayoutFundAllocationPayload;
      const settlementIntent = parseOptionalString(line.settlementIntent);
      if (!settlementIntent) {
        throw new HttpError(
          400,
          `fundAllocations[${index}].settlementIntent is required. Refresh Pays and try again.`,
        );
      }
      const verifiedIntent = verifyCompensationSettlementIntent(settlementIntent, {
        allowExpired: true,
      });
      if (
        verifiedIntent.destination !== 'volunteer_fund'
        || !verifiedIntent.fundId
        || verifiedIntent.outstandingAmountMinor <= 0
      ) {
        throw new HttpError(400, `fundAllocations[${index}] does not contain an allocatable intent.`);
      }
      const requestedAmountMinor = parseAmountToMinor(line.amount);
      if (requestedAmountMinor !== verifiedIntent.outstandingAmountMinor) {
        throw new HttpError(
          409,
          `fundAllocations[${index}] amount changed. Refresh Pays and try again.`,
        );
      }
      const requestedFundId = parsePositiveInteger(line.fundId, `fundAllocations[${index}].fundId`);
      if (requestedFundId !== verifiedIntent.fundId) {
        throw new HttpError(409, `fundAllocations[${index}] fund changed. Refresh Pays and try again.`);
      }
      const requestedComponentId = parseOptionalPositiveInteger(
        line.componentId,
        `fundAllocations[${index}].componentId`,
      );
      if (requestedComponentId !== verifiedIntent.componentId) {
        throw new HttpError(
          409,
          `fundAllocations[${index}] component changed. Refresh Pays and try again.`,
        );
      }
      return {
        label: parseOptionalString(line.label) ?? `Fund allocation ${index + 1}`,
        componentId: verifiedIntent.componentId,
        sourceKey: verifiedIntent.sourceKey,
        amountMinor: verifiedIntent.outstandingAmountMinor,
        fundId: verifiedIntent.fundId,
        description: parseOptionalString(line.description),
        settlementIntent,
        verifiedIntent,
      };
    })
    .filter((line) => line.amountMinor > 0)
    .reduce<NormalizedStaffPayoutFundAllocation[]>((unique, line) => {
      const duplicate = unique.some((existing) => (
        existing.fundId === line.fundId
        && existing.sourceKey === line.sourceKey
        && existing.componentId === line.componentId
        && getSettlementIntentSegmentKey(existing.verifiedIntent)
          === getSettlementIntentSegmentKey(line.verifiedIntent)
      ));
      if (duplicate) {
        throw new HttpError(400, `Duplicate Volunteer Fund source: ${line.label}.`);
      }
      unique.push(line);
      return unique;
    }, []);
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

const getNetFundAllocationForSource = async (params: {
  staffUserId: number;
  rangeStart: string;
  rangeEnd: string;
  sourceKey: string;
  componentId: number | null;
  segmentKey?: string | null;
  transaction?: SequelizeTransaction;
}): Promise<number> => {
  const allocations = await VolunteerFundEntry.findAll({
    attributes: ['id', 'amountMinor'],
    where: {
      entryType: 'allocation',
      attributedStaffUserId: params.staffUserId,
      periodStart: params.rangeStart,
      periodEnd: params.rangeEnd,
      sourceKind: params.sourceKey,
      compensationComponentId: params.componentId,
      ...(params.segmentKey ? { sourceReference: params.segmentKey } : {}),
    },
    transaction: params.transaction,
    ...(params.transaction ? { lock: params.transaction.LOCK.UPDATE } : {}),
  });
  const allocationIds = allocations.map((entry) => entry.id);
  const reversals = allocationIds.length > 0
    ? await VolunteerFundEntry.findAll({
        attributes: ['amountMinor'],
        where: {
          entryType: 'reversal',
          reversalOfEntryId: { [Op.in]: allocationIds },
        },
        transaction: params.transaction,
        ...(params.transaction ? { lock: params.transaction.LOCK.UPDATE } : {}),
      })
    : [];
  return [...allocations, ...reversals].reduce(
    (sum, entry) => sum + Number(entry.amountMinor ?? 0),
    0,
  );
};

const getCarryForwardPersonalAvailableMinor = async (params: {
  staffUserId: number;
  rangeStart: string;
  rangeEnd: string;
  transaction?: SequelizeTransaction;
}): Promise<number> => {
  const previousLedger = await StaffPayoutLedger.findOne({
    where: {
      staffUserId: params.staffUserId,
      rangeEnd: { [Op.lt]: params.rangeStart },
    },
    attributes: ['closingBalanceMinor'],
    order: [['rangeEnd', 'DESC'], ['id', 'DESC']],
    transaction: params.transaction,
    ...(params.transaction ? { lock: params.transaction.LOCK.UPDATE } : {}),
  });
  const openingMinor = Math.max(Number(previousLedger?.closingBalanceMinor ?? 0), 0);
  if (openingMinor <= 0) {
    return 0;
  }
  const recordedCarryRows = await FinanceTransaction.findAll({
    attributes: ['amountMinor'],
    where: {
      kind: 'expense',
      status: 'paid',
      [Op.and]: [
        where(fn('jsonb_extract_path_text', col('meta'), 'source'), 'staff-payments'),
        where(fn('jsonb_extract_path_text', col('meta'), 'staffUserId'), String(params.staffUserId)),
        where(fn('jsonb_extract_path_text', col('meta'), 'rangeStart'), params.rangeStart),
        where(fn('jsonb_extract_path_text', col('meta'), 'rangeEnd'), params.rangeEnd),
        where(fn('jsonb_extract_path_text', col('meta'), 'sourceKey'), 'carry_forward_personal'),
      ],
    },
    transaction: params.transaction,
    ...(params.transaction ? { lock: params.transaction.LOCK.UPDATE } : {}),
  });
  const recordedMinor = recordedCarryRows.reduce(
    (sum, row) => sum + Number(row.amountMinor ?? 0),
    0,
  );
  return Math.max(openingMinor - recordedMinor, 0);
};

const getRecordedPersonalSettlementMinor = async (params: {
  staffUserId: number;
  rangeStart: string;
  rangeEnd: string;
  sourceKey: string;
  componentId: number | null;
  segmentKey?: string | null;
  transaction?: SequelizeTransaction;
}): Promise<number> => {
  const sourceIdentity = params.componentId
    ? where(
        fn('jsonb_extract_path_text', col('meta'), 'componentId'),
        String(params.componentId),
      )
    : where(fn('jsonb_extract_path_text', col('meta'), 'sourceKey'), params.sourceKey);
  const rows = await FinanceTransaction.findAll({
    attributes: ['amountMinor'],
    where: {
      kind: 'expense',
      status: 'paid',
      [Op.and]: [
        where(fn('jsonb_extract_path_text', col('meta'), 'source'), 'staff-payments'),
        where(fn('jsonb_extract_path_text', col('meta'), 'staffUserId'), String(params.staffUserId)),
        where(fn('jsonb_extract_path_text', col('meta'), 'rangeStart'), params.rangeStart),
        where(fn('jsonb_extract_path_text', col('meta'), 'rangeEnd'), params.rangeEnd),
        sourceIdentity,
        ...(params.segmentKey
          ? [where(fn('jsonb_extract_path_text', col('meta'), 'segmentKey'), params.segmentKey)]
          : []),
      ],
    },
    transaction: params.transaction,
    ...(params.transaction ? { lock: params.transaction.LOCK.UPDATE } : {}),
  });
  return rows.reduce((sum, row) => sum + Number(row.amountMinor ?? 0), 0);
};

const validateBatchSettlementRouting = async (params: {
  staffUserId: number;
  staffType: string | null;
  direction: 'receivable' | 'payable';
  effectiveDate: string;
  rangeStart: string;
  rangeEnd: string;
  lines: NormalizedStaffPayoutBatchLine[];
  fundAllocations: NormalizedStaffPayoutFundAllocation[];
  reimbursement: NormalizedStaffPayoutBatchReimbursement | null;
  transaction?: SequelizeTransaction;
}): Promise<Map<number, VolunteerFund>> => {
  const settlementIntents = [
    ...params.lines.map((line) => line.verifiedIntent),
    ...params.fundAllocations.map((line) => line.verifiedIntent),
  ].filter((intent): intent is CompensationSettlementIntentPayload => Boolean(intent));
  assertStaffPayoutSettlementIntentDirections({
    direction: params.direction,
    intents: settlementIntents,
  });
  const componentIds = Array.from(
    new Set(
      [...params.lines, ...params.fundAllocations]
        .map((line) => line.componentId)
        .filter((id): id is number => Boolean(id)),
    ),
  );
  const fundIds = Array.from(new Set(params.fundAllocations.map((line) => line.fundId)));
  const segmentedIntents = settlementIntents.filter(isSegmentedCompensationSettlementIntent);
  const staffTypePeriodIds = Array.from(new Set(
    segmentedIntents.map((intent) => intent.staffTypePeriodId),
  ));
  const [components, funds, settlementRouter, staffTypePeriods] = await Promise.all([
    componentIds.length > 0
      ? CompensationComponent.findAll({
          where: { id: { [Op.in]: componentIds } },
          attributes: ['id', 'category', 'isActive'],
          transaction: params.transaction,
          ...(params.transaction ? { lock: params.transaction.LOCK.UPDATE } : {}),
        })
      : Promise.resolve([]),
    fundIds.length > 0
      ? VolunteerFund.findAll({
          where: { id: { [Op.in]: fundIds } },
          attributes: [
            'id',
            'name',
            'currency',
            'isActive',
            'linkedAccountId',
            'fundingSourceAccountId',
          ],
          transaction: params.transaction,
          ...(params.transaction ? { lock: params.transaction.LOCK.UPDATE } : {}),
        })
      : Promise.resolve([]),
    loadCompensationSettlementRouter({
      effectiveDate: params.effectiveDate,
      transaction: params.transaction,
    }),
    staffTypePeriodIds.length > 0
      ? StaffProfileTypePeriod.findAll({
          where: { id: { [Op.in]: staffTypePeriodIds } },
          attributes: [
            'id',
            'userId',
            'staffType',
            'effectiveStart',
            'effectiveEnd',
            'metadata',
          ],
          transaction: params.transaction,
          ...(params.transaction ? { lock: params.transaction.LOCK.SHARE } : {}),
        })
      : Promise.resolve([]),
  ]);
  const componentById = new Map(components.map((component) => [component.id, component] as const));
  const fundById = new Map(funds.map((fund) => [fund.id, fund] as const));
  const staffTypePeriodById = new Map(
    staffTypePeriods.map((period) => [Number(period.id), period] as const),
  );

  if (componentById.size !== componentIds.length) {
    throw new HttpError(409, 'One or more compensation components no longer exist. Refresh Pays and try again.');
  }
  for (const fundId of fundIds) {
    const fund = fundById.get(fundId);
    if (!fund || !fund.isActive) {
      throw new HttpError(409, 'The selected Volunteer Fund is inactive or unavailable.');
    }
    if (fund.currency.trim().toUpperCase() !== resolveDefaultCurrency()) {
      throw new HttpError(
        409,
        `The ${fund.name} currency must match the compensation currency (${resolveDefaultCurrency()}).`,
      );
    }
  }

  for (const intent of segmentedIntents) {
    const period = staffTypePeriodById.get(intent.staffTypePeriodId);
    const legacyExtrapolation = period?.metadata?.legacyExtrapolation === true;
    if (
      !period
      || period.userId !== params.staffUserId
      || period.staffType !== intent.staffType
      || period.effectiveStart > intent.earningStart
      || (period.effectiveEnd !== null && period.effectiveEnd < intent.earningEnd)
      || legacyExtrapolation !== intent.legacyExtrapolation
    ) {
      throw new HttpError(
        409,
        'The staff-type history behind this settlement changed. Refresh Pays and try again.',
      );
    }
  }

  const routerByDate = new Map<string, typeof settlementRouter>([
    [params.effectiveDate, settlementRouter],
  ]);
  const getSettlementRouterForDate = async (effectiveDate: string) => {
    const cached = routerByDate.get(effectiveDate);
    if (cached) {
      return cached;
    }
    const router = await loadCompensationSettlementRouter({
      effectiveDate,
      transaction: params.transaction,
    });
    routerByDate.set(effectiveDate, router);
    return router;
  };

  const resolveLineRoute = async (line: {
    componentId: number | null;
    sourceKey: string;
    affiliatePayout?: NormalizedStaffPayoutBatchLine['affiliatePayout'];
    verifiedIntent?: CompensationSettlementIntentPayload | null;
  }) => {
    const component = line.componentId ? componentById.get(line.componentId) : null;
    const segmentedIntent = line.verifiedIntent
      && isSegmentedCompensationSettlementIntent(line.verifiedIntent)
      ? line.verifiedIntent
      : null;
    const router = await getSettlementRouterForDate(
      segmentedIntent?.earningStart ?? params.effectiveDate,
    );
    return router.resolve({
      userId: params.staffUserId,
      staffType: segmentedIntent?.staffType ?? params.staffType,
      ...(component
        ? { componentId: component.id, componentCategory: component.category }
        : {
            systemSource: line.affiliatePayout
              ? 'promotion_sales'
              : line.sourceKey,
          }),
    });
  };

  const carryForwardLines = params.lines.filter((line) => line.sourceKey === 'carry_forward_personal');
  if (carryForwardLines.length > 1) {
    throw new HttpError(400, 'Only one previous personal balance line is allowed.');
  }
  const calculatedIntentUsage = new Map<string, {
    token: string;
    intent: CompensationSettlementIntentPayload;
    amountMinor: number;
  }>();
  for (const line of params.lines) {
    const route = await resolveLineRoute(line);
    if (route.destination !== 'staff_vendor') {
      throw new HttpError(
        409,
        `${line.label} is configured for ${route.destination === 'volunteer_fund' ? 'the Volunteer Fund' : 'exclusion'}, not a staff payment. Refresh Pays and try again.`,
      );
    }
    if (line.verifiedIntent) {
      // An expired, correctly signed token may reach this point only so an
      // exact retry can be identified. Any new movement still requires a
      // freshly issued authorization.
      verifyCompensationSettlementIntent(line.settlementIntent as string);
      const intent = line.verifiedIntent;
      if (
        !line.settlementIntent
        || intent.userId !== params.staffUserId
        || intent.rangeStart !== params.rangeStart
        || intent.rangeEnd !== params.rangeEnd
        || intent.currency !== resolveDefaultCurrency()
        || intent.destination !== 'staff_vendor'
        || intent.fundId !== null
        || intent.sourceKey !== line.sourceKey
        || intent.componentId !== line.componentId
        || intent.ruleId !== route.ruleId
      ) {
        throw new HttpError(
          409,
          `${line.label} settlement authorization no longer matches the report. Refresh Pays and try again.`,
        );
      }
      if (line.currency && line.currency !== intent.currency) {
        throw new HttpError(
          400,
          `${line.label} must be paid from a ${intent.currency} account.`,
        );
      }
      const identity = buildCalculatedSettlementIdentity({
        sourceKey: line.sourceKey,
        componentId: line.componentId,
        intent,
      });
      const existingUsage = calculatedIntentUsage.get(identity);
      if (existingUsage && existingUsage.token !== line.settlementIntent) {
        throw new HttpError(
          409,
          `${line.label} uses conflicting settlement authorizations. Refresh Pays and try again.`,
        );
      }
      calculatedIntentUsage.set(identity, {
        token: line.settlementIntent,
        intent,
        amountMinor: (existingUsage?.amountMinor ?? 0) + line.amountMinor,
      });
    } else if (
      line.componentId
      || line.affiliatePayout
      || line.sourceKey === 'guide_commission'
    ) {
      throw new HttpError(
        400,
        `${line.label} is missing its calculated settlement authorization. Refresh Pays and try again.`,
      );
    }
    if (line.sourceKey === 'carry_forward_personal') {
      const availableMinor = await getCarryForwardPersonalAvailableMinor({
        staffUserId: params.staffUserId,
        rangeStart: params.rangeStart,
        rangeEnd: params.rangeEnd,
        transaction: params.transaction,
      });
      if (line.amountMinor > availableMinor) {
        throw new HttpError(
          409,
          `${line.label} exceeds the remaining previous personal balance. Refresh Pays and try again.`,
        );
      }
    }
  }

  for (const usage of calculatedIntentUsage.values()) {
    if (usage.amountMinor > usage.intent.outstandingAmountMinor) {
      throw new HttpError(
        409,
        'Calculated staff compensation exceeds the authorized outstanding amount. Refresh Pays and try again.',
      );
    }
    const recordedMinor = await getRecordedPersonalSettlementMinor({
      staffUserId: params.staffUserId,
      rangeStart: params.rangeStart,
      rangeEnd: params.rangeEnd,
      sourceKey: usage.intent.sourceKey,
      componentId: usage.intent.componentId,
      segmentKey: getSettlementIntentSegmentKey(usage.intent),
      transaction: params.transaction,
    });
    const currentlyAvailableMinor = Math.max(usage.intent.grossAmountMinor - recordedMinor, 0);
    if (usage.amountMinor > currentlyAvailableMinor) {
      throw new HttpError(
        409,
        'Calculated staff compensation was already paid or changed. Refresh Pays and try again.',
      );
    }
  }

  for (const line of params.fundAllocations) {
    verifyCompensationSettlementIntent(line.settlementIntent);
    const route = await resolveLineRoute(line);
    const intent = line.verifiedIntent;
    if (
      intent.userId !== params.staffUserId
      || intent.rangeStart !== params.rangeStart
      || intent.rangeEnd !== params.rangeEnd
      || intent.currency !== resolveDefaultCurrency()
      || intent.sourceKey !== line.sourceKey
      || intent.componentId !== line.componentId
      || intent.fundId !== line.fundId
      || intent.outstandingAmountMinor !== line.amountMinor
    ) {
      throw new HttpError(409, `${line.label} settlement intent no longer matches this payout. Refresh Pays and try again.`);
    }
    if (
      route.destination !== 'volunteer_fund'
      || route.fundId !== line.fundId
      || route.ruleId !== intent.ruleId
    ) {
      throw new HttpError(
        409,
        `${line.label} is no longer routed to the selected Volunteer Fund. Refresh Pays and try again.`,
      );
    }
    const currentAllocatedMinor = await getNetFundAllocationForSource({
      staffUserId: params.staffUserId,
      rangeStart: params.rangeStart,
      rangeEnd: params.rangeEnd,
      sourceKey: line.sourceKey,
      componentId: line.componentId,
      segmentKey: getSettlementIntentSegmentKey(intent),
      transaction: params.transaction,
    });
    const currentlyAvailableMinor = Math.max(
      intent.grossAmountMinor - currentAllocatedMinor,
      0,
    );
    if (line.amountMinor > currentlyAvailableMinor) {
      throw new HttpError(
        409,
        `${line.label} was already allocated or its amount changed. Refresh Pays and try again.`,
      );
    }
  }

  if (params.reimbursement) {
    const route = settlementRouter.resolve({
      userId: params.staffUserId,
      staffType: params.staffType,
      systemSource: 'reimbursement',
    });
    if (route.destination !== 'staff_vendor') {
      throw new HttpError(409, 'Reimbursements must remain payable to the staff vendor.');
    }
  }

  return fundById;
};

type StaffPayoutBatchKeyParams = {
  requestId: string;
  staffProfileId: number;
  direction: 'receivable' | 'payable';
  counterpartyId: number | null;
  paidDate: string;
  rangeStart: string;
  rangeEnd: string;
  lines: NormalizedStaffPayoutBatchLine[];
  fundAllocations: NormalizedStaffPayoutFundAllocation[];
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

const buildStaffPayoutBatchKey = (params: StaffPayoutBatchKeyParams): string =>
  hashStaffPayoutBatchKey({
    version: 4,
    requestId: params.requestId,
    direction: params.direction,
    counterpartyId: params.counterpartyId,
    paidDate: params.paidDate,
    ...buildStaffPayoutBatchKeyBase(params),
    // Keep source identity attached to the full line before sorting. Separate
    // sorted amounts + unsorted source arrays made the key request-order
    // dependent and could associate a source with the wrong line.
    canonicalLines: params.lines
      .map((line) => ({
        label: line.label,
        componentId: line.componentId,
        sourceKey: line.sourceKey,
        ...(getSettlementIntentSegmentKey(line.verifiedIntent)
          ? { segmentKey: getSettlementIntentSegmentKey(line.verifiedIntent) }
          : {}),
        amountMinor: line.amountMinor,
        categoryId: line.categoryId,
        accountId: line.accountId,
        currency: line.currency ?? null,
        description: line.description ?? null,
        settlementAuthorizationHash: line.settlementIntent
          ? hashStaffPayoutBatchKey(line.settlementIntent)
          : null,
        affiliatePayout: line.affiliatePayout
          ? {
              affiliateUserId: line.affiliatePayout.affiliateUserId,
              bookingIds: [...line.affiliatePayout.bookingIds].sort((a, b) => a - b),
            }
          : null,
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    fundAllocations: [...params.fundAllocations]
      .map((line) => ({
        label: line.label,
        componentId: line.componentId,
        sourceKey: line.sourceKey,
        ...(getSettlementIntentSegmentKey(line.verifiedIntent)
          ? { segmentKey: getSettlementIntentSegmentKey(line.verifiedIntent) }
          : {}),
        amountMinor: line.amountMinor,
        fundId: line.fundId,
        description: line.description,
        settlementAuthorizationHash: hashStaffPayoutBatchKey(line.settlementIntent),
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
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

const getFundAllocationIdentity = (
  allocation: NormalizedStaffPayoutFundAllocation,
): string => hashStaffPayoutBatchKey({
  fundId: allocation.fundId,
  sourceKey: allocation.sourceKey,
  componentId: allocation.componentId,
  segmentKey: getSettlementIntentSegmentKey(allocation.verifiedIntent),
  settlementAuthorizationHash: hashStaffPayoutBatchKey(allocation.settlementIntent),
}).slice(0, 32);

const getFundAllocationIdempotencyKey = (
  batchKey: string,
  allocation: NormalizedStaffPayoutFundAllocation,
): string => `staff-settlement:${batchKey}:fund:${getFundAllocationIdentity(allocation)}`;

const getFundAllocationAttemptState = async (
  batchKey: string,
  allocation: NormalizedStaffPayoutFundAllocation,
  transaction?: SequelizeTransaction,
): Promise<{ hasActiveAllocation: boolean; attemptCount: number }> => {
  const baseKey = getFundAllocationIdempotencyKey(batchKey, allocation);
  const attempts = await VolunteerFundEntry.findAll({
    attributes: ['id'],
    where: {
      entryType: 'allocation',
      fundId: allocation.fundId,
      [Op.or]: [
        { idempotencyKey: baseKey },
        { idempotencyKey: { [Op.like]: `${baseKey}:retry:%` } },
      ],
    },
    transaction,
    ...(transaction ? { lock: transaction.LOCK.UPDATE } : {}),
  });
  if (attempts.length === 0) {
    return { hasActiveAllocation: false, attemptCount: 0 };
  }
  const reversedRows = await VolunteerFundEntry.findAll({
    attributes: ['reversalOfEntryId'],
    where: {
      entryType: 'reversal',
      reversalOfEntryId: { [Op.in]: attempts.map((entry) => entry.id) },
    },
    transaction,
    ...(transaction ? { lock: transaction.LOCK.UPDATE } : {}),
  });
  const reversedIds = new Set(
    reversedRows
      .map((entry) => entry.reversalOfEntryId)
      .filter((id): id is number => Boolean(id)),
  );
  return {
    hasActiveAllocation: attempts.some((entry) => !reversedIds.has(entry.id)),
    attemptCount: attempts.length,
  };
};

const hasCompleteFundAllocationBatch = async (
  batchKey: string,
  allocations: NormalizedStaffPayoutFundAllocation[],
  transaction?: SequelizeTransaction,
): Promise<boolean> => {
  if (allocations.length === 0) {
    return false;
  }
  const states = await Promise.all(
    allocations.map((allocation) => getFundAllocationAttemptState(
      batchKey,
      allocation,
      transaction,
    )),
  );
  return states.every((state) => state.hasActiveAllocation);
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
    accessPath: `/payout-receipt/${receipt.id}`,
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

export const createAffiliatePayoutLogForStaffLine = async (
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
    settlementAuthorization?: {
      grossAmountMinor: number;
      outstandingAmountMinor: number;
      earningStart: string | null;
      earningEnd: string | null;
      referenceIds: number[];
    } | null;
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
    transaction,
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
  const authorization = params.settlementAuthorization ?? null;
  const segmentIncludesBooking = (booking: typeof overview.bookings[number]): boolean => {
    if (!authorization?.earningStart || !authorization.earningEnd) {
      return true;
    }
    if (!booking.sourceReceivedAt) {
      return false;
    }
    const parsed = dayjs(booking.sourceReceivedAt);
    if (!parsed.isValid()) {
      return false;
    }
    const earningDate = parsed.tz('Europe/Warsaw').format('YYYY-MM-DD');
    return earningDate >= authorization.earningStart && earningDate <= authorization.earningEnd;
  };
  if (authorization?.earningStart && selectedBookings.some((booking) => !segmentIncludesBooking(booking))) {
    throw new HttpError(400, 'One or more affiliate bookings do not belong to the authorized earning segment.');
  }
  const selectedIds = Array.from(selectedBookingIds.values()).sort((left, right) => left - right);
  const authorizedReferenceIds = Array.from(new Set(authorization?.referenceIds ?? []))
    .sort((left, right) => left - right);
  if (
    authorization?.earningStart
    && (
      authorizedReferenceIds.length === 0
      || JSON.stringify(selectedIds) !== JSON.stringify(authorizedReferenceIds)
    )
  ) {
    throw new HttpError(400, 'Affiliate booking evidence no longer matches the signed settlement authorization.');
  }
  if (expectedAmountMinor !== params.amountMinor) {
    const allUnpaidSegmentBookingIds = overview.bookings
      .filter((booking) => (
        !booking.isCommissionPaid
        && booking.affiliateCommissionAmount > 0
        && segmentIncludesBooking(booking)
      ))
      .map((booking) => booking.id)
      .sort((left, right) => left - right);
    const isAuthorizedNettedSettlement = Boolean(
      authorization
      && params.amountMinor === authorization.outstandingAmountMinor
      && params.amountMinor > 0
      && params.amountMinor < expectedAmountMinor
      && expectedAmountMinor <= authorization.grossAmountMinor
      && JSON.stringify(selectedIds) === JSON.stringify(allUnpaidSegmentBookingIds)
    );
    if (!isAuthorizedNettedSettlement) {
      throw new HttpError(400, 'Affiliate payout line amount no longer matches selected bookings.');
    }
  }

  await AffiliatePayoutLog.create(
    {
      affiliateUserId: params.staffProfileId,
      currencyCode: bookingCurrency,
      // The log closes the gross booking commission. The linked finance and
      // collection rows retain the lower net cash amount when another signed
      // compensation source deducts from the same staff payout.
      amountMinor: expectedAmountMinor,
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
    const settlementRequestId = parseSettlementRequestId(req.body.requestId);
    const normalizedLines = normalizeBatchLines(req.body.lines ?? []);
    const fundAllocations = normalizeFundAllocations(req.body.fundAllocations).sort((left, right) =>
      JSON.stringify([
        left.fundId,
        left.sourceKey,
        left.componentId,
        getSettlementIntentSegmentKey(left.verifiedIntent),
        hashStaffPayoutBatchKey(left.settlementIntent),
        left.label,
        left.amountMinor,
      ]).localeCompare(JSON.stringify([
        right.fundId,
        right.sourceKey,
        right.componentId,
        getSettlementIntentSegmentKey(right.verifiedIntent),
        hashStaffPayoutBatchKey(right.settlementIntent),
        right.label,
        right.amountMinor,
      ])),
    );
    const normalizedReimbursement = normalizeReimbursementPayload(req.body.reimbursement);
    if (direction !== 'payable' && fundAllocations.length > 0) {
      throw new HttpError(400, 'Volunteer Fund allocations are only available for payable settlements.');
    }
    if (normalizedLines.length === 0 && fundAllocations.length === 0 && !normalizedReimbursement) {
      throw new HttpError(400, 'Select at least one payout line, fund allocation, or reimbursement.');
    }
    const hasPersonalSettlement = normalizedLines.length > 0 || Boolean(normalizedReimbursement);

    const staffProfile = await StaffProfile.findOne({
      where: { userId: staffProfileId },
      attributes: ['userId', 'financeVendorId', 'financeClientId', 'staffType'],
    });
    if (!staffProfile) {
      throw new HttpError(404, 'Staff profile not found.');
    }
    if (hasPersonalSettlement && direction === 'payable' && !staffProfile.financeVendorId) {
      throw new HttpError(400, 'This staff profile is not linked to a finance vendor.');
    }
    if (hasPersonalSettlement && direction === 'receivable' && !staffProfile.financeClientId) {
      throw new HttpError(400, 'This staff profile is not linked to a finance client.');
    }

    const linkedCounterpartyId = hasPersonalSettlement
      ? direction === 'payable'
        ? Number(staffProfile.financeVendorId)
        : Number(staffProfile.financeClientId)
      : null;
    const counterpartyId = hasPersonalSettlement
      ? parsePositiveInteger(linkedCounterpartyId, 'counterpartyId')
      : null;
    if (
      hasPersonalSettlement
      && req.body.counterpartyId !== undefined
      && req.body.counterpartyId !== null
    ) {
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
    assertStaffPayoutLedgerCurrencies(direction, financeSelections.lineCurrencies);
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
          'counterpartyType',
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
      requestId: settlementRequestId,
      staffProfileId,
      direction,
      counterpartyId,
      paidDate: payoutDate,
      rangeStart: rangeStart.format('YYYY-MM-DD'),
      rangeEnd: rangeEnd.format('YYYY-MM-DD'),
      lines,
      fundAllocations,
      reimbursement,
    };
    const batchKey = buildStaffPayoutBatchKey(batchKeyParams);

    const existingRequestBinding = await assertStaffPayoutSettlementRequestBinding({
      staffUserId: staffProfileId,
      requestId: settlementRequestId,
      payoutBatchKey: batchKey,
    });

    const existing = hasPersonalSettlement
      ? await findExistingBatchTransaction(batchKey)
      : null;
    if (existingRequestBinding) {
      const receipts = await listActiveBatchReceipts(batchKey);
      res.status(200).json({
        duplicated: true,
        batchKey,
        ...(existing ? { financeTransactionId: existing.id } : {}),
        receipts: serializeReceiptReferences(receipts),
        fundAllocationCount: fundAllocations.length,
      });
      return;
    }
    const existingFundBatchComplete = await hasCompleteFundAllocationBatch(
      batchKey,
      fundAllocations,
    );

    // Do availability/freshness checks only after exact idempotency lookup.
    // A client retry can arrive after the first request has already consumed
    // the authorized balance (or after its short-lived intent has expired),
    // and must still receive the original successful result.
    await validateBatchSettlementRouting({
      staffUserId: staffProfileId,
      staffType: staffProfile.staffType,
      direction,
      effectiveDate: rangeEnd.format('YYYY-MM-DD'),
      rangeStart: rangeStart.format('YYYY-MM-DD'),
      rangeEnd: rangeEnd.format('YYYY-MM-DD'),
      lines: existing ? [] : lines,
      fundAllocations: existingFundBatchComplete ? [] : fundAllocations,
      reimbursement: existing ? null : reimbursement,
    });

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

      // The User row lock makes this the authoritative request-id binding
      // check. Concurrent settlements for this staff member cannot both bind
      // one request id to different canonical payloads.
      const requestBindingInsideTx = await assertStaffPayoutSettlementRequestBinding({
        staffUserId: staffProfileId,
        requestId: settlementRequestId,
        payoutBatchKey: batchKey,
        transaction,
      });
      if (requestBindingInsideTx) {
        const receipts = await listActiveBatchReceipts(batchKey, transaction);
        return {
          duplicated: true as const,
          receipts,
          fundAllocationCount: fundAllocations.length,
        };
      }

      // This immutable row commits atomically with the settlement and is not
      // removed by payout deletion or fund reversal. Any failed batch rolls it
      // back together with the rest of the transaction.
      await createStaffPayoutSettlementRequestBinding({
        staffUserId: staffProfileId,
        requestId: settlementRequestId,
        payoutBatchKey: batchKey,
        actorId,
        transaction,
      });

      const lockedStaffProfile = await StaffProfile.findOne({
        where: { userId: staffProfileId },
        attributes: ['userId', 'financeVendorId', 'financeClientId', 'staffType'],
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      const lockedCounterpartyId = hasPersonalSettlement
        ? direction === 'payable'
          ? Number(lockedStaffProfile?.financeVendorId)
          : Number(lockedStaffProfile?.financeClientId)
        : null;
      if (
        !lockedStaffProfile
        || (hasPersonalSettlement && lockedCounterpartyId !== counterpartyId)
      ) {
        throw new HttpError(409, 'The staff finance link changed. Refresh Pays and try again.');
      }

      const duplicateInsideTx = hasPersonalSettlement
        ? await findExistingBatchTransaction(batchKey, transaction)
        : null;
      const fundBatchCompleteInsideTx = await hasCompleteFundAllocationBatch(
        batchKey,
        fundAllocations,
        transaction,
      );
      if (
        duplicateInsideTx
        && (fundAllocations.length === 0 || fundBatchCompleteInsideTx)
      ) {
        const receipts = await listActiveBatchReceipts(
          getStoredStaffPayoutBatchKey(duplicateInsideTx, batchKey),
          transaction,
        );
        return { duplicated: true as const, receipts, fundAllocationCount: fundAllocations.length };
      }
      if (!duplicateInsideTx && fundBatchCompleteInsideTx) {
        return { duplicated: true as const, receipts: [], fundAllocationCount: fundAllocations.length };
      }
      const shouldCreatePersonalSettlement = !duplicateInsideTx;

      const lockedFundById = await validateBatchSettlementRouting({
        staffUserId: staffProfileId,
        staffType: lockedStaffProfile.staffType,
        direction,
        effectiveDate: rangeEnd.format('YYYY-MM-DD'),
        rangeStart: rangeStart.format('YYYY-MM-DD'),
        rangeEnd: rangeEnd.format('YYYY-MM-DD'),
        lines: shouldCreatePersonalSettlement ? lines : [],
        fundAllocations,
        reimbursement: shouldCreatePersonalSettlement ? reimbursement : null,
        transaction,
      });

      if (
        direction === 'payable'
        && (shouldCreatePersonalSettlement || fundAllocations.length > 0)
      ) {
        if (shouldCreatePersonalSettlement) {
          // Reconcile first so the cap includes legacy Promotion Sales and any
          // deletion/undo that committed before this row lock was acquired.
          await reconcilePersistedStaffPayoutLedgers({
            staffUserId: staffProfileId,
            affectedRangeStart: rangeStart.format('YYYY-MM-DD'),
            affectedRangeEnd: rangeEnd.format('YYYY-MM-DD'),
            transaction,
          });
        }
        const lockedPayoutLedger = await StaffPayoutLedger.findOne({
          where: {
            staffUserId: staffProfileId,
            rangeStart: rangeStart.format('YYYY-MM-DD'),
            rangeEnd: rangeEnd.format('YYYY-MM-DD'),
          },
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
        if (!lockedPayoutLedger) {
          throw new HttpError(
            409,
            'The payout ledger is not ready. Refresh Pays before processing compensation.',
          );
        }
        assertSettlementIntentsMatchLedgerSnapshot({
          ledger: lockedPayoutLedger,
          lines: shouldCreatePersonalSettlement ? lines : [],
          fundAllocations,
        });
        if (shouldCreatePersonalSettlement) {
          const requestedPersonalMinor = lines.reduce(
            (sum, line) => sum + line.amountMinor,
            reimbursement?.amountMinor ?? 0,
          );
          const availablePersonalMinor = Math.max(
            Number(lockedPayoutLedger.closingBalanceMinor ?? 0),
            0,
          );
          if (
            !Number.isSafeInteger(requestedPersonalMinor)
            || requestedPersonalMinor > availablePersonalMinor
          ) {
            throw new HttpError(
              409,
              'This payment exceeds the saved personal balance. Refresh Pays or reconcile the historical payout ledger.',
            );
          }
        }
      }

      if (shouldCreatePersonalSettlement) {
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
        const lockedFinanceSelections = validateStaffPayoutFinanceSelections({
          direction,
          lines,
          reimbursement,
          accounts: lockedAccounts,
          categories: lockedCategories,
          baseCurrency: resolveDefaultCurrency(),
        });
        assertStaffPayoutLedgerCurrencies(
          direction,
          lockedFinanceSelections.lineCurrencies,
        );
      }

      if (shouldCreatePersonalSettlement && reimbursement) {
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
            'counterpartyType',
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

      for (const line of shouldCreatePersonalSettlement ? lines : []) {
        const currency = normalizeCurrencyCode(line.currency);
        const segmentedIntent = line.verifiedIntent
          && isSegmentedCompensationSettlementIntent(line.verifiedIntent)
          ? line.verifiedIntent
          : null;
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
              sourceKey: line.sourceKey,
              ...(line.componentId ? { componentId: line.componentId } : {}),
              ...(segmentedIntent
                ? {
                    segmentKey: segmentedIntent.segmentKey,
                    earningStart: segmentedIntent.earningStart,
                    earningEnd: segmentedIntent.earningEnd,
                    staffTypePeriodId: segmentedIntent.staffTypePeriodId,
                    staffType: segmentedIntent.staffType,
                    legacyExtrapolation: segmentedIntent.legacyExtrapolation,
                  }
                : {}),
              payoutBatchKey: batchKey,
              settlementRequestId,
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
              settlementAuthorization: line.verifiedIntent
                ? {
                    grossAmountMinor: line.verifiedIntent.grossAmountMinor,
                    outstandingAmountMinor: line.verifiedIntent.outstandingAmountMinor,
                    earningStart: isSegmentedCompensationSettlementIntent(line.verifiedIntent)
                      ? line.verifiedIntent.earningStart
                      : null,
                    earningEnd: isSegmentedCompensationSettlementIntent(line.verifiedIntent)
                      ? line.verifiedIntent.earningEnd
                      : null,
                    referenceIds: isSegmentedCompensationSettlementIntent(line.verifiedIntent)
                      ? line.verifiedIntent.referenceIds
                      : [],
                  }
                : null,
            },
            transaction,
          );
        }
      }

      if (shouldCreatePersonalSettlement && reimbursement && reimbursement.amountMinor > 0) {
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
              settlementRequestId,
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

      if (shouldCreatePersonalSettlement) {
        await reconcilePersistedStaffPayoutLedgers({
          staffUserId: staffProfileId,
          affectedRangeStart: rangeStart.format('YYYY-MM-DD'),
          affectedRangeEnd: rangeEnd.format('YYYY-MM-DD'),
          transaction,
        });
      }

      if (fundAllocations.length > 0) {
        for (const allocation of fundAllocations) {
          const fund = lockedFundById.get(allocation.fundId);
          if (!fund) {
            throw new HttpError(409, 'The selected Volunteer Fund is no longer available.');
          }
          const segmentedIntent = isSegmentedCompensationSettlementIntent(
            allocation.verifiedIntent,
          )
            ? allocation.verifiedIntent
            : null;
          const settlementStaffType = segmentedIntent?.staffType ?? lockedStaffProfile.staffType;
          const allocationAttempt = await getFundAllocationAttemptState(
            batchKey,
            allocation,
            transaction,
          );
          if (allocationAttempt.hasActiveAllocation) {
            continue;
          }
          const baseIdempotencyKey = getFundAllocationIdempotencyKey(batchKey, allocation);
          const allocationIdempotencyKey = allocationAttempt.attemptCount === 0
            ? baseIdempotencyKey
            : `${baseIdempotencyKey}:retry:${allocationAttempt.attemptCount}`;
          const allocationDescription = allocation.description
            ?? `${allocation.label} allocated from ${settlementStaffType} compensation`;
          const allocationSourceSnapshot = {
            source: 'staff-compensation-settlement',
            label: allocation.label,
            sourceKey: allocation.sourceKey,
            componentId: allocation.componentId,
            ruleId: allocation.verifiedIntent.ruleId,
            ...(segmentedIntent
              ? {
                  segmentKey: segmentedIntent.segmentKey,
                  earningStart: segmentedIntent.earningStart,
                  earningEnd: segmentedIntent.earningEnd,
                  staffTypePeriodId: segmentedIntent.staffTypePeriodId,
                  staffType: segmentedIntent.staffType,
                  legacyExtrapolation: segmentedIntent.legacyExtrapolation,
                }
              : {}),
            payoutBatchKey: batchKey,
            settlementRequestId,
            periodStart: rangeStart.format('YYYY-MM-DD'),
            periodEnd: rangeEnd.format('YYYY-MM-DD'),
          };
          const financeTransfer = await createVolunteerFundAllocationTransfer({
            fund,
            allocationIdempotencyKey,
            amountMinor: allocation.amountMinor,
            date: payoutDate,
            description: allocationDescription,
            payoutBatchKey: batchKey,
            settlementRequestId,
            staffUserId: staffProfileId,
            sourceKey: allocation.sourceKey,
            componentId: allocation.componentId,
            periodStart: rangeStart.format('YYYY-MM-DD'),
            periodEnd: rangeEnd.format('YYYY-MM-DD'),
            actorId,
            transaction,
          });
          await VolunteerFundEntry.create(
            {
              fundId: allocation.fundId,
              entryType: 'allocation',
              amountMinor: allocation.amountMinor,
              currency: fund.currency,
              entryDate: payoutDate,
              periodStart: rangeStart.format('YYYY-MM-DD'),
              periodEnd: rangeEnd.format('YYYY-MM-DD'),
              description: allocationDescription,
              attributedStaffUserId: staffProfileId,
              compensationComponentId: allocation.componentId,
              sourceKind: allocation.sourceKey,
              sourceReference: segmentedIntent?.segmentKey ?? [
                  staffProfileId,
                  rangeStart.format('YYYY-MM-DD'),
                  rangeEnd.format('YYYY-MM-DD'),
                  allocation.sourceKey,
                  allocation.componentId ?? 0,
                ].join(':'),
              attributionSnapshot: {
                staffUserId: staffProfileId,
                staffType: settlementStaffType,
                ...(segmentedIntent
                  ? {
                      staffTypePeriodId: segmentedIntent.staffTypePeriodId,
                      earningStart: segmentedIntent.earningStart,
                      earningEnd: segmentedIntent.earningEnd,
                      legacyExtrapolation: segmentedIntent.legacyExtrapolation,
                    }
                  : {}),
              },
              sourceSnapshot: {
                ...allocationSourceSnapshot,
                financeTransfer,
              },
              financeTransactionId: financeTransfer.debitTransactionId,
              financeCounterTransactionId: financeTransfer.creditTransactionId,
              idempotencyKey: allocationIdempotencyKey,
              reversalOfEntryId: null,
              createdBy: actorId,
            },
            { transaction },
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

      return {
        duplicated: false as const,
        receipts,
        fundAllocationCount: fundAllocations.length,
      };
    });

    res.status(batchResult.duplicated ? 200 : 201).json({
      duplicated: batchResult.duplicated,
      batchKey,
      lineCount: lines.length,
      fundAllocationCount: batchResult.fundAllocationCount,
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

      await reconcilePersistedStaffPayoutLedgers({
        staffUserId: staffProfileId,
        affectedRangeStart: rangeStart.format('YYYY-MM-DD'),
        affectedRangeEnd: rangeEnd.format('YYYY-MM-DD'),
        transaction,
      });

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
