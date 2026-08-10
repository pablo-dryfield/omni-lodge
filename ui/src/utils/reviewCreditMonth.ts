export const REVIEW_CREDIT_TIMEZONE = 'Europe/Warsaw';

const warsawMonthFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: REVIEW_CREDIT_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
});

export const reviewMonthInWarsaw = (value: string | Date): string => {
  const parts = warsawMonthFormatter.formatToParts(new Date(value));
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  return year && month ? `${year}-${month}` : new Date(value).toISOString().slice(0, 7);
};

export const effectiveReviewMonth = (reviewCreatedAt: string | Date, creditMonth?: string | null): string =>
  creditMonth?.slice(0, 7) ?? reviewMonthInWarsaw(reviewCreatedAt);
