import dayjs from 'dayjs';
import { Op, type Transaction as SequelizeTransaction } from 'sequelize';
import sequelize from '../../config/database.js';
import HttpError from '../../errors/HttpError.js';
import CompensationComponent from '../../models/CompensationComponent.js';
import CompensationSettlementRule, {
  type CompensationSettlementDestination,
  type CompensationSettlementMatchKind,
  type CompensationSettlementTargetScope,
} from '../../models/CompensationSettlementRule.js';
import User from '../../models/User.js';
import { getConfigValue } from '../../services/configService.js';
import VolunteerFund from '../models/VolunteerFund.js';
import { recordFinanceAuditLog } from './auditLogService.js';

const TARGET_SCOPES = new Set<CompensationSettlementTargetScope>(['global', 'staff_type', 'user']);
const MATCH_KINDS = new Set<CompensationSettlementMatchKind>([
  'default',
  'component',
  'component_category',
  'system_source',
]);
const DESTINATIONS = new Set<CompensationSettlementDestination>([
  'staff_vendor',
  'volunteer_fund',
  'excluded',
]);
const STAFF_TYPES = new Set(['volunteer', 'long_term', 'assistant_manager', 'manager', 'guide']);
const COMPONENT_CATEGORIES = new Set([
  'base',
  'commission',
  'incentive',
  'bonus',
  'review',
  'deduction',
  'adjustment',
]);

export type SettlementRuleInput = {
  targetScope: CompensationSettlementTargetScope;
  staffType: string | null;
  userId: number | null;
  matchKind: CompensationSettlementMatchKind;
  componentId: number | null;
  matchKey: string | null;
  destination: CompensationSettlementDestination;
  fundId: number | null;
  effectiveStart: string | null;
  effectiveEnd: string | null;
  isActive: boolean;
};

const optionalPositiveInteger = (value: unknown, field: string): number | null => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, `${field} must be a positive integer.`);
  }
  return parsed;
};

const optionalDate = (value: unknown, field: string): string | null => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    throw new HttpError(400, `${field} must use YYYY-MM-DD.`);
  }
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new HttpError(400, `${field} must use YYYY-MM-DD.`);
  }
  const parsed = dayjs(normalized);
  if (!parsed.isValid() || parsed.format('YYYY-MM-DD') !== normalized) {
    throw new HttpError(400, `${field} is not a valid date.`);
  }
  return normalized;
};

const readBoolean = (value: unknown, fallback: boolean): boolean => {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'boolean') {
    throw new HttpError(400, 'isActive must be a boolean.');
  }
  return value;
};

const normalizeIdentifier = (value: unknown, field: string): string => {
  if (typeof value !== 'string') {
    throw new HttpError(400, `${field} is required.`);
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized || !/^[a-z0-9][a-z0-9_:-]*$/.test(normalized)) {
    throw new HttpError(400, `${field} must be a lowercase identifier.`);
  }
  return normalized;
};

const canonicalMatchKind = (value: unknown): CompensationSettlementMatchKind | null => {
  if (value === 'category') {
    return 'component_category';
  }
  if (value === 'special_source') {
    return 'system_source';
  }
  return typeof value === 'string' && MATCH_KINDS.has(value as CompensationSettlementMatchKind)
    ? value as CompensationSettlementMatchKind
    : null;
};

export const normalizeSettlementRuleInput = (
  raw: Record<string, unknown>,
  fallback?: SettlementRuleInput,
): SettlementRuleInput => {
  const targetScopeRaw = raw.targetScope ?? raw.scope ?? fallback?.targetScope;
  if (typeof targetScopeRaw !== 'string' || !TARGET_SCOPES.has(targetScopeRaw as CompensationSettlementTargetScope)) {
    throw new HttpError(400, 'targetScope must be global, staff_type, or user.');
  }
  const targetScope = targetScopeRaw as CompensationSettlementTargetScope;

  const matchKind = canonicalMatchKind(raw.matchKind ?? raw.sourceKind ?? fallback?.matchKind);
  if (!matchKind) {
    throw new HttpError(
      400,
      'matchKind must be default, component, component_category, or system_source.',
    );
  }

  const destinationRaw = raw.destination ?? fallback?.destination;
  if (typeof destinationRaw !== 'string' || !DESTINATIONS.has(destinationRaw as CompensationSettlementDestination)) {
    throw new HttpError(400, 'destination must be staff_vendor, volunteer_fund, or excluded.');
  }
  const destination = destinationRaw as CompensationSettlementDestination;

  let staffType: string | null = null;
  let userId: number | null = null;
  if (targetScope === 'staff_type') {
    staffType = normalizeIdentifier(raw.staffType ?? fallback?.staffType, 'staffType');
    if (!STAFF_TYPES.has(staffType)) {
      throw new HttpError(400, 'staffType is not supported.');
    }
  } else if (targetScope === 'user') {
    userId = optionalPositiveInteger(raw.userId ?? fallback?.userId, 'userId');
    if (!userId) {
      throw new HttpError(400, 'userId is required for user rules.');
    }
  }

  let componentId: number | null = null;
  let matchKey: string | null = null;
  if (matchKind === 'component') {
    componentId = optionalPositiveInteger(raw.componentId ?? fallback?.componentId, 'componentId');
    if (!componentId) {
      throw new HttpError(400, 'componentId is required for component rules.');
    }
  } else if (matchKind === 'component_category') {
    matchKey = normalizeIdentifier(
      raw.matchKey ?? raw.componentCategory ?? fallback?.matchKey,
      'matchKey',
    );
    if (!COMPONENT_CATEGORIES.has(matchKey)) {
      throw new HttpError(400, 'matchKey is not a supported compensation component category.');
    }
  } else if (matchKind === 'system_source') {
    matchKey = normalizeIdentifier(
      raw.matchKey ?? raw.specialSource ?? fallback?.matchKey,
      'matchKey',
    );
  }

  const fundId = destination === 'volunteer_fund'
    ? optionalPositiveInteger(raw.fundId ?? raw.volunteerFundId ?? fallback?.fundId, 'fundId')
    : null;
  if (destination === 'volunteer_fund' && !fundId) {
    throw new HttpError(400, 'fundId is required when destination is volunteer_fund.');
  }

  const effectiveStart = optionalDate(
    raw.effectiveStart !== undefined ? raw.effectiveStart : fallback?.effectiveStart,
    'effectiveStart',
  );
  const effectiveEnd = optionalDate(
    raw.effectiveEnd !== undefined ? raw.effectiveEnd : fallback?.effectiveEnd,
    'effectiveEnd',
  );
  if (effectiveStart && effectiveEnd && effectiveEnd < effectiveStart) {
    throw new HttpError(400, 'effectiveEnd must be on or after effectiveStart.');
  }

  return {
    targetScope,
    staffType,
    userId,
    matchKind,
    componentId,
    matchKey,
    destination,
    fundId,
    effectiveStart,
    effectiveEnd,
    isActive: readBoolean(raw.isActive, fallback?.isActive ?? true),
  };
};

export const settlementRuleRangesOverlap = (
  leftStart: string | null,
  leftEnd: string | null,
  rightStart: string | null,
  rightEnd: string | null,
): boolean => {
  const leftStartsBeforeRightEnds = !rightEnd || !leftStart || leftStart <= rightEnd;
  const rightStartsBeforeLeftEnds = !leftEnd || !rightStart || rightStart <= leftEnd;
  return leftStartsBeforeRightEnds && rightStartsBeforeLeftEnds;
};

const currentPeriodEnd = (): string => dayjs().endOf('month').format('YYYY-MM-DD');
const nextPeriodStart = (): string => dayjs().add(1, 'month').startOf('month').format('YYYY-MM-DD');

const assertFullPeriodBoundaries = (input: SettlementRuleInput): void => {
  if (input.effectiveStart && dayjs(input.effectiveStart).date() !== 1) {
    throw new HttpError(400, 'effectiveStart must be the first day of a calendar month.');
  }
  if (
    input.effectiveEnd
    && input.effectiveEnd !== dayjs(input.effectiveEnd).endOf('month').format('YYYY-MM-DD')
  ) {
    throw new HttpError(400, 'effectiveEnd must be the last day of a calendar month.');
  }
};

export const assertProspectiveSettlementRule = (input: SettlementRuleInput): void => {
  assertFullPeriodBoundaries(input);
  if (!input.effectiveStart) {
    throw new HttpError(400, 'effectiveStart is required for a new settlement rule.');
  }
  if (input.effectiveStart < nextPeriodStart()) {
    throw new HttpError(
      409,
      `New payout routing rules must start on or after ${nextPeriodStart()} so a partially completed pay period is never rerouted.`,
    );
  }
};

const routingIdentity = (input: SettlementRuleInput) => JSON.stringify({
  targetScope: input.targetScope,
  staffType: input.staffType,
  userId: input.userId,
  matchKind: input.matchKind,
  componentId: input.componentId,
  matchKey: input.matchKey,
  destination: input.destination,
  fundId: input.fundId,
  effectiveStart: input.effectiveStart,
  isActive: input.isActive,
});

const validateRuleReferences = async (
  input: SettlementRuleInput,
  transaction: SequelizeTransaction,
): Promise<void> => {
  if (input.userId) {
    const user = await User.findByPk(input.userId, { attributes: ['id'], transaction });
    if (!user) {
      throw new HttpError(400, 'Target user was not found.');
    }
  }
  if (input.componentId) {
    const component = await CompensationComponent.findByPk(input.componentId, {
      attributes: ['id'],
      transaction,
    });
    if (!component) {
      throw new HttpError(400, 'Compensation component was not found.');
    }
  }
  if (input.fundId) {
    const fund = await VolunteerFund.findByPk(input.fundId, {
      attributes: ['id', 'currency', 'isActive'],
      transaction,
    });
    if (!fund) {
      throw new HttpError(400, 'Volunteer fund was not found.');
    }
    if (input.isActive && !fund.isActive) {
      throw new HttpError(400, 'An active rule cannot target an inactive volunteer fund.');
    }
    const compensationCurrency = String(getConfigValue('FINANCE_BASE_CURRENCY') ?? 'PLN')
      .trim()
      .toUpperCase();
    if (fund.currency.trim().toUpperCase() !== compensationCurrency) {
      throw new HttpError(
        400,
        `A compensation settlement fund must use ${compensationCurrency}.`,
      );
    }
  }
};

const assertNoActiveOverlap = async (
  input: SettlementRuleInput,
  transaction: SequelizeTransaction,
  excludedId?: number,
): Promise<void> => {
  if (!input.isActive) {
    return;
  }
  const candidates = await CompensationSettlementRule.findAll({
    where: {
      ...(excludedId ? { id: { [Op.ne]: excludedId } } : {}),
      targetScope: input.targetScope,
      staffType: input.staffType,
      userId: input.userId,
      matchKind: input.matchKind,
      componentId: input.componentId,
      matchKey: input.matchKey,
      isActive: true,
    },
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (
    candidates.some((candidate) => settlementRuleRangesOverlap(
      input.effectiveStart,
      input.effectiveEnd,
      candidate.effectiveStart,
      candidate.effectiveEnd,
    ))
  ) {
    throw new HttpError(409, 'An active settlement rule already covers this target, source, and date range.');
  }
};

export const createSettlementRule = async (
  raw: Record<string, unknown>,
  actorId: number,
): Promise<CompensationSettlementRule> => sequelize.transaction(async (transaction) => {
  const input = normalizeSettlementRuleInput(raw);
  assertProspectiveSettlementRule(input);
  await validateRuleReferences(input, transaction);
  await assertNoActiveOverlap(input, transaction);
  const created = await CompensationSettlementRule.create(
    { ...input, createdBy: actorId, updatedBy: actorId },
    { transaction },
  );
  await recordFinanceAuditLog({
    entity: 'compensation_settlement_rule',
    entityId: created.id,
    action: 'create',
    performedBy: actorId,
    changes: created.toJSON() as Record<string, unknown>,
    transaction,
  });
  return created;
});

export const updateSettlementRule = async (
  id: number,
  raw: Record<string, unknown>,
  actorId: number,
  outerTransaction?: SequelizeTransaction,
): Promise<CompensationSettlementRule> => {
  const execute = async (transaction: SequelizeTransaction): Promise<CompensationSettlementRule> => {
    const existing = await CompensationSettlementRule.findByPk(id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!existing) {
      throw new HttpError(404, 'Settlement rule not found.');
    }
    const fallback: SettlementRuleInput = {
      targetScope: existing.targetScope,
      staffType: existing.staffType,
      userId: existing.userId,
      matchKind: existing.matchKind,
      componentId: existing.componentId,
      matchKey: existing.matchKey,
      destination: existing.destination,
      fundId: existing.fundId,
      effectiveStart: existing.effectiveStart,
      effectiveEnd: existing.effectiveEnd,
      isActive: existing.isActive,
    };
    const input = normalizeSettlementRuleInput(raw, fallback);
    assertFullPeriodBoundaries(input);
    const hasBegun = !existing.effectiveStart || existing.effectiveStart <= currentPeriodEnd();
    if (hasBegun) {
      if (
        existing.effectiveEnd
        && existing.effectiveEnd < dayjs().startOf('month').format('YYYY-MM-DD')
        && input.effectiveEnd !== existing.effectiveEnd
      ) {
        throw new HttpError(409, 'An ended payout routing rule is immutable. Create a new successor rule instead.');
      }
      if (routingIdentity(input) !== routingIdentity(fallback)) {
        throw new HttpError(
          409,
          'This payout routing rule has already begun and its history is immutable. End it on a month boundary, then create a successor rule for the next month.',
        );
      }
      if (input.effectiveEnd !== existing.effectiveEnd) {
        if (!input.effectiveEnd || input.effectiveEnd < currentPeriodEnd()) {
          throw new HttpError(
            409,
            `A started rule can only be ended on or after ${currentPeriodEnd()}.`,
          );
        }
      }
    } else {
      assertProspectiveSettlementRule(input);
    }
    await validateRuleReferences(input, transaction);
    await assertNoActiveOverlap(input, transaction, existing.id);
    await existing.update({ ...input, updatedBy: actorId }, { transaction });
    await recordFinanceAuditLog({
      entity: 'compensation_settlement_rule',
      entityId: existing.id,
      action: input.isActive ? 'update' : 'deactivate',
      performedBy: actorId,
      changes: { ...input },
      transaction,
    });
    return existing;
  };
  return outerTransaction ? execute(outerTransaction) : sequelize.transaction(execute);
};

export const deactivateSettlementRule = async (
  id: number,
  actorId: number,
): Promise<CompensationSettlementRule> => updateSettlementRule(id, { isActive: false }, actorId);
