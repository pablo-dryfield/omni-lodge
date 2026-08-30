import { Op, type Transaction, type WhereOptions } from 'sequelize';
import HttpError from '../errors/HttpError.js';
import CompensationSettlementRule from '../models/CompensationSettlementRule.js';

export type CompensationSettlementTargetScope = 'global' | 'staff_type' | 'user';
export type CompensationSettlementMatchKind =
  | 'component'
  | 'system_source'
  | 'component_category'
  | 'default';
export type CompensationSettlementDestination = 'staff_vendor' | 'volunteer_fund' | 'excluded';

export const COMPENSATION_SETTLEMENT_SYSTEM_SOURCE = {
  PROMOTION_SALES: 'promotion_sales',
  REIMBURSEMENT: 'reimbursement',
} as const;

export type CompensationSettlementRoutingInput = {
  userId: number;
  staffType: string | null | undefined;
  effectiveDate: string;
  componentId?: number | null;
  systemSource?: string | null;
  componentCategory?: string | null;
  transaction?: Transaction;
};

export type CompensationSettlementRouterInput = Omit<
  CompensationSettlementRoutingInput,
  'effectiveDate' | 'transaction'
>;

export type LoadCompensationSettlementRouterInput = {
  effectiveDate: string;
  transaction?: Transaction;
};

export type CompensationSettlementRoutingResult = {
  destination: CompensationSettlementDestination;
  fundId: number | null;
  ruleId: number;
  targetScope: CompensationSettlementTargetScope;
  matchKind: CompensationSettlementMatchKind;
  context: {
    userId: number;
    staffType: string | null;
    effectiveDate: string;
    componentId: number | null;
    systemSource: string | null;
    componentCategory: string | null;
  };
};

export type CompensationSettlementRouter = {
  effectiveDate: string;
  resolve: (input: CompensationSettlementRouterInput) => CompensationSettlementRoutingResult;
};

/**
 * A closed payout-period snapshot is still provisional until money has moved.
 * This lets a corrected routing policy update an unpaid historical period,
 * while any personal payment or live fund allocation freezes its snapshot.
 */
export const canRefreshClosedSettlementSnapshot = (params: {
  canonicalPaidMinor: number;
  liveFundAllocatedMinor: number;
}): boolean => (
  Number.isSafeInteger(params.canonicalPaidMinor)
  && params.canonicalPaidMinor === 0
  && Number.isSafeInteger(params.liveFundAllocatedMinor)
  && params.liveFundAllocatedMinor === 0
);

type SettlementRuleRecord = {
  id: number;
  targetScope: string;
  staffType: string | null;
  userId: number | null;
  matchKind: string;
  componentId: number | null;
  matchKey: string | null;
  destination: string;
  fundId: number | null;
  effectiveStart: string | null;
  effectiveEnd: string | null;
  isActive: boolean;
};

type NormalizedRoutingContext = CompensationSettlementRoutingResult['context'];

const TARGET_SCOPE_RANK: Record<CompensationSettlementTargetScope, number> = {
  global: 1,
  staff_type: 2,
  user: 3,
};

const MATCH_KIND_RANK: Record<CompensationSettlementMatchKind, number> = {
  default: 1,
  component_category: 2,
  system_source: 3,
  component: 4,
};

const DESTINATION_VALUES = new Set<CompensationSettlementDestination>([
  'staff_vendor',
  'volunteer_fund',
  'excluded',
]);

const normalizeRoutingToken = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');

  return normalized || null;
};

export const normalizeCompensationStaffType = (value: unknown): string | null =>
  normalizeRoutingToken(value);

export const normalizeCompensationSystemSource = (value: unknown): string | null =>
  normalizeRoutingToken(value);

export const normalizeCompensationComponentCategory = (value: unknown): string | null =>
  normalizeRoutingToken(value);

const normalizePositiveInteger = (value: unknown): number | null => {
  if (value == null || value === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
};

const normalizeEffectiveDate = (value: unknown): string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, 'effectiveDate must use YYYY-MM-DD format.');
  }

  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    throw new HttpError(400, 'effectiveDate must be a valid calendar date.');
  }
  return value;
};

const normalizeContext = (
  input: CompensationSettlementRoutingInput,
): NormalizedRoutingContext => {
  const userId = normalizePositiveInteger(input.userId);
  if (!userId) {
    throw new HttpError(400, 'userId must be a positive integer.');
  }

  const componentId = normalizePositiveInteger(input.componentId);
  if (input.componentId != null && !componentId) {
    throw new HttpError(400, 'componentId must be a positive integer when provided.');
  }

  return {
    userId,
    staffType: normalizeCompensationStaffType(input.staffType),
    effectiveDate: normalizeEffectiveDate(input.effectiveDate),
    componentId,
    systemSource: normalizeCompensationSystemSource(input.systemSource),
    componentCategory: normalizeCompensationComponentCategory(input.componentCategory),
  };
};

const normalizeTargetScope = (value: unknown): CompensationSettlementTargetScope | null => {
  const normalized = normalizeRoutingToken(value);
  return normalized && normalized in TARGET_SCOPE_RANK
    ? normalized as CompensationSettlementTargetScope
    : null;
};

const normalizeMatchKind = (value: unknown): CompensationSettlementMatchKind | null => {
  const normalized = normalizeRoutingToken(value);
  return normalized && normalized in MATCH_KIND_RANK
    ? normalized as CompensationSettlementMatchKind
    : null;
};

const ruleMatchesScope = (
  rule: SettlementRuleRecord,
  context: NormalizedRoutingContext,
): boolean => {
  const targetScope = normalizeTargetScope(rule.targetScope);
  if (targetScope === 'global') {
    return true;
  }
  if (targetScope === 'user') {
    return normalizePositiveInteger(rule.userId) === context.userId;
  }
  if (targetScope === 'staff_type') {
    return Boolean(
      context.staffType
      && normalizeCompensationStaffType(rule.staffType) === context.staffType,
    );
  }
  return false;
};

const ruleIsEffective = (
  rule: SettlementRuleRecord,
  effectiveDate: string,
): boolean => Boolean(
  rule.isActive
  && (!rule.effectiveStart || rule.effectiveStart <= effectiveDate)
  && (!rule.effectiveEnd || rule.effectiveEnd >= effectiveDate),
);

const ruleMatchesInput = (
  rule: SettlementRuleRecord,
  context: NormalizedRoutingContext,
): boolean => {
  const matchKind = normalizeMatchKind(rule.matchKind);
  if (matchKind === 'default') {
    return true;
  }
  if (matchKind === 'component') {
    return Boolean(
      context.componentId
      && normalizePositiveInteger(rule.componentId) === context.componentId,
    );
  }
  if (matchKind === 'system_source') {
    return Boolean(
      context.systemSource
      && normalizeCompensationSystemSource(rule.matchKey) === context.systemSource,
    );
  }
  if (matchKind === 'component_category') {
    return Boolean(
      context.componentCategory
      && normalizeCompensationComponentCategory(rule.matchKey) === context.componentCategory,
    );
  }
  return false;
};

const compareRules = (left: SettlementRuleRecord, right: SettlementRuleRecord): number => {
  const leftScope = normalizeTargetScope(left.targetScope);
  const rightScope = normalizeTargetScope(right.targetScope);
  const scopeRank = (rightScope ? TARGET_SCOPE_RANK[rightScope] : 0)
    - (leftScope ? TARGET_SCOPE_RANK[leftScope] : 0);
  if (scopeRank !== 0) {
    return scopeRank;
  }

  const leftMatch = normalizeMatchKind(left.matchKind);
  const rightMatch = normalizeMatchKind(right.matchKind);
  const matchRank = (rightMatch ? MATCH_KIND_RANK[rightMatch] : 0)
    - (leftMatch ? MATCH_KIND_RANK[leftMatch] : 0);
  if (matchRank !== 0) {
    return matchRank;
  }

  const effectiveStartOrder = (right.effectiveStart ?? '').localeCompare(left.effectiveStart ?? '');
  if (effectiveStartOrder !== 0) {
    return effectiveStartOrder;
  }

  return Number(right.id) - Number(left.id);
};

const validateSelectedRule = (
  rule: SettlementRuleRecord,
): {
  destination: CompensationSettlementDestination;
  fundId: number | null;
  targetScope: CompensationSettlementTargetScope;
  matchKind: CompensationSettlementMatchKind;
} => {
  const destination = normalizeRoutingToken(rule.destination);
  const targetScope = normalizeTargetScope(rule.targetScope);
  const matchKind = normalizeMatchKind(rule.matchKind);
  if (!destination || !DESTINATION_VALUES.has(destination as CompensationSettlementDestination)) {
    throw new HttpError(409, 'The selected compensation settlement rule has an invalid destination.', {
      code: 'COMPENSATION_SETTLEMENT_RULE_INVALID',
      ruleId: Number(rule.id),
    });
  }
  if (!targetScope || !matchKind) {
    throw new HttpError(409, 'The selected compensation settlement rule is invalid.', {
      code: 'COMPENSATION_SETTLEMENT_RULE_INVALID',
      ruleId: Number(rule.id),
    });
  }

  const fundId = normalizePositiveInteger(rule.fundId);
  if (destination === 'volunteer_fund' && !fundId) {
    throw new HttpError(409, 'A volunteer-fund settlement rule must identify a volunteer fund.', {
      code: 'COMPENSATION_SETTLEMENT_RULE_INVALID',
      ruleId: Number(rule.id),
    });
  }

  return {
    destination: destination as CompensationSettlementDestination,
    fundId: destination === 'volunteer_fund' ? fundId : null,
    targetScope,
    matchKind,
  };
};

const buildEffectiveRuleWhere = (
  effectiveDate: string,
): WhereOptions => ({
  isActive: true,
  [Op.and]: [
    {
      [Op.or]: [
        { effectiveStart: null },
        { effectiveStart: { [Op.lte]: effectiveDate } },
      ],
    },
    {
      [Op.or]: [
        { effectiveEnd: null },
        { effectiveEnd: { [Op.gte]: effectiveDate } },
      ],
    },
  ],
});

const resolveFromRules = (
  rules: readonly SettlementRuleRecord[],
  context: NormalizedRoutingContext,
): CompensationSettlementRoutingResult => {
  const selectedRule = rules
    .filter((rule) => (
      ruleIsEffective(rule, context.effectiveDate)
      && ruleMatchesScope(rule, context)
      && ruleMatchesInput(rule, context)
    ))
    .sort(compareRules)[0];

  if (!selectedRule) {
    throw new HttpError(
      409,
      'No active compensation settlement rule matches this item. Configure a rule before settlement.',
      {
        code: 'COMPENSATION_SETTLEMENT_RULE_REQUIRED',
        componentId: context.componentId,
        systemSource: context.systemSource,
        componentCategory: context.componentCategory,
      },
    );
  }

  const selected = validateSelectedRule(selectedRule);
  return {
    destination: selected.destination,
    fundId: selected.fundId,
    ruleId: Number(selectedRule.id),
    targetScope: selected.targetScope,
    matchKind: selected.matchKind,
    context,
  };
};

export const loadCompensationSettlementRouter = async (
  input: LoadCompensationSettlementRouterInput,
): Promise<CompensationSettlementRouter> => {
  const effectiveDate = normalizeEffectiveDate(input.effectiveDate);
  const rules = await CompensationSettlementRule.findAll({
    where: buildEffectiveRuleWhere(effectiveDate),
    ...(input.transaction
      ? {
          transaction: input.transaction,
          // Keep an in-flight settlement on the routing revision it validated.
          // Rule edits wait for the settlement transaction to finish.
          lock: input.transaction.LOCK.SHARE,
        }
      : {}),
  });
  const loadedRules = [...rules] as unknown as SettlementRuleRecord[];

  return {
    effectiveDate,
    resolve: (routingInput) => resolveFromRules(
      loadedRules,
      normalizeContext({ ...routingInput, effectiveDate }),
    ),
  };
};

export const resolveCompensationSettlementRoute = async (
  input: CompensationSettlementRoutingInput,
): Promise<CompensationSettlementRoutingResult> => {
  normalizeContext(input);
  const router = await loadCompensationSettlementRouter({
    effectiveDate: input.effectiveDate,
    ...(input.transaction ? { transaction: input.transaction } : {}),
  });
  return router.resolve({
    userId: input.userId,
    staffType: input.staffType,
    componentId: input.componentId,
    systemSource: input.systemSource,
    componentCategory: input.componentCategory,
  });
};
