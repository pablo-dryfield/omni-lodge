export type CompensationEarningBreakdownEntry = {
  date: string;
  amount: number;
};

export type CompensationEligibilityPeriod = {
  userId: number;
  effectiveStart: string;
  effectiveEnd: string | null;
};

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

const isIsoDate = (value: string): boolean => {
  if (!ISO_DATE_PATTERN.test(value)) {
    return false;
  }
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
};

const nextIsoDate = (value: string): string => {
  const parsed = new Date(`${value}T12:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
};

export const enumerateInclusiveIsoDates = (
  startDate: string,
  endDate: string,
): string[] => {
  if (!isIsoDate(startDate) || !isIsoDate(endDate) || endDate < startDate) {
    return [];
  }
  const dates: string[] = [];
  let cursor = startDate;
  while (cursor <= endDate) {
    dates.push(cursor);
    cursor = nextIsoDate(cursor);
  }
  return dates;
};

/**
 * Expands only persisted eligibility periods. An empty period list remains an
 * empty index: callers must not substitute a mutable current projection for
 * missing historical evidence.
 */
export const buildCompensationEligibilityDateIndex = (
  periods: CompensationEligibilityPeriod[],
  rangeStart: string,
  rangeEnd: string,
): Map<number, Set<string>> => {
  const index = new Map<number, Set<string>>();
  if (!isIsoDate(rangeStart) || !isIsoDate(rangeEnd) || rangeEnd < rangeStart) {
    return index;
  }
  periods.forEach((period) => {
    if (
      !Number.isSafeInteger(period.userId)
      || period.userId <= 0
      || !isIsoDate(period.effectiveStart)
      || (period.effectiveEnd !== null && !isIsoDate(period.effectiveEnd))
    ) {
      return;
    }
    const effectiveEnd = period.effectiveEnd ?? rangeEnd;
    const overlapStart = period.effectiveStart > rangeStart ? period.effectiveStart : rangeStart;
    const overlapEnd = effectiveEnd < rangeEnd ? effectiveEnd : rangeEnd;
    const dates = enumerateInclusiveIsoDates(overlapStart, overlapEnd);
    if (dates.length === 0) {
      return;
    }
    const userDates = index.get(period.userId) ?? new Set<string>();
    dates.forEach((date) => userDates.add(date));
    index.set(period.userId, userDates);
  });
  return index;
};

export const restrictCompensationEligibilityDateIndex = (
  index: ReadonlyMap<number, ReadonlySet<string>>,
  rangeStart: string,
  rangeEnd: string,
): Map<number, Set<string>> => {
  const restricted = new Map<number, Set<string>>();
  if (!isIsoDate(rangeStart) || !isIsoDate(rangeEnd) || rangeEnd < rangeStart) {
    return restricted;
  }
  index.forEach((dates, userId) => {
    const eligibleDates = new Set(
      Array.from(dates).filter((date) => isIsoDate(date) && date >= rangeStart && date <= rangeEnd),
    );
    if (eligibleDates.size > 0) {
      restricted.set(userId, eligibleDates);
    }
  });
  return restricted;
};

export const mergeCompensationEarningBreakdown = (
  entries: CompensationEarningBreakdownEntry[],
): CompensationEarningBreakdownEntry[] => {
  const minorByDate = new Map<string, number>();
  entries.forEach((entry) => {
    if (!isIsoDate(entry.date) || !Number.isFinite(entry.amount)) {
      return;
    }
    minorByDate.set(
      entry.date,
      (minorByDate.get(entry.date) ?? 0) + Math.round(entry.amount * 100),
    );
  });
  return Array.from(minorByDate.entries())
    .filter(([, amountMinor]) => amountMinor !== 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, amountMinor]) => ({ date, amount: amountMinor / 100 }));
};

export const allocateCompensationAmountAcrossDates = (
  amount: number,
  dates: Iterable<string>,
): CompensationEarningBreakdownEntry[] => {
  const uniqueDates = Array.from(new Set(Array.from(dates).filter(isIsoDate))).sort();
  if (!Number.isFinite(amount) || uniqueDates.length === 0) {
    return [];
  }
  const totalMinor = Math.round(amount * 100);
  if (totalMinor === 0) {
    return [];
  }
  const sign = totalMinor < 0 ? -1 : 1;
  const absoluteMinor = Math.abs(totalMinor);
  const baseMinor = Math.floor(absoluteMinor / uniqueDates.length);
  const remainder = absoluteMinor % uniqueDates.length;
  return uniqueDates.map((date, index) => ({
    date,
    amount: sign * (baseMinor + (index < remainder ? 1 : 0)) / 100,
  }));
};

export const allocateCompensationAmountByDateWeights = (
  amount: number,
  weights: Iterable<{ date: string; weight: number }>,
): CompensationEarningBreakdownEntry[] => {
  const weightByDate = new Map<string, number>();
  Array.from(weights).forEach(({ date, weight }) => {
    if (!isIsoDate(date) || !Number.isFinite(weight) || weight <= 0) {
      return;
    }
    weightByDate.set(date, (weightByDate.get(date) ?? 0) + weight);
  });
  const normalizedWeights = Array.from(weightByDate.entries())
    .map(([date, weight]) => ({ date, weight }))
    .sort((left, right) => left.date.localeCompare(right.date));
  if (!Number.isFinite(amount) || normalizedWeights.length === 0) {
    return [];
  }
  const totalMinor = Math.round(amount * 100);
  if (totalMinor === 0) {
    return [];
  }
  const totalWeight = normalizedWeights.reduce((sum, entry) => sum + entry.weight, 0);
  const sign = totalMinor < 0 ? -1 : 1;
  const absoluteMinor = Math.abs(totalMinor);
  const allocations = normalizedWeights.map((entry) => {
    const exactMinor = absoluteMinor * (entry.weight / totalWeight);
    const amountMinor = Math.floor(exactMinor);
    return {
      date: entry.date,
      amountMinor,
      remainder: exactMinor - amountMinor,
    };
  });
  let remainingMinor = absoluteMinor - allocations.reduce((sum, entry) => sum + entry.amountMinor, 0);
  const remainderOrder = [...allocations].sort((left, right) =>
    right.remainder - left.remainder || left.date.localeCompare(right.date),
  );
  for (let index = 0; remainingMinor > 0; index += 1) {
    remainderOrder[index % remainderOrder.length].amountMinor += 1;
    remainingMinor -= 1;
  }
  return allocations
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((entry) => ({ date: entry.date, amount: sign * entry.amountMinor / 100 }));
};

export const scaleCompensationEarningBreakdown = (
  entries: CompensationEarningBreakdownEntry[],
  targetAmount: number,
): CompensationEarningBreakdownEntry[] => {
  const merged = mergeCompensationEarningBreakdown(entries);
  if (merged.length === 0) {
    return [];
  }
  return allocateCompensationAmountByDateWeights(
    targetAmount,
    merged.map((entry) => ({ date: entry.date, weight: Math.abs(entry.amount) })),
  );
};
