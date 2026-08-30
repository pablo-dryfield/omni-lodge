import type {
  CompensationCalculationMethod,
  CompensationComponentCategory,
} from '../models/CompensationComponent.js';
import {
  STAFF_PAYOUT_SETTLEMENT_SNAPSHOT_LEGACY_VERSION,
  type StaffPayoutSettlementSnapshotV1,
} from '../types/StaffPayoutSettlementSnapshot.js';
import { normalizeStaffPayoutSettlementSnapshot } from './staffPayoutSettlementSnapshotService.js';

export const LEGACY_SETTLED_PAYOUT_SNAPSHOT_CUTOVER = '2026-08-01' as const;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_CODE = /^[A-Z]{3}$/;

export type AuthoritativeLegacySettledPayoutSnapshotInput = {
  settlementSnapshot: unknown;
  rangeStart: unknown;
  rangeEnd: unknown;
  ledgerCurrency: unknown;
  dueAmountMinor: unknown;
  ledgerPaidAmountMinor: unknown;
  canonicalPaidAmountMinor: unknown;
  liveFundAllocatedAmountMinor: unknown;
};

export type LegacySettledPayoutComponentDefinition = {
  id: number;
  name: string;
  category: CompensationComponentCategory;
  calculationMethod: CompensationCalculationMethod;
  isActive?: boolean;
};

export type LegacySettledPayoutSettlementSource = {
  sourceKey: string;
  label: string;
  componentId: number | null;
  segmentKey: null;
  earningStart: null;
  earningEnd: null;
  staffTypePeriodId: null;
  staffType: null;
  legacyExtrapolation: false;
  referenceIds: number[];
  category: string;
  amount: number;
  destination: 'staff_vendor' | 'volunteer_fund' | 'excluded';
  fundId: number | null;
  fundName: string | null;
  ruleId: number;
  settledAmount: number;
  allocatedAmount: 0;
  outstandingAmount: 0;
  overallocatedAmount: 0;
  currency: string;
  allocatedFundIds: number[];
  routeChanged: false;
  settlementIntent: null;
};

export type LegacySettledPayoutComponentTotal = {
  componentId: number;
  name: string;
  category: CompensationComponentCategory;
  calculationMethod: CompensationCalculationMethod;
  amount: number;
};

export type LegacySettledPayoutSnapshotPresentation = {
  settlementSources: LegacySettledPayoutSettlementSource[];
  componentTotals: LegacySettledPayoutComponentTotal[];
  bucketTotals: Record<string, number>;
  grossBucketTotals: Record<string, number>;
  fundBucketTotals: Record<string, number>;
  totalCommission: number;
  totalPayout: number;
  grossCompensationTotal: number;
  personalPayableTotal: number;
  volunteerFundAllocationTotal: number;
  volunteerFundAllocatedTotal: 0;
  volunteerFundOutstandingTotal: 0;
  volunteerFundOverallocatedTotal: 0;
  excludedSettlementTotal: number;
};

const normalizeDateOnly = (value: unknown): string | null => {
  if (typeof value !== 'string' || !DATE_ONLY.test(value)) {
    return null;
  }
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day
    ? value
    : null;
};

const normalizeCurrency = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toUpperCase();
  return CURRENCY_CODE.test(normalized) ? normalized : null;
};

const isNonnegativeSafeInteger = (value: unknown): value is number => (
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
);

const addSafeMinor = (left: number, right: number): number | null => {
  const result = left + right;
  return Number.isSafeInteger(result) ? result : null;
};

/**
 * Adopts a v1 source snapshot as the read authority only when the payout is
 * provably frozen and fully settled on both the persisted ledger and the live
 * canonical payment ledger. Newer, open, partial, or fund-routed periods must
 * continue through the normal earning-date reconciliation path.
 */
export const resolveAuthoritativeLegacySettledPayoutSnapshot = (
  input: AuthoritativeLegacySettledPayoutSnapshotInput,
): StaffPayoutSettlementSnapshotV1 | null => {
  const rangeStart = normalizeDateOnly(input.rangeStart);
  const rangeEnd = normalizeDateOnly(input.rangeEnd);
  const ledgerCurrency = normalizeCurrency(input.ledgerCurrency);
  if (
    !rangeStart
    || !rangeEnd
    || rangeEnd < rangeStart
    || rangeEnd >= LEGACY_SETTLED_PAYOUT_SNAPSHOT_CUTOVER
    || !ledgerCurrency
    || !isNonnegativeSafeInteger(input.dueAmountMinor)
    || !isNonnegativeSafeInteger(input.ledgerPaidAmountMinor)
    || !isNonnegativeSafeInteger(input.canonicalPaidAmountMinor)
    || !isNonnegativeSafeInteger(input.liveFundAllocatedAmountMinor)
    || input.ledgerPaidAmountMinor !== input.dueAmountMinor
    || input.canonicalPaidAmountMinor !== input.dueAmountMinor
    || input.liveFundAllocatedAmountMinor !== 0
  ) {
    return null;
  }

  const normalized = normalizeStaffPayoutSettlementSnapshot(input.settlementSnapshot, {
    rangeStart,
    rangeEnd,
  });
  if (
    !normalized
    || normalized.version !== STAFF_PAYOUT_SETTLEMENT_SNAPSHOT_LEGACY_VERSION
    || normalized.sources.length === 0
  ) {
    return null;
  }

  let personalDueMinor = 0;
  for (const source of normalized.sources) {
    if (source.currency !== ledgerCurrency) {
      return null;
    }
    if (source.destination === 'volunteer_fund' && source.grossAmountMinor !== 0) {
      return null;
    }
    if (source.destination === 'staff_vendor') {
      const nextPersonalDueMinor = addSafeMinor(personalDueMinor, source.grossAmountMinor);
      if (nextPersonalDueMinor === null) {
        return null;
      }
      personalDueMinor = nextPersonalDueMinor;
    }
  }

  return personalDueMinor === input.dueAmountMinor ? normalized : null;
};

const SYSTEM_SOURCE_LABELS: Readonly<Record<string, string>> = {
  guide_commission: 'Guide commission',
  promotion_sales: 'Promotion Sales',
  reimbursement: 'Reimbursements',
};

const sourceLabel = (
  sourceKey: string,
  componentId: number | null,
  component: LegacySettledPayoutComponentDefinition | null,
): string => {
  if (component) {
    return component.name;
  }
  if (sourceKey === 'compensation_component' && componentId !== null) {
    return `Compensation component #${componentId}`;
  }
  const knownLabel = SYSTEM_SOURCE_LABELS[sourceKey];
  if (knownLabel) {
    return knownLabel;
  }
  return sourceKey
    .split(/[_:-]+/g)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
};

const minorToMajor = (amountMinor: number): number => amountMinor / 100;

const addBucketAmount = (
  buckets: Map<string, number>,
  category: string,
  amountMinor: number,
): boolean => {
  const next = addSafeMinor(buckets.get(category) ?? 0, amountMinor);
  if (next === null) {
    return false;
  }
  buckets.set(category, next);
  return true;
};

const serializeBuckets = (buckets: Map<string, number>): Record<string, number> => (
  Object.fromEntries(
    Array.from(buckets.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([category, amountMinor]) => [category, minorToMajor(amountMinor)]),
  )
);

const COMPONENT_CATEGORIES = new Set<CompensationComponentCategory>([
  'base',
  'commission',
  'incentive',
  'bonus',
  'review',
  'deduction',
  'adjustment',
]);

const snapshotComponentCategory = (
  value: string,
  fallback: CompensationComponentCategory,
): CompensationComponentCategory => (
  COMPONENT_CATEGORIES.has(value as CompensationComponentCategory)
    ? value as CompensationComponentCategory
    : fallback
);

/**
 * Produces a read-only, controller-friendly representation of a frozen v1
 * snapshot. It deliberately creates no settlement intents and exposes no
 * outstanding amount: the resolver already proved that the personal balance
 * was settled in full. Component rows are aggregated by component ID so a
 * historical component split across multiple snapshot rows appears once.
 */
export const buildLegacySettledPayoutSnapshotPresentation = (
  snapshot: StaffPayoutSettlementSnapshotV1,
  componentDefinitions: readonly LegacySettledPayoutComponentDefinition[],
  fundNamesById: ReadonlyMap<number, string> = new Map(),
): LegacySettledPayoutSnapshotPresentation | null => {
  const normalized = normalizeStaffPayoutSettlementSnapshot(snapshot);
  if (!normalized || normalized.version !== STAFF_PAYOUT_SETTLEMENT_SNAPSHOT_LEGACY_VERSION) {
    return null;
  }

  const componentsById = new Map<number, LegacySettledPayoutComponentDefinition>();
  for (const definition of componentDefinitions) {
    if (
      !Number.isSafeInteger(definition.id)
      || definition.id <= 0
      || typeof definition.name !== 'string'
      || definition.name.trim().length === 0
      || componentsById.has(definition.id)
    ) {
      return null;
    }
    componentsById.set(definition.id, {
      ...definition,
      name: definition.name.trim(),
    });
  }

  const grossBucketsMinor = new Map<string, number>();
  const personalBucketsMinor = new Map<string, number>();
  const fundBucketsMinor = new Map<string, number>();
  const componentTotalsMinor = new Map<number, { amountMinor: number; category: string }>();
  const settlementSources: LegacySettledPayoutSettlementSource[] = [];
  let grossTotalMinor = 0;
  let personalTotalMinor = 0;
  let fundTotalMinor = 0;
  let excludedTotalMinor = 0;
  let guideCommissionMinor = 0;

  for (const source of normalized.sources) {
    const component = source.componentId === null
      ? null
      : componentsById.get(source.componentId) ?? null;

    const nextGrossTotal = addSafeMinor(grossTotalMinor, source.grossAmountMinor);
    if (nextGrossTotal === null || !addBucketAmount(
      grossBucketsMinor,
      source.category,
      source.grossAmountMinor,
    )) {
      return null;
    }
    grossTotalMinor = nextGrossTotal;

    if (source.destination === 'staff_vendor') {
      const nextPersonalTotal = addSafeMinor(personalTotalMinor, source.grossAmountMinor);
      if (nextPersonalTotal === null || !addBucketAmount(
        personalBucketsMinor,
        source.category,
        source.grossAmountMinor,
      )) {
        return null;
      }
      personalTotalMinor = nextPersonalTotal;
    } else if (source.destination === 'volunteer_fund') {
      const nextFundTotal = addSafeMinor(fundTotalMinor, source.grossAmountMinor);
      if (nextFundTotal === null || !addBucketAmount(
        fundBucketsMinor,
        source.category,
        source.grossAmountMinor,
      )) {
        return null;
      }
      fundTotalMinor = nextFundTotal;
    } else {
      const nextExcludedTotal = addSafeMinor(excludedTotalMinor, source.grossAmountMinor);
      if (nextExcludedTotal === null) {
        return null;
      }
      excludedTotalMinor = nextExcludedTotal;
    }

    if (source.componentId !== null) {
      const existingComponent = componentTotalsMinor.get(source.componentId);
      if (existingComponent && existingComponent.category !== source.category) {
        return null;
      }
      const nextComponentTotal = addSafeMinor(
        existingComponent?.amountMinor ?? 0,
        source.grossAmountMinor,
      );
      if (nextComponentTotal === null) {
        return null;
      }
      componentTotalsMinor.set(source.componentId, {
        amountMinor: nextComponentTotal,
        category: source.category,
      });
    }

    if (source.sourceKey === 'guide_commission') {
      const nextGuideCommission = addSafeMinor(guideCommissionMinor, source.grossAmountMinor);
      if (nextGuideCommission === null) {
        return null;
      }
      guideCommissionMinor = nextGuideCommission;
    }

    const amount = minorToMajor(source.grossAmountMinor);
    settlementSources.push({
      sourceKey: source.sourceKey,
      label: sourceLabel(source.sourceKey, source.componentId, component),
      componentId: source.componentId,
      segmentKey: null,
      earningStart: null,
      earningEnd: null,
      staffTypePeriodId: null,
      staffType: null,
      legacyExtrapolation: false,
      referenceIds: [],
      category: source.category,
      amount,
      destination: source.destination,
      fundId: source.fundId,
      fundName: source.fundId === null ? null : fundNamesById.get(source.fundId) ?? null,
      ruleId: source.ruleId,
      settledAmount: source.destination === 'staff_vendor' ? Math.max(amount, 0) : 0,
      allocatedAmount: 0,
      outstandingAmount: 0,
      overallocatedAmount: 0,
      currency: source.currency,
      allocatedFundIds: [],
      routeChanged: false,
      settlementIntent: null,
    });
  }

  const componentTotals = Array.from(componentTotalsMinor.entries())
    .sort(([left], [right]) => left - right)
    .map(([componentId, aggregate]) => {
      const definition = componentsById.get(componentId) ?? null;
      return {
        componentId,
        name: definition?.name ?? `Compensation component #${componentId}`,
        category: snapshotComponentCategory(
          aggregate.category,
          definition?.category ?? 'adjustment',
        ),
        calculationMethod: definition?.calculationMethod ?? 'flat',
        amount: minorToMajor(aggregate.amountMinor),
      };
    });

  return {
    settlementSources,
    componentTotals,
    bucketTotals: serializeBuckets(personalBucketsMinor),
    grossBucketTotals: serializeBuckets(grossBucketsMinor),
    fundBucketTotals: serializeBuckets(fundBucketsMinor),
    totalCommission: minorToMajor(guideCommissionMinor),
    totalPayout: minorToMajor(personalTotalMinor),
    grossCompensationTotal: minorToMajor(grossTotalMinor),
    personalPayableTotal: minorToMajor(personalTotalMinor),
    volunteerFundAllocationTotal: minorToMajor(fundTotalMinor),
    volunteerFundAllocatedTotal: 0,
    volunteerFundOutstandingTotal: 0,
    volunteerFundOverallocatedTotal: 0,
    excludedSettlementTotal: minorToMajor(excludedTotalMinor),
  };
};
