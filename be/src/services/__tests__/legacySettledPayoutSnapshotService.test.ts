import {
  buildLegacySettledPayoutSnapshotPresentation,
  resolveAuthoritativeLegacySettledPayoutSnapshot,
} from '../legacySettledPayoutSnapshotService.js';

const sources = [
  {
    sourceKey: 'compensation_component',
    componentId: 12,
    category: 'base',
    grossAmountMinor: 62_500,
    destination: 'staff_vendor',
    fundId: null,
    ruleId: 1,
    currency: 'PLN',
  },
  {
    sourceKey: 'compensation_component',
    componentId: 12,
    category: 'base',
    grossAmountMinor: 62_500,
    destination: 'staff_vendor',
    fundId: null,
    ruleId: 1,
    currency: 'PLN',
  },
  {
    sourceKey: 'guide_commission',
    componentId: null,
    category: 'commission',
    grossAmountMinor: 19_900,
    destination: 'staff_vendor',
    fundId: null,
    ruleId: 1,
    currency: 'PLN',
  },
  {
    sourceKey: 'compensation_component',
    componentId: 7,
    category: 'deduction',
    grossAmountMinor: -1_000,
    destination: 'staff_vendor',
    fundId: null,
    ruleId: 1,
    currency: 'PLN',
  },
] as const;

const legacySnapshot = {
  version: 1,
  sources,
} as const;

const validInput = (overrides: Record<string, unknown> = {}) => ({
  settlementSnapshot: legacySnapshot,
  rangeStart: '2026-07-01',
  rangeEnd: '2026-07-31',
  ledgerCurrency: 'pln',
  dueAmountMinor: 143_900,
  ledgerPaidAmountMinor: 143_900,
  canonicalPaidAmountMinor: 143_900,
  liveFundAllocatedAmountMinor: 0,
  ...overrides,
});

describe('legacy settled payout snapshot authority', () => {
  it('uses a fully paid pre-August v1 snapshot regardless of current staff state', () => {
    const resolved = resolveAuthoritativeLegacySettledPayoutSnapshot(validInput());

    expect(resolved).not.toBeNull();
    expect(resolved?.version).toBe(1);
    expect(resolved?.sources).toHaveLength(4);
  });

  it.each([
    ['August or later', { rangeEnd: '2026-08-31' }],
    ['an invalid date range', { rangeStart: '2026-07-31', rangeEnd: '2026-07-01' }],
    ['a partially paid ledger', { ledgerPaidAmountMinor: 100_000 }],
    ['a canonical payment mismatch', { canonicalPaidAmountMinor: 100_000 }],
    ['a frozen due mismatch', { dueAmountMinor: 140_000 }],
    ['a source currency mismatch', {
      settlementSnapshot: {
        version: 1,
        sources: [{ ...sources[0], grossAmountMinor: 143_900, currency: 'EUR' }],
      },
    }],
    ['a live fund allocation', { liveFundAllocatedAmountMinor: 1 }],
    ['a nonzero fund-routed source', {
      settlementSnapshot: {
        version: 1,
        sources: [{
          ...sources[0],
          grossAmountMinor: 143_900,
          destination: 'volunteer_fund',
          fundId: 2,
        }],
      },
    }],
    ['an empty snapshot', { settlementSnapshot: { version: 1, sources: [] } }],
    ['a malformed snapshot', { settlementSnapshot: { version: 1, sources: [{}] } }],
  ])('rejects %s', (_label, overrides) => {
    expect(resolveAuthoritativeLegacySettledPayoutSnapshot(validInput(overrides))).toBeNull();
  });

  it('keeps segmented v2 snapshots on strict effective-dated reconciliation', () => {
    const v2Snapshot = {
      version: 2,
      sources: [{
        ...sources[0],
        grossAmountMinor: 143_900,
        segmentKey: 'seg_legacy_test',
        earningStart: '2026-07-01',
        earningEnd: '2026-07-31',
        staffTypePeriodId: 99,
        staffType: 'long_term',
        legacyExtrapolation: false,
      }],
    };

    expect(resolveAuthoritativeLegacySettledPayoutSnapshot(validInput({
      settlementSnapshot: v2Snapshot,
    }))).toBeNull();
  });
});

describe('legacy settled payout snapshot presentation', () => {
  it('restores saved component and bucket totals without creating new payment intents', () => {
    const resolved = resolveAuthoritativeLegacySettledPayoutSnapshot(validInput());
    expect(resolved).not.toBeNull();

    const presentation = buildLegacySettledPayoutSnapshotPresentation(
      resolved!,
      [
        {
          id: 7,
          name: 'Historical deduction',
          category: 'deduction',
          calculationMethod: 'flat',
        },
        {
          id: 12,
          name: 'Assistant Manager Salary',
          category: 'base',
          calculationMethod: 'per_unit',
          isActive: false,
        },
      ],
    );

    expect(presentation).toEqual(expect.objectContaining({
      totalCommission: 199,
      totalPayout: 1439,
      grossCompensationTotal: 1439,
      personalPayableTotal: 1439,
      volunteerFundAllocationTotal: 0,
      excludedSettlementTotal: 0,
      bucketTotals: {
        base: 1250,
        commission: 199,
        deduction: -10,
      },
      grossBucketTotals: {
        base: 1250,
        commission: 199,
        deduction: -10,
      },
      fundBucketTotals: {},
    }));
    expect(presentation?.componentTotals).toEqual([
      expect.objectContaining({
        componentId: 7,
        name: 'Historical deduction',
        amount: -10,
      }),
      expect.objectContaining({
        componentId: 12,
        name: 'Assistant Manager Salary',
        amount: 1250,
      }),
    ]);
    expect(presentation?.settlementSources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'Assistant Manager Salary',
        outstandingAmount: 0,
        settlementIntent: null,
      }),
      expect.objectContaining({
        label: 'Historical deduction',
        settledAmount: 0,
        outstandingAmount: 0,
        settlementIntent: null,
      }),
    ]));
    expect(presentation?.settlementSources.every((source) => (
      source.settlementIntent === null && source.outstandingAmount === 0
    ))).toBe(true);
  });

  it('does not mutate the frozen snapshot while building the read model', () => {
    const before = JSON.stringify(legacySnapshot);
    const resolved = resolveAuthoritativeLegacySettledPayoutSnapshot(validInput());

    buildLegacySettledPayoutSnapshotPresentation(resolved!, [
      {
        id: 7,
        name: 'Historical deduction',
        category: 'deduction',
        calculationMethod: 'flat',
      },
      {
        id: 12,
        name: 'Assistant Manager Salary',
        category: 'base',
        calculationMethod: 'per_unit',
      },
    ]);

    expect(JSON.stringify(legacySnapshot)).toBe(before);
  });

  it('keeps history readable when a component is inactive or its definition was removed', () => {
    const resolved = resolveAuthoritativeLegacySettledPayoutSnapshot(validInput());
    const presentation = buildLegacySettledPayoutSnapshotPresentation(resolved!, [
      {
        id: 12,
        name: 'Assistant Manager Salary',
        category: 'base',
        calculationMethod: 'per_unit',
        isActive: false,
      },
    ]);

    expect(presentation?.componentTotals).toEqual([
      expect.objectContaining({
        componentId: 7,
        name: 'Compensation component #7',
        category: 'deduction',
        calculationMethod: 'flat',
        amount: -10,
      }),
      expect.objectContaining({
        componentId: 12,
        name: 'Assistant Manager Salary',
        category: 'base',
        amount: 1250,
      }),
    ]);
    expect(presentation?.settlementSources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        componentId: 7,
        label: 'Compensation component #7',
      }),
    ]));
  });
});
