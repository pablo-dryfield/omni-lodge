import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

export const REVIEW_CREDIT_TIMEZONE = 'Europe/Warsaw';

export const reviewMonthInWarsaw = (value: Date | string): string =>
  dayjs(value).tz(REVIEW_CREDIT_TIMEZONE).format('YYYY-MM');

export const reviewPeriodStartInWarsaw = (value: Date | string): string =>
  `${reviewMonthInWarsaw(value)}-01`;

export const reviewDateRangeInWarsaw = (start: string, end: string): { start: Date; end: Date } => {
  const startAt = dayjs.tz(`${start}T00:00:00`, REVIEW_CREDIT_TIMEZONE);
  const nextDate = dayjs(end).add(1, 'day').format('YYYY-MM-DD');
  const endAt = dayjs.tz(`${nextDate}T00:00:00`, REVIEW_CREDIT_TIMEZONE).subtract(1, 'millisecond');
  return { start: startAt.toDate(), end: endAt.toDate() };
};
