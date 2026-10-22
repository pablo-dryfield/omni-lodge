import { resolveBookingsSummaryDate } from './bookingsSummaryDate';

/** Represent a calendar day for date-picker comparisons, independent of UTC offsets. */
export const bookingTableCalendarDate = (value?: string | null): Date | undefined => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day
    ? parsed : undefined;
};

export const sourceReceivedCalendarDate = (value?: string | null): Date | undefined =>
  bookingTableCalendarDate(resolveBookingsSummaryDate({ date: '', sourceReceivedAt: value }, 'source_received_at'));
