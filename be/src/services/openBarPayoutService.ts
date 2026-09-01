export type OpenBarGuestType = 'normal' | 'cocktail' | 'brunch';
export type OpenBarRateUnit = 'per_person' | 'flat';
export type OpenBarRateSource = 'ticket_rate' | 'generic_rate' | 'term_default';

export type OpenBarCounts = Record<OpenBarGuestType, number>;

type OpenBarTermLike = {
  rateAmount: number | string | null;
  rateUnit: OpenBarRateUnit | null;
};

type OpenBarRateLike = {
  id?: number | null;
  productId: number | null;
  ticketType: OpenBarGuestType | 'generic';
  rateAmount: number | string | null;
  rateUnit: OpenBarRateUnit;
  validFrom: string | null;
  validTo: string | null;
};

export type OpenBarPayoutBand = {
  ticketType: OpenBarGuestType | 'generic';
  configuredTicketType: OpenBarGuestType | 'generic';
  count: number;
  rateBandId: number | null;
  rateAmount: number;
  rateUnit: OpenBarRateUnit;
  source: OpenBarRateSource;
  amount: number;
};

const guestTypes: OpenBarGuestType[] = ['normal', 'cocktail', 'brunch'];

const roundToCents = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value * 100) / 100;
};

const normalizeCount = (value: number): number => (
  Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : 0
);

const compareEffectiveRates = (left: OpenBarRateLike, right: OpenBarRateLike): number => {
  const dateDifference = String(right.validFrom ?? '').localeCompare(String(left.validFrom ?? ''));
  if (dateDifference !== 0) {
    return dateDifference;
  }
  return Number(right.id ?? 0) - Number(left.id ?? 0);
};

const isEffectiveOn = (rate: OpenBarRateLike, date: string): boolean => (
  (!rate.validFrom || rate.validFrom <= date) && (!rate.validTo || rate.validTo >= date)
);

export type PersistedOpenBarPayoutBand = {
  ticketType: OpenBarGuestType | 'generic';
  count: number;
  rateAmount: number;
  rateUnit: OpenBarRateUnit;
  source: OpenBarRateSource;
};

/**
 * Compatibility calculator used when persisting Night Report payouts.
 *
 * Its selection behavior is intentionally frozen so this Booking Summary
 * enhancement cannot alter staff-entered Night Report compensation. The
 * stricter read-only resolver below is used only to explain historical rows.
 */
export const computePersistedOpenBarPayout = (
  term: OpenBarTermLike,
  rates: OpenBarRateLike[],
  counts: OpenBarCounts,
  productId: number | null,
  referenceDate: string,
): { total: number; breakdown: PersistedOpenBarPayoutBand[] } => {
  const contributions: number[] = [];
  const breakdown: PersistedOpenBarPayoutBand[] = [];

  const selectLegacyRate = (ticketType: OpenBarGuestType | 'generic'): OpenBarRateLike | null => {
    const filtered = rates.filter((rate) => {
      const matchesTicket = rate.ticketType === ticketType
        || (ticketType !== 'generic' && rate.ticketType === 'generic');
      return matchesTicket && isEffectiveOn(rate, referenceDate);
    });
    if (filtered.length === 0) return null;

    const productMatches = productId
      ? filtered.filter((rate) => rate.productId === productId)
      : [];
    const globalMatches = filtered.filter((rate) => rate.productId == null);
    const candidates = productMatches.length > 0
      ? productMatches
      : globalMatches.length > 0
        ? globalMatches
        : filtered;
    return candidates[0] ?? null;
  };

  const applyLegacyRate = (ticketType: OpenBarGuestType, rawCount: number) => {
    const count = normalizeCount(rawCount);
    if (count <= 0) return;
    const rate = selectLegacyRate(ticketType);
    if (!rate) {
      const genericRate = selectLegacyRate('generic');
      if (!genericRate) return;
      const rateAmount = roundToCents(Number(genericRate.rateAmount ?? 0));
      const rateUnit: OpenBarRateUnit = genericRate.rateUnit === 'flat' ? 'flat' : 'per_person';
      const units = rateUnit === 'flat' ? 1 : count;
      contributions.push(roundToCents(rateAmount * units));
      breakdown.push({ ticketType, count, rateAmount, rateUnit, source: 'generic_rate' });
      return;
    }
    const rateAmount = roundToCents(Number(rate.rateAmount ?? 0));
    const rateUnit: OpenBarRateUnit = rate.rateUnit === 'flat' ? 'flat' : 'per_person';
    const units = rateUnit === 'flat' ? 1 : count;
    contributions.push(roundToCents(rateAmount * units));
    breakdown.push({ ticketType, count, rateAmount, rateUnit, source: 'ticket_rate' });
  };

  applyLegacyRate('normal', counts.normal);
  applyLegacyRate('cocktail', counts.cocktail);
  applyLegacyRate('brunch', counts.brunch);

  if (contributions.length === 0) {
    const fallbackRate = selectLegacyRate('generic');
    const totalCount = normalizeCount(counts.normal)
      + normalizeCount(counts.cocktail)
      + normalizeCount(counts.brunch);
    if (fallbackRate) {
      const rateAmount = roundToCents(Number(fallbackRate.rateAmount ?? 0));
      const rateUnit: OpenBarRateUnit = fallbackRate.rateUnit === 'flat' ? 'flat' : 'per_person';
      const units = rateUnit === 'flat' ? 1 : totalCount;
      contributions.push(roundToCents(rateAmount * units));
      breakdown.push({
        ticketType: 'generic',
        count: totalCount,
        rateAmount,
        rateUnit,
        source: 'generic_rate',
      });
    } else {
      const rateAmount = roundToCents(Number(term.rateAmount ?? 0));
      const rateUnit: OpenBarRateUnit = term.rateUnit === 'flat' ? 'flat' : 'per_person';
      const units = rateUnit === 'flat' ? 1 : totalCount;
      contributions.push(roundToCents(rateAmount * units));
      breakdown.push({
        ticketType: 'normal',
        count: totalCount,
        rateAmount,
        rateUnit,
        source: 'term_default',
      });
    }
  }

  return {
    total: contributions.reduce((sum, amount) => sum + amount, 0),
    breakdown,
  };
};

const selectRate = (
  rates: OpenBarRateLike[],
  ticketType: OpenBarGuestType,
  productId: number | null,
  referenceDate: string,
): OpenBarRateLike | null => {
  const effectiveRates = rates.filter((rate) => isEffectiveOn(rate, referenceDate));
  const tiers: OpenBarRateLike[][] = [];

  if (productId != null) {
    tiers.push(
      effectiveRates.filter((rate) => rate.productId === productId && rate.ticketType === ticketType),
      effectiveRates.filter((rate) => rate.productId === productId && rate.ticketType === 'generic'),
    );
  }

  tiers.push(
    effectiveRates.filter((rate) => rate.productId == null && rate.ticketType === ticketType),
    effectiveRates.filter((rate) => rate.productId == null && rate.ticketType === 'generic'),
  );

  for (const tier of tiers) {
    if (tier.length > 0) {
      return tier.slice().sort(compareEffectiveRates)[0] ?? null;
    }
  }

  return null;
};

const buildBand = (
  ticketType: OpenBarGuestType,
  count: number,
  rate: OpenBarRateLike,
): OpenBarPayoutBand => {
  const rateAmount = roundToCents(Number(rate.rateAmount ?? 0));
  const rateUnit: OpenBarRateUnit = rate.rateUnit === 'flat' ? 'flat' : 'per_person';
  const units = rateUnit === 'flat' ? 1 : count;
  return {
    ticketType,
    configuredTicketType: rate.ticketType,
    count,
    rateBandId: Number.isInteger(Number(rate.id)) && Number(rate.id) > 0 ? Number(rate.id) : null,
    rateAmount,
    rateUnit,
    source: rate.ticketType === ticketType ? 'ticket_rate' : 'generic_rate',
    amount: roundToCents(rateAmount * units),
  };
};

/**
 * Resolve Open Bar payout components using explicit, non-overlapping precedence:
 * product guest type -> product generic -> global guest type -> global generic -> term default.
 * Rates for a different product are never used as a fallback.
 */
export const resolveOpenBarRateBands = (
  term: OpenBarTermLike,
  rates: OpenBarRateLike[],
  counts: OpenBarCounts,
  productId: number | null,
  referenceDate: string,
): { total: number; breakdown: OpenBarPayoutBand[] } => {
  const positiveCounts = guestTypes
    .map((ticketType) => ({ ticketType, count: normalizeCount(counts[ticketType]) }))
    .filter((entry) => entry.count > 0);

  if (positiveCounts.length === 0) {
    return { total: 0, breakdown: [] };
  }

  const selectedRates = positiveCounts.map((entry) => ({
    ...entry,
    rate: selectRate(rates, entry.ticketType, productId, referenceDate),
  }));
  const hasConfiguredRate = selectedRates.some((entry) => entry.rate != null);
  const defaultRateAmount = roundToCents(Number(term.rateAmount ?? 0));
  const defaultRateUnit: OpenBarRateUnit = term.rateUnit === 'flat' ? 'flat' : 'per_person';

  // A flat term default describes one venue payout. Keep it as one component when
  // no explicit rate band applies, instead of multiplying it by the guest types.
  if (!hasConfiguredRate && defaultRateUnit === 'flat') {
    const totalCount = positiveCounts.reduce((sum, entry) => sum + entry.count, 0);
    const band: OpenBarPayoutBand = {
      ticketType: 'generic',
      configuredTicketType: 'generic',
      count: totalCount,
      rateBandId: null,
      rateAmount: defaultRateAmount,
      rateUnit: 'flat',
      source: 'term_default',
      amount: defaultRateAmount,
    };
    return { total: band.amount, breakdown: [band] };
  }

  const breakdown = selectedRates.map(({ ticketType, count, rate }): OpenBarPayoutBand => {
    if (rate) {
      return buildBand(ticketType, count, rate);
    }
    const units = defaultRateUnit === 'flat' ? 1 : count;
    return {
      ticketType,
      configuredTicketType: 'generic',
      count,
      rateBandId: null,
      rateAmount: defaultRateAmount,
      rateUnit: defaultRateUnit,
      source: 'term_default',
      amount: roundToCents(defaultRateAmount * units),
    };
  });

  return {
    total: roundToCents(breakdown.reduce((sum, entry) => sum + entry.amount, 0)),
    breakdown,
  };
};
