import { parseAirbnbReviewDate } from './airbnbReviewDate';

describe('parseAirbnbReviewDate', () => {
  const reference = new Date('2026-08-10T05:01:42.000Z');

  it('resolves the relative week labels returned for recent Airbnb reviews', () => {
    expect(parseAirbnbReviewDate('3 weeks ago', reference)).toEqual({
      iso: '2026-07-20T00:00:00.000Z',
      precision: 'relative',
      sourceLabel: '3 weeks ago',
    });
  });

  it('resolves Airbnb month and year labels to the start of that month', () => {
    expect(parseAirbnbReviewDate('August 2026', reference)).toEqual({
      iso: '2026-08-01T00:00:00.000Z',
      precision: 'month',
      sourceLabel: 'August 2026',
    });
  });

  it('handles recent day labels without using the sync timestamp', () => {
    expect(parseAirbnbReviewDate('yesterday', reference).iso).toBe('2026-08-09T00:00:00.000Z');
    expect(parseAirbnbReviewDate('5 days ago', reference).iso).toBe('2026-08-05T00:00:00.000Z');
  });
});
