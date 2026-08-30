import crypto from 'crypto';

export type StaffTypeEligibilityPeriod = {
  id: number | string;
  staffType: string;
  effectiveStart: string;
  effectiveEnd: string | null;
  legacyExtrapolation?: boolean;
};

export type DatedMinorAmount = {
  date: string;
  amountMinor: number;
};

export type StaffTypeEarningSegment = {
  segmentKey: string;
  staffTypePeriodId: number | string;
  staffType: string;
  partitionKey: string | null;
  earningStart: string;
  earningEnd: string;
  grossAmountMinor: number;
  legacyExtrapolation: boolean;
};

export type StaffPayoutRoutingPartition = {
  ruleId: number;
  destination: 'staff_vendor' | 'volunteer_fund' | 'excluded';
  fundId: number | null;
};

export type RoutedStaffTypeEarningSegment = StaffTypeEarningSegment & {
  routing: StaffPayoutRoutingPartition;
};

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const assertDateOnly = (value: string, field: string): void => {
  if (!DATE_ONLY.test(value)) {
    throw new Error(`${field} must use YYYY-MM-DD.`);
  }
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    throw new Error(`${field} must be a valid calendar date.`);
  }
};

const dateToOrdinal = (value: string): number => {
  assertDateOnly(value, 'date');
  const [year, month, day] = value.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
};

const ordinalToDate = (ordinal: number): string =>
  new Date(ordinal * 86_400_000).toISOString().slice(0, 10);

export const enumerateDateRange = (start: string, end: string): string[] => {
  const first = dateToOrdinal(start);
  const last = dateToOrdinal(end);
  if (last < first) {
    throw new Error('end must be on or after start.');
  }
  const dates: string[] = [];
  for (let cursor = first; cursor <= last; cursor += 1) {
    dates.push(ordinalToDate(cursor));
  }
  return dates;
};

/**
 * Allocates an exact minor-unit total without losing cents. Remainder cents
 * are assigned chronologically, making the result deterministic and auditable.
 */
export const allocateMinorAcrossDates = (
  totalMinor: number,
  dates: string[],
): DatedMinorAmount[] => {
  if (!Number.isSafeInteger(totalMinor)) {
    throw new Error('totalMinor must be an integer.');
  }
  const normalizedDates = Array.from(new Set(dates.map((date) => {
    assertDateOnly(date, 'date');
    return date;
  }))).sort();
  if (normalizedDates.length === 0) {
    return [];
  }
  const sign = totalMinor < 0 ? -1 : 1;
  const absolute = Math.abs(totalMinor);
  const base = Math.floor(absolute / normalizedDates.length);
  const remainder = absolute % normalizedDates.length;
  return normalizedDates.map((date, index) => ({
    date,
    amountMinor: sign * (base + (index < remainder ? 1 : 0)),
  }));
};

export const normalizeDatedMinorAmounts = (
  entries: DatedMinorAmount[],
): DatedMinorAmount[] => {
  const amountByDate = new Map<string, number>();
  entries.forEach((entry) => {
    assertDateOnly(entry.date, 'date');
    if (!Number.isSafeInteger(entry.amountMinor)) {
      throw new Error('amountMinor must be an integer.');
    }
    amountByDate.set(entry.date, (amountByDate.get(entry.date) ?? 0) + entry.amountMinor);
  });
  return Array.from(amountByDate.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, amountMinor]) => ({ date, amountMinor }));
};

const normalizePeriods = (
  periods: StaffTypeEligibilityPeriod[],
): StaffTypeEligibilityPeriod[] => {
  const normalized = periods.map((period) => {
    assertDateOnly(period.effectiveStart, 'effectiveStart');
    if (period.effectiveEnd) {
      assertDateOnly(period.effectiveEnd, 'effectiveEnd');
      if (period.effectiveEnd < period.effectiveStart) {
        throw new Error('A staff-type period cannot end before it starts.');
      }
    }
    const staffType = period.staffType.trim().toLowerCase();
    if (!staffType) {
      throw new Error('staffType is required.');
    }
    return { ...period, staffType };
  }).sort((left, right) => left.effectiveStart.localeCompare(right.effectiveStart));

  normalized.forEach((period, index) => {
    const previous = normalized[index - 1];
    if (previous && (!previous.effectiveEnd || previous.effectiveEnd >= period.effectiveStart)) {
      throw new Error('Staff-type eligibility periods cannot overlap.');
    }
  });
  return normalized;
};

const resolvePeriodForDate = (
  date: string,
  periods: StaffTypeEligibilityPeriod[],
  allowLegacyExtrapolation: boolean,
): StaffTypeEligibilityPeriod | null => {
  const exact = periods.find((period) => (
    period.effectiveStart <= date
    && (!period.effectiveEnd || period.effectiveEnd >= date)
  ));
  if (exact) {
    return exact;
  }
  const first = periods[0];
  if (allowLegacyExtrapolation && first && date < first.effectiveStart) {
    return { ...first, legacyExtrapolation: true };
  }
  return null;
};

const buildSegmentKey = (input: {
  sourceKey: string;
  componentId: number | null;
  staffTypePeriodId: number | string;
  partitionKey: string | null;
}): string => {
  const identity = [
    input.sourceKey,
    input.componentId ?? 0,
    input.staffTypePeriodId,
    input.partitionKey ?? 'default',
  ].join(':');
  return `seg_${crypto.createHash('sha256').update(identity).digest('hex').slice(0, 32)}`;
};

const normalizePartitionKey = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('partitionKey must be a non-empty string when provided.');
  }
  return value.trim().toLowerCase();
};

export const splitDatedEarningsByStaffType = (params: {
  sourceKey: string;
  componentId: number | null;
  earnings: DatedMinorAmount[];
  periods: StaffTypeEligibilityPeriod[];
  allowLegacyExtrapolation?: boolean;
  partitionKeyForDate?: (
    date: string,
    period: StaffTypeEligibilityPeriod,
  ) => string | null;
}): StaffTypeEarningSegment[] => {
  const sourceKey = params.sourceKey.trim().toLowerCase();
  if (!sourceKey) {
    throw new Error('sourceKey is required.');
  }
  const periods = normalizePeriods(params.periods);
  if (periods.length === 0 && params.earnings.some((entry) => entry.amountMinor !== 0)) {
    throw new Error('No staff-type eligibility period covers these earnings.');
  }
  const grouped = new Map<string, {
    period: StaffTypeEligibilityPeriod;
    partitionKey: string | null;
    dates: string[];
    grossAmountMinor: number;
  }>();

  normalizeDatedMinorAmounts(params.earnings).forEach((entry) => {
    if (entry.amountMinor === 0) {
      return;
    }
    const period = resolvePeriodForDate(
      entry.date,
      periods,
      params.allowLegacyExtrapolation ?? false,
    );
    if (!period) {
      throw new Error(`No staff-type eligibility period covers ${entry.date}.`);
    }
    const partitionKey = normalizePartitionKey(
      params.partitionKeyForDate?.(entry.date, period) ?? null,
    );
    const key = JSON.stringify([String(period.id), partitionKey]);
    const current = grouped.get(key) ?? {
      period,
      partitionKey,
      dates: [],
      grossAmountMinor: 0,
    };
    current.dates.push(entry.date);
    current.grossAmountMinor += entry.amountMinor;
    grouped.set(key, current);
  });

  return Array.from(grouped.values())
    .map(({ period, partitionKey, dates, grossAmountMinor }) => {
      const earningStart = dates.slice().sort()[0];
      const earningEnd = dates.slice().sort().at(-1) as string;
      return {
        segmentKey: buildSegmentKey({
          sourceKey,
          componentId: params.componentId,
          staffTypePeriodId: period.id,
          partitionKey,
        }),
        staffTypePeriodId: period.id,
        staffType: period.staffType,
        partitionKey,
        earningStart,
        earningEnd,
        grossAmountMinor,
        legacyExtrapolation: Boolean(period.legacyExtrapolation),
      };
    })
    .sort((left, right) => left.earningStart.localeCompare(right.earningStart));
};

const normalizeRoutingPartition = (
  value: StaffPayoutRoutingPartition | undefined,
  date: string,
): StaffPayoutRoutingPartition => {
  if (!value) {
    throw new Error(`No compensation settlement route covers ${date}.`);
  }
  if (!Number.isSafeInteger(value.ruleId) || value.ruleId <= 0) {
    throw new Error(`The compensation settlement route for ${date} has an invalid rule.`);
  }
  if (
    value.destination !== 'staff_vendor'
    && value.destination !== 'volunteer_fund'
    && value.destination !== 'excluded'
  ) {
    throw new Error(`The compensation settlement route for ${date} has an invalid destination.`);
  }
  if (
    (value.destination === 'volunteer_fund' && (!Number.isSafeInteger(value.fundId) || Number(value.fundId) <= 0))
    || (value.destination !== 'volunteer_fund' && value.fundId !== null)
  ) {
    throw new Error(`The compensation settlement route for ${date} has an invalid fund.`);
  }
  return {
    ruleId: value.ruleId,
    destination: value.destination,
    fundId: value.fundId,
  };
};

/**
 * Adds immutable routing identity to staff-type segmentation. Settlement rules
 * are constrained to full calendar months, so the month bucket both splits at
 * every possible routing boundary and remains stable while an open month gains
 * additional earnings.
 */
export const splitDatedEarningsByStaffTypeAndRouting = (params: {
  sourceKey: string;
  componentId: number | null;
  earnings: DatedMinorAmount[];
  periods: StaffTypeEligibilityPeriod[];
  routingByDate: ReadonlyMap<string, StaffPayoutRoutingPartition>;
  allowLegacyExtrapolation?: boolean;
}): RoutedStaffTypeEarningSegment[] => {
  const routingByPartitionKey = new Map<string, StaffPayoutRoutingPartition>();
  const segments = splitDatedEarningsByStaffType({
    sourceKey: params.sourceKey,
    componentId: params.componentId,
    earnings: params.earnings,
    periods: params.periods,
    allowLegacyExtrapolation: params.allowLegacyExtrapolation,
    partitionKeyForDate: (date) => {
      const routing = normalizeRoutingPartition(params.routingByDate.get(date), date);
      const monthBucket = date.slice(0, 7);
      const partitionKey = [
        'month',
        monthBucket,
        'rule',
        routing.ruleId,
        routing.destination,
        routing.fundId ?? 0,
      ].join(':');
      routingByPartitionKey.set(partitionKey, routing);
      return partitionKey;
    },
  });

  return segments.map((segment) => {
    const routing = segment.partitionKey
      ? routingByPartitionKey.get(segment.partitionKey)
      : undefined;
    if (!routing) {
      throw new Error(`No compensation settlement route covers ${segment.earningStart}.`);
    }
    return { ...segment, routing };
  });
};

export const splitDatedEarningsAtCutoff = (params: {
  earnings: DatedMinorAmount[];
  cutoffDate: string;
}): { before: DatedMinorAmount[]; onOrAfter: DatedMinorAmount[] } => {
  assertDateOnly(params.cutoffDate, 'cutoffDate');
  const before: DatedMinorAmount[] = [];
  const onOrAfter: DatedMinorAmount[] = [];
  normalizeDatedMinorAmounts(params.earnings).forEach((entry) => {
    (entry.date < params.cutoffDate ? before : onOrAfter).push(entry);
  });
  return { before, onOrAfter };
};
