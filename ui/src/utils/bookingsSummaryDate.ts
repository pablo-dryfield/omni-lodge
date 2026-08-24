import type { UnifiedOrder } from '../store/bookingPlatformsTypes';

export type BookingsSummaryDateField = 'experience_date' | 'source_received_at';

export const BOOKINGS_SUMMARY_TIMEZONE = 'Europe/Warsaw';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const warsawDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: BOOKINGS_SUMMARY_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const formatWarsawDate = (value: string): string | null => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const parts = new Map(
    warsawDateFormatter
      .formatToParts(parsed)
      .map((part) => [part.type, part.value]),
  );
  const year = parts.get('year');
  const month = parts.get('month');
  const day = parts.get('day');
  return year && month && day ? `${year}-${month}-${day}` : null;
};

export const resolveBookingsSummaryDate = (
  order: Pick<UnifiedOrder, 'date' | 'sourceReceivedAt'>,
  dateField: BookingsSummaryDateField,
): string | null => {
  if (dateField === 'source_received_at') {
    return order.sourceReceivedAt ? formatWarsawDate(order.sourceReceivedAt) : null;
  }

  return DATE_ONLY_PATTERN.test(order.date) ? order.date : null;
};

export type BookingsRevenueTrendInput = Pick<UnifiedOrder, 'date' | 'sourceReceivedAt'> & {
  netRevenue: number;
  processingFee: number;
  refundedAmount: number;
  people: number;
};

export type BookingsRevenueTrendPoint = {
  date: string;
  label: string;
  revenue: number;
  refunds: number;
  bookings: number;
  people: number;
};

const roundMoney = (value: number): number => Math.round(value * 100) / 100;

export const buildBookingsRevenueTrend = (
  rows: readonly BookingsRevenueTrendInput[],
  dateField: BookingsSummaryDateField,
): BookingsRevenueTrendPoint[] => {
  const buckets = new Map<string, Omit<BookingsRevenueTrendPoint, 'label'>>();

  rows.forEach((row) => {
    const date = resolveBookingsSummaryDate(row, dateField);
    if (!date) {
      return;
    }
    const bucket = buckets.get(date) ?? {
      date,
      revenue: 0,
      refunds: 0,
      bookings: 0,
      people: 0,
    };
    bucket.revenue += row.netRevenue - Math.max(0, Number(row.processingFee) || 0);
    bucket.refunds += row.refundedAmount;
    bucket.bookings += 1;
    bucket.people += row.people;
    buckets.set(date, bucket);
  });

  return Array.from(buckets.values())
    .map((row) => ({
      ...row,
      revenue: roundMoney(row.revenue),
      refunds: roundMoney(row.refunds),
      label: row.date.slice(5),
    }))
    .sort((left, right) => left.date.localeCompare(right.date));
};
