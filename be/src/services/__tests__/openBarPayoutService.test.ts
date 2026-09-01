import {
  computePersistedOpenBarPayout,
  resolveOpenBarRateBands,
} from '../openBarPayoutService';

const term = {
  rateAmount: 9,
  rateUnit: 'per_person' as const,
};

const rate = (
  id: number,
  productId: number | null,
  ticketType: 'normal' | 'cocktail' | 'brunch' | 'generic',
  rateAmount: number,
  validFrom = '2026-01-01',
  validTo: string | null = null,
  rateUnit: 'per_person' | 'flat' = 'per_person',
) => ({ id, productId, ticketType, rateAmount, validFrom, validTo, rateUnit });

describe('resolveOpenBarRateBands', () => {
  it('uses explicit product and guest-type precedence before generic and global bands', () => {
    const result = resolveOpenBarRateBands(
      term,
      [
        rate(1, null, 'generic', 1),
        rate(2, null, 'normal', 2),
        rate(3, 44, 'generic', 3),
        rate(4, 44, 'normal', 4),
      ],
      { normal: 2, cocktail: 3, brunch: 0 },
      44,
      '2026-08-20',
    );

    expect(result).toEqual({
      total: 17,
      breakdown: [
        expect.objectContaining({
          ticketType: 'normal',
          configuredTicketType: 'normal',
          count: 2,
          rateBandId: 4,
          rateAmount: 4,
          source: 'ticket_rate',
          amount: 8,
        }),
        expect.objectContaining({
          ticketType: 'cocktail',
          configuredTicketType: 'generic',
          count: 3,
          rateBandId: 3,
          rateAmount: 3,
          source: 'generic_rate',
          amount: 9,
        }),
      ],
    });
  });

  it('never falls back to a rate configured for a different product', () => {
    const result = resolveOpenBarRateBands(
      term,
      [rate(8, 99, 'normal', 50)],
      { normal: 2, cocktail: 0, brunch: 0 },
      44,
      '2026-08-20',
    );

    expect(result.total).toBe(18);
    expect(result.breakdown).toEqual([
      expect.objectContaining({
        ticketType: 'normal',
        source: 'term_default',
        rateBandId: null,
        rateAmount: 9,
        amount: 18,
      }),
    ]);
  });

  it('uses the newest effective band and respects both date boundaries', () => {
    const result = resolveOpenBarRateBands(
      term,
      [
        rate(10, null, 'normal', 3, '2026-01-01', '2026-08-19'),
        rate(11, null, 'normal', 5, '2026-08-20', '2026-12-31'),
      ],
      { normal: 2, cocktail: 0, brunch: 0 },
      null,
      '2026-08-20',
    );

    expect(result.total).toBe(10);
    expect(result.breakdown[0]).toEqual(expect.objectContaining({ rateBandId: 11, rateAmount: 5 }));
  });

  it('falls back per missing guest type instead of silently omitting its cost', () => {
    const result = resolveOpenBarRateBands(
      term,
      [rate(20, null, 'normal', 4)],
      { normal: 2, cocktail: 1, brunch: 0 },
      null,
      '2026-08-20',
    );

    expect(result.total).toBe(17);
    expect(result.breakdown).toEqual([
      expect.objectContaining({ ticketType: 'normal', source: 'ticket_rate', amount: 8 }),
      expect.objectContaining({ ticketType: 'cocktail', source: 'term_default', amount: 9 }),
    ]);
  });

  it('charges a flat term default once when no configured band applies', () => {
    const result = resolveOpenBarRateBands(
      { rateAmount: 25, rateUnit: 'flat' },
      [],
      { normal: 2, cocktail: 3, brunch: 1 },
      null,
      '2026-08-20',
    );

    expect(result).toEqual({
      total: 25,
      breakdown: [
        {
          ticketType: 'generic',
          configuredTicketType: 'generic',
          count: 6,
          rateBandId: null,
          rateAmount: 25,
          rateUnit: 'flat',
          source: 'term_default',
          amount: 25,
        },
      ],
    });
  });

  it('omits zero-count guest types and rounds component totals to cents', () => {
    const result = resolveOpenBarRateBands(
      term,
      [rate(30, null, 'cocktail', 3.335)],
      { normal: 0, cocktail: 3, brunch: 0 },
      null,
      '2026-08-20',
    );

    expect(result.total).toBe(10.02);
    expect(result.breakdown).toEqual([
      expect.objectContaining({ ticketType: 'cocktail', rateAmount: 3.34, amount: 10.02 }),
    ]);
  });
});

describe('computePersistedOpenBarPayout compatibility', () => {
  it('keeps the existing input-order behavior when a generic and exact band both match', () => {
    const result = computePersistedOpenBarPayout(
      term,
      [
        rate(40, 44, 'generic', 3),
        rate(41, 44, 'normal', 5),
      ],
      { normal: 2, cocktail: 0, brunch: 0 },
      44,
      '2026-08-20',
    );

    expect(result.total).toBe(6);
    expect(result.breakdown).toEqual([
      expect.objectContaining({ ticketType: 'normal', rateAmount: 3, source: 'ticket_rate' }),
    ]);
  });

  it('keeps the existing cross-product fallback used by persisted reports', () => {
    const result = computePersistedOpenBarPayout(
      term,
      [rate(50, 99, 'normal', 7)],
      { normal: 2, cocktail: 0, brunch: 0 },
      44,
      '2026-08-20',
    );

    expect(result.total).toBe(14);
    expect(result.breakdown[0]).toEqual(expect.objectContaining({ rateAmount: 7 }));
  });

  it('keeps unmatched guest types omitted when another configured component exists', () => {
    const result = computePersistedOpenBarPayout(
      term,
      [rate(60, null, 'normal', 4)],
      { normal: 2, cocktail: 1, brunch: 0 },
      null,
      '2026-08-20',
    );

    expect(result.total).toBe(8);
    expect(result.breakdown).toEqual([
      expect.objectContaining({ ticketType: 'normal', rateAmount: 4 }),
    ]);
  });
});
