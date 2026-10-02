import {
  allocateCompensationAmountAcrossDates,
  allocateCompensationAmountByDateWeights,
  allocateTieredCompensationAmountByUnitCredits,
  buildCompensationEligibilityDateIndex,
  mergeCompensationEarningBreakdown,
  restrictCompensationEligibilityDateIndex,
  scaleCompensationEarningBreakdown,
} from '../compensationEarningDateService';

describe('compensation earning-date helpers', () => {
  it('expands only persisted inclusive periods and fails closed when history is absent', () => {
    expect(buildCompensationEligibilityDateIndex([], '2026-08-01', '2026-08-05').size).toBe(0);

    const index = buildCompensationEligibilityDateIndex([
      { userId: 28, effectiveStart: '2026-07-30', effectiveEnd: '2026-08-02' },
      { userId: 28, effectiveStart: '2026-08-04', effectiveEnd: null },
      { userId: 31, effectiveStart: '2026-08-03', effectiveEnd: '2026-08-03' },
    ], '2026-08-01', '2026-08-05');

    expect(Array.from(index.get(28) ?? [])).toEqual([
      '2026-08-01',
      '2026-08-02',
      '2026-08-04',
      '2026-08-05',
    ]);
    expect(Array.from(index.get(31) ?? [])).toEqual(['2026-08-03']);
  });

  it('intersects eligibility with an assignment effective window', () => {
    const restricted = restrictCompensationEligibilityDateIndex(
      new Map([[28, new Set(['2026-08-01', '2026-08-02', '2026-08-03'])]]),
      '2026-08-02',
      '2026-08-02',
    );
    expect(Array.from(restricted.get(28) ?? [])).toEqual(['2026-08-02']);
  });

  it('allocates and merges exact cents without losing the component total', () => {
    const even = allocateCompensationAmountAcrossDates(
      10,
      ['2026-08-03', '2026-08-01', '2026-08-02'],
    );
    expect(even).toEqual([
      { date: '2026-08-01', amount: 3.34 },
      { date: '2026-08-02', amount: 3.33 },
      { date: '2026-08-03', amount: 3.33 },
    ]);
    expect(mergeCompensationEarningBreakdown(even).reduce((sum, row) => sum + row.amount, 0)).toBe(10);
  });

  it('preserves weighted dates when scaling a gated payout', () => {
    const weighted = allocateCompensationAmountByDateWeights(12.01, [
      { date: '2026-08-01', weight: 1 },
      { date: '2026-08-02', weight: 2 },
    ]);
    expect(weighted.reduce((sum, row) => sum + row.amount, 0)).toBe(12.01);
    expect(weighted[1].amount).toBeGreaterThan(weighted[0].amount);

    const scaled = scaleCompensationEarningBreakdown(weighted, 6);
    expect(scaled.reduce((sum, row) => sum + row.amount, 0)).toBe(6);
    expect(scaled.map((row) => row.date)).toEqual(['2026-08-01', '2026-08-02']);
  });

  it('dates review payout tiers to the credits consumed by that tier', () => {
    const credits = [
      { date: '2026-09-14', units: 2 },
      { date: '2026-09-15', units: 13 },
      { date: '2026-09-16', units: 4 },
    ];

    expect(allocateTieredCompensationAmountByUnitCredits({
      credits,
      minUnits: 1,
      maxUnits: 15,
      rate: 10,
    })).toEqual([
      { date: '2026-09-14', amount: 20 },
      { date: '2026-09-15', amount: 130 },
    ]);

    expect(allocateTieredCompensationAmountByUnitCredits({
      credits,
      minUnits: 16,
      maxUnits: 20,
      rate: 10,
    })).toEqual([
      { date: '2026-09-16', amount: 40 },
    ]);
  });

  it('splits fractional review credits across a tier boundary', () => {
    expect(allocateTieredCompensationAmountByUnitCredits({
      credits: [
        { date: '2026-09-14', units: 14.5 },
        { date: '2026-09-15', units: 1 },
      ],
      minUnits: 1,
      maxUnits: 15,
      rate: 10,
    })).toEqual([
      { date: '2026-09-14', amount: 145 },
      { date: '2026-09-15', amount: 5 },
    ]);

    expect(allocateTieredCompensationAmountByUnitCredits({
      credits: [
        { date: '2026-09-14', units: 14.5 },
        { date: '2026-09-15', units: 1 },
      ],
      minUnits: 16,
      maxUnits: 20,
      rate: 10,
    })).toEqual([
      { date: '2026-09-15', amount: 5 },
    ]);
  });
});
