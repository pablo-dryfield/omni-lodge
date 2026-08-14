import {
  currentReviewMonthInWarsaw,
  effectiveReviewMonth,
  reviewMonthInWarsaw,
} from './reviewCreditMonth';

describe('review credit months', () => {
  it('uses the Warsaw month at UTC month boundaries', () => {
    const boundary = new Date('2026-07-31T22:30:00.000Z');

    expect(reviewMonthInWarsaw(boundary)).toBe('2026-08');
    expect(currentReviewMonthInWarsaw(boundary)).toBe('2026-08');
  });

  it('keeps an explicit credit month override', () => {
    expect(effectiveReviewMonth('2026-08-10T12:00:00.000Z', '2026-07-01')).toBe('2026-07');
  });
});
