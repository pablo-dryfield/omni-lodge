import {
  STAFF_PAYOUT_SETTLEMENT_SNAPSHOT_LEGACY_VERSION,
  STAFF_PAYOUT_SETTLEMENT_SNAPSHOT_SEGMENTED_VERSION,
  type StaffPayoutSettlementSnapshot,
  type StaffPayoutSettlementSnapshotSource,
  type StaffPayoutSettlementSnapshotSourceBase,
  type StaffPayoutSettlementSnapshotSourceV2,
  type StaffPayoutSettlementSnapshotV1,
  type StaffPayoutSettlementSnapshotV2,
} from '../types/StaffPayoutSettlementSnapshot.js';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const IDENTIFIER = /^[a-z0-9][a-z0-9_:-]*$/;

export type NormalizeStaffPayoutSettlementSnapshotOptions = {
  /** Optional ledger bounds used to reject a v2 segment assigned outside it. */
  rangeStart?: string;
  rangeEnd?: string;
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

const normalizeIdentifier = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0
    && normalized.length <= 64
    && IDENTIFIER.test(normalized)
    ? normalized
    : null;
};

const normalizeNullablePositiveInteger = (value: unknown): number | null | undefined => {
  if (value === null) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const normalizeBaseSource = (
  value: unknown,
): StaffPayoutSettlementSnapshotSourceBase | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const source = value as Record<string, unknown>;
  const sourceKey = normalizeIdentifier(source.sourceKey);
  const category = normalizeIdentifier(source.category);
  const componentId = normalizeNullablePositiveInteger(source.componentId);
  const fundId = normalizeNullablePositiveInteger(source.fundId);
  const grossAmountMinor = Number(source.grossAmountMinor);
  const ruleId = Number(source.ruleId);
  const destination = source.destination;
  const currency = typeof source.currency === 'string'
    ? source.currency.trim().toUpperCase()
    : '';

  if (
    !sourceKey
    || !category
    || componentId === undefined
    || fundId === undefined
    || !Number.isSafeInteger(grossAmountMinor)
    || !Number.isSafeInteger(ruleId)
    || ruleId <= 0
    || !/^[A-Z]{3}$/.test(currency)
    || (
      destination !== 'staff_vendor'
      && destination !== 'volunteer_fund'
      && destination !== 'excluded'
    )
  ) {
    return null;
  }

  return {
    sourceKey,
    componentId,
    category,
    grossAmountMinor,
    destination,
    fundId,
    ruleId,
    currency,
  };
};

const normalizeV2Source = (
  value: unknown,
  options: NormalizeStaffPayoutSettlementSnapshotOptions,
): StaffPayoutSettlementSnapshotSourceV2 | null => {
  const base = normalizeBaseSource(value);
  if (!base || !value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const source = value as Record<string, unknown>;
  const segmentKey = normalizeIdentifier(source.segmentKey);
  const earningStart = normalizeDateOnly(source.earningStart);
  const earningEnd = normalizeDateOnly(source.earningEnd);
  const staffTypePeriodId = normalizeNullablePositiveInteger(source.staffTypePeriodId);
  const staffType = normalizeIdentifier(source.staffType);

  if (
    !segmentKey
    || !earningStart
    || !earningEnd
    || earningEnd < earningStart
    || staffTypePeriodId == null
    || !staffType
    || typeof source.legacyExtrapolation !== 'boolean'
    || (options.rangeStart !== undefined && earningStart < options.rangeStart)
    || (options.rangeEnd !== undefined && earningEnd > options.rangeEnd)
  ) {
    return null;
  }

  return {
    ...base,
    segmentKey,
    earningStart,
    earningEnd,
    staffTypePeriodId,
    staffType,
    legacyExtrapolation: source.legacyExtrapolation,
  };
};

const sourceSortKey = (source: StaffPayoutSettlementSnapshotSource): string => [
  source.sourceKey,
  source.category,
  String(source.componentId ?? 0).padStart(16, '0'),
  source.segmentKey ?? '',
  source.earningStart ?? '',
  source.earningEnd ?? '',
  String(source.staffTypePeriodId ?? 0).padStart(16, '0'),
  source.staffType ?? '',
  source.legacyExtrapolation === undefined ? '' : String(source.legacyExtrapolation),
  source.destination,
  String(source.fundId ?? 0).padStart(16, '0'),
  String(source.ruleId).padStart(16, '0'),
  source.currency,
  String(source.grossAmountMinor).padStart(24, '0'),
].join('|');

export const sortStaffPayoutSettlementSnapshotSources = <
  T extends StaffPayoutSettlementSnapshotSource,
>(sources: T[]): T[] => [...sources].sort((left, right) => (
  sourceSortKey(left).localeCompare(sourceSortKey(right))
));

const normalizeOptions = (
  options: NormalizeStaffPayoutSettlementSnapshotOptions,
): NormalizeStaffPayoutSettlementSnapshotOptions | null => {
  const rangeStart = options.rangeStart === undefined
    ? undefined
    : normalizeDateOnly(options.rangeStart);
  const rangeEnd = options.rangeEnd === undefined
    ? undefined
    : normalizeDateOnly(options.rangeEnd);
  if (
    rangeStart === null
    || rangeEnd === null
    || (rangeStart !== undefined && rangeEnd !== undefined && rangeEnd < rangeStart)
  ) {
    return null;
  }
  return { rangeStart, rangeEnd };
};

/**
 * Reads both persisted v1 snapshots and segmented v2 snapshots into a stable,
 * sorted representation. It never upgrades v1 sources by guessing segment
 * history.
 */
export const normalizeStaffPayoutSettlementSnapshot = (
  value: unknown,
  options: NormalizeStaffPayoutSettlementSnapshotOptions = {},
): StaffPayoutSettlementSnapshot | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const normalizedOptions = normalizeOptions(options);
  if (!normalizedOptions) {
    return null;
  }
  const snapshot = value as { version?: unknown; sources?: unknown };
  if (!Array.isArray(snapshot.sources)) {
    return null;
  }

  if (snapshot.version === STAFF_PAYOUT_SETTLEMENT_SNAPSHOT_LEGACY_VERSION) {
    const sources: StaffPayoutSettlementSnapshotSourceBase[] = [];
    for (const source of snapshot.sources) {
      const normalized = normalizeBaseSource(source);
      if (!normalized) {
        return null;
      }
      sources.push(normalized);
    }
    return {
      version: STAFF_PAYOUT_SETTLEMENT_SNAPSHOT_LEGACY_VERSION,
      sources: sortStaffPayoutSettlementSnapshotSources(sources),
    } satisfies StaffPayoutSettlementSnapshotV1;
  }

  if (snapshot.version === STAFF_PAYOUT_SETTLEMENT_SNAPSHOT_SEGMENTED_VERSION) {
    const sources: StaffPayoutSettlementSnapshotSourceV2[] = [];
    const segmentKeys = new Set<string>();
    for (const source of snapshot.sources) {
      const normalized = normalizeV2Source(source, normalizedOptions);
      if (!normalized || segmentKeys.has(normalized.segmentKey)) {
        return null;
      }
      segmentKeys.add(normalized.segmentKey);
      sources.push(normalized);
    }
    return {
      version: STAFF_PAYOUT_SETTLEMENT_SNAPSHOT_SEGMENTED_VERSION,
      sources: sortStaffPayoutSettlementSnapshotSources(sources),
    } satisfies StaffPayoutSettlementSnapshotV2;
  }

  return null;
};

export const buildStaffPayoutSettlementSnapshotV2 = (
  sources: StaffPayoutSettlementSnapshotSourceV2[],
  options: NormalizeStaffPayoutSettlementSnapshotOptions = {},
): StaffPayoutSettlementSnapshotV2 => {
  const snapshot = normalizeStaffPayoutSettlementSnapshot({
    version: STAFF_PAYOUT_SETTLEMENT_SNAPSHOT_SEGMENTED_VERSION,
    sources,
  }, options);
  if (!snapshot || snapshot.version !== STAFF_PAYOUT_SETTLEMENT_SNAPSHOT_SEGMENTED_VERSION) {
    throw new Error('Staff payout settlement snapshot v2 is invalid.');
  }
  return snapshot;
};

export const isStaffPayoutSettlementSnapshotV2 = (
  snapshot: StaffPayoutSettlementSnapshot,
): snapshot is StaffPayoutSettlementSnapshotV2 => (
  snapshot.version === STAFF_PAYOUT_SETTLEMENT_SNAPSHOT_SEGMENTED_VERSION
);

export const staffPayoutSettlementSnapshotsMatch = (
  left: unknown,
  right: unknown,
  options: NormalizeStaffPayoutSettlementSnapshotOptions = {},
): boolean => {
  const normalizedLeft = normalizeStaffPayoutSettlementSnapshot(left, options);
  const normalizedRight = normalizeStaffPayoutSettlementSnapshot(right, options);
  return normalizedLeft !== null
    && normalizedRight !== null
    && JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
};
