import {
  allocateCompensationAmountAcrossDates,
  allocateCompensationAmountByDateWeights,
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
});
