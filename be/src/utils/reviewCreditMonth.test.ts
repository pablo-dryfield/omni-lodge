import { reviewDateRangeInWarsaw, reviewMonthInWarsaw, reviewPeriodStartInWarsaw } from './reviewCreditMonth';

describe('review credit month in Warsaw', () => {
  it('moves a late UTC timestamp into the next Warsaw month', () => {
    const timestamp = new Date('2026-07-31T22:28:21.000Z');

    expect(reviewMonthInWarsaw(timestamp)).toBe('2026-08');
    expect(reviewPeriodStartInWarsaw(timestamp)).toBe('2026-08-01');
  });

  it('uses Warsaw midnight for a summer reporting range', () => {
    const range = reviewDateRangeInWarsaw('2026-07-01', '2026-07-31');

    expect(range.start.toISOString()).toBe('2026-06-30T22:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-07-31T21:59:59.999Z');
  });
});
