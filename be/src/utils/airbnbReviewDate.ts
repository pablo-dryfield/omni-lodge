export type AirbnbReviewDatePrecision = 'exact' | 'month' | 'relative' | 'fallback';

export type ParsedAirbnbReviewDate = {
  iso: string;
  precision: AirbnbReviewDatePrecision;
  sourceLabel: string | null;
};

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

const amountFromLabel = (value: string): number | null => {
  if (value === 'a' || value === 'an' || value === 'one' || value === 'last') return 1;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const utcDay = (value: Date): Date =>
  new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));

const subtractCalendarMonths = (value: Date, months: number): Date => {
  const result = utcDay(value);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() - months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
};

export const parseAirbnbReviewDate = (
  value?: string | null,
  referenceDate: Date = new Date(),
): ParsedAirbnbReviewDate => {
  const sourceLabel = typeof value === 'string' ? value.trim() : '';
  if (!sourceLabel) {
    return { iso: referenceDate.toISOString(), precision: 'fallback', sourceLabel: null };
  }

  const monthYear = sourceLabel.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (monthYear) {
    const normalizedMonth = monthYear[1].toLowerCase();
    const month = MONTHS.findIndex((candidate) =>
      candidate === normalizedMonth || candidate.slice(0, 3) === normalizedMonth.slice(0, 3),
    );
    if (month >= 0) {
      return {
        iso: new Date(Date.UTC(Number(monthYear[2]), month, 1)).toISOString(),
        precision: 'month',
        sourceLabel,
      };
    }
  }

  const normalized = sourceLabel.toLowerCase().replace(/^about\s+/, '');
  if (normalized === 'just now' || normalized === 'today') {
    return { iso: utcDay(referenceDate).toISOString(), precision: 'relative', sourceLabel };
  }
  if (normalized === 'yesterday') {
    const result = utcDay(referenceDate);
    result.setUTCDate(result.getUTCDate() - 1);
    return { iso: result.toISOString(), precision: 'relative', sourceLabel };
  }

  const relative = normalized.match(/^(a|an|one|last|\d+)\s+(minute|hour|day|week|month|year)s?\s+ago$/);
  if (relative) {
    const amount = amountFromLabel(relative[1]);
    if (amount != null) {
      const unit = relative[2];
      let result: Date;
      if (unit === 'minute' || unit === 'hour') {
        const milliseconds = amount * (unit === 'minute' ? 60_000 : 3_600_000);
        result = new Date(referenceDate.getTime() - milliseconds);
      } else if (unit === 'month') {
        result = subtractCalendarMonths(referenceDate, amount);
      } else if (unit === 'year') {
        result = subtractCalendarMonths(referenceDate, amount * 12);
      } else {
        result = utcDay(referenceDate);
        result.setUTCDate(result.getUTCDate() - amount * (unit === 'week' ? 7 : 1));
      }
      return { iso: result.toISOString(), precision: 'relative', sourceLabel };
    }
  }

  const parsed = new Date(sourceLabel);
  if (!Number.isNaN(parsed.getTime())) {
    return { iso: parsed.toISOString(), precision: 'exact', sourceLabel };
  }

  return { iso: referenceDate.toISOString(), precision: 'fallback', sourceLabel };
};
