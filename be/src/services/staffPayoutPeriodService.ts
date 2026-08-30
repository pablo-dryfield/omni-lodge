import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

export const STAFF_PAYOUT_TIME_ZONE = 'Europe/Warsaw';

const assertDateOnly = (value: string): string => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('periodEnd must use YYYY-MM-DD.');
  }
  const parsed = dayjs.utc(value, 'YYYY-MM-DD', true);
  if (!parsed.isValid() || parsed.format('YYYY-MM-DD') !== value) {
    throw new Error('periodEnd must be a valid calendar date.');
  }
  return value;
};

/** A payout month closes at midnight on its first day in Warsaw. */
export const isStaffPayoutPeriodClosedInWarsaw = (
  periodEnd: string,
  now: Date = new Date(),
): boolean => {
  const normalizedEnd = assertDateOnly(periodEnd);
  const currentMonthStart = dayjs(now).tz(STAFF_PAYOUT_TIME_ZONE).startOf('month');
  return dayjs.tz(normalizedEnd, STAFF_PAYOUT_TIME_ZONE).isBefore(currentMonthStart, 'day');
};
