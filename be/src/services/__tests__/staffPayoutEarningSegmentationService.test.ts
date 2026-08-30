import {
  allocateMinorAcrossDates,
  enumerateDateRange,
  splitDatedEarningsAtCutoff,
  splitDatedEarningsByStaffType,
  splitDatedEarningsByStaffTypeAndRouting,
} from '../staffPayoutEarningSegmentationService.js';

describe('staff payout earning segmentation', () => {
  it('preserves every cent when allocating an amount across dates', () => {
    const rows = allocateMinorAcrossDates(10_000, ['2026-08-01', '2026-08-02', '2026-08-03']);
    expect(rows).toEqual([
      { date: '2026-08-01', amountMinor: 3334 },
      { date: '2026-08-02', amountMinor: 3333 },
      { date: '2026-08-03', amountMinor: 3333 },
    ]);
    expect(rows.reduce((sum, row) => sum + row.amountMinor, 0)).toBe(10_000);
  });

  it('splits mid-month earnings by the staff type valid on each earning date', () => {
    const earnings = allocateMinorAcrossDates(
      31_000,
      enumerateDateRange('2026-08-01', '2026-08-31'),
    );
    const segments = splitDatedEarningsByStaffType({
      sourceKey: 'guide_commission',
      componentId: null,
      earnings,
      periods: [
        {
          id: 10,
          staffType: 'volunteer',
          effectiveStart: '2026-01-01',
          effectiveEnd: '2026-08-15',
        },
        {
          id: 11,
          staffType: 'long_term',
          effectiveStart: '2026-08-16',
          effectiveEnd: null,
        },
      ],
    });

    expect(segments.map((segment) => ({
      staffType: segment.staffType,
      earningStart: segment.earningStart,
      earningEnd: segment.earningEnd,
      grossAmountMinor: segment.grossAmountMinor,
    }))).toEqual([
      {
        staffType: 'volunteer',
        earningStart: '2026-08-01',
        earningEnd: '2026-08-15',
        grossAmountMinor: 15_000,
      },
      {
        staffType: 'long_term',
        earningStart: '2026-08-16',
        earningEnd: '2026-08-31',
        grossAmountMinor: 16_000,
      },
    ]);
  });

  it('uses the earliest migration period only as an explicit legacy extrapolation', () => {
    const [segment] = splitDatedEarningsByStaffType({
      sourceKey: 'compensation_component',
      componentId: 12,
      earnings: [{ date: '2026-08-08', amountMinor: 72135 }],
      periods: [{
        id: 20,
        staffType: 'long_term',
        effectiveStart: '2026-08-30',
        effectiveEnd: null,
      }],
      allowLegacyExtrapolation: true,
    });

    expect(segment.staffType).toBe('long_term');
    expect(segment.legacyExtrapolation).toBe(true);
    expect(segment.grossAmountMinor).toBe(72135);
  });

  it('rejects uncovered earnings after history has started', () => {
    expect(() => splitDatedEarningsByStaffType({
      sourceKey: 'guide_commission',
      componentId: null,
      earnings: [{ date: '2026-08-20', amountMinor: 1000 }],
      periods: [{
        id: 30,
        staffType: 'volunteer',
        effectiveStart: '2026-08-01',
        effectiveEnd: '2026-08-15',
      }],
    })).toThrow('No staff-type eligibility period covers 2026-08-20.');
  });

  it('keeps a segment key stable while an open month accumulates earnings', () => {
    const periods = [{
      id: 40,
      staffType: 'long_term',
      effectiveStart: '2026-08-01',
      effectiveEnd: null,
    }];
    const initial = splitDatedEarningsByStaffType({
      sourceKey: 'guide_commission',
      componentId: null,
      earnings: [{ date: '2026-08-05', amountMinor: 1000 }],
      periods,
    });
    const accumulated = splitDatedEarningsByStaffType({
      sourceKey: 'guide_commission',
      componentId: null,
      earnings: [
        { date: '2026-08-05', amountMinor: 1000 },
        { date: '2026-08-27', amountMinor: 2000 },
      ],
      periods,
    });

    expect(accumulated[0].segmentKey).toBe(initial[0].segmentKey);
    expect(accumulated[0].earningEnd).toBe('2026-08-27');
  });

  it('splits one staff-type period at monthly routing boundaries', () => {
    const earnings = [
      { date: '2026-08-31', amountMinor: 1000 },
      { date: '2026-09-01', amountMinor: 2000 },
      { date: '2026-09-15', amountMinor: 3000 },
    ];
    const routingByDate = new Map([
      ['2026-08-31', { ruleId: 1, destination: 'staff_vendor' as const, fundId: null }],
      ['2026-09-01', { ruleId: 2, destination: 'volunteer_fund' as const, fundId: 7 }],
      ['2026-09-15', { ruleId: 2, destination: 'volunteer_fund' as const, fundId: 7 }],
      ['2026-09-20', { ruleId: 2, destination: 'volunteer_fund' as const, fundId: 7 }],
    ]);
    const segments = splitDatedEarningsByStaffTypeAndRouting({
      sourceKey: 'compensation_component',
      componentId: 12,
      earnings,
      periods: [{
        id: 50,
        staffType: 'volunteer',
        effectiveStart: '2026-08-01',
        effectiveEnd: null,
      }],
      routingByDate,
    });

    expect(segments.map((segment) => ({
      earningStart: segment.earningStart,
      earningEnd: segment.earningEnd,
      amount: segment.grossAmountMinor,
      ruleId: segment.routing.ruleId,
      destination: segment.routing.destination,
    }))).toEqual([
      {
        earningStart: '2026-08-31',
        earningEnd: '2026-08-31',
        amount: 1000,
        ruleId: 1,
        destination: 'staff_vendor',
      },
      {
        earningStart: '2026-09-01',
        earningEnd: '2026-09-15',
        amount: 5000,
        ruleId: 2,
        destination: 'volunteer_fund',
      },
    ]);
    expect(segments[0].segmentKey).not.toBe(segments[1].segmentKey);

    const accumulated = splitDatedEarningsByStaffTypeAndRouting({
      sourceKey: 'compensation_component',
      componentId: 12,
      earnings: [
        ...earnings,
        { date: '2026-09-20', amountMinor: 4000 },
      ],
      periods: [{
        id: 50,
        staffType: 'volunteer',
        effectiveStart: '2026-08-01',
        effectiveEnd: null,
      }],
      routingByDate,
    });
    expect(accumulated[1].segmentKey).toBe(segments[1].segmentKey);
    expect(accumulated[1].earningEnd).toBe('2026-09-20');
  });

  it('keeps pre-cutoff and effective-dated earnings separate without losing cents', () => {
    const result = splitDatedEarningsAtCutoff({
      cutoffDate: '2026-08-01',
      earnings: [
        { date: '2026-07-31', amountMinor: 111 },
        { date: '2026-08-01', amountMinor: 222 },
        { date: '2026-08-20', amountMinor: 333 },
      ],
    });

    expect(result).toEqual({
      before: [{ date: '2026-07-31', amountMinor: 111 }],
      onOrAfter: [
        { date: '2026-08-01', amountMinor: 222 },
        { date: '2026-08-20', amountMinor: 333 },
      ],
    });
    expect([...result.before, ...result.onOrAfter]
      .reduce((sum, entry) => sum + entry.amountMinor, 0)).toBe(666);
  });
});
