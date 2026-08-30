import {
  buildStaffPayoutSettlementSnapshotV2,
  isStaffPayoutSettlementSnapshotV2,
  normalizeStaffPayoutSettlementSnapshot,
  staffPayoutSettlementSnapshotsMatch,
} from '../staffPayoutSettlementSnapshotService.js';

const baseSource = {
  sourceKey: 'guide_commission',
  componentId: null,
  category: 'commission',
  grossAmountMinor: 18_000,
  destination: 'staff_vendor' as const,
  fundId: null,
  ruleId: 42,
  currency: 'PLN',
};

const segmentedSource = (overrides: Record<string, unknown> = {}) => ({
  ...baseSource,
  segmentKey: 'seg_1234567890abcdef1234567890abcdef',
  earningStart: '2026-08-01',
  earningEnd: '2026-08-15',
  staffTypePeriodId: 10,
  staffType: 'volunteer',
  legacyExtrapolation: false,
  ...overrides,
});

describe('staff payout settlement snapshot service', () => {
  it('continues to normalize and canonically sort persisted v1 snapshots', () => {
    const normalized = normalizeStaffPayoutSettlementSnapshot({
      version: 1,
      sources: [
        { ...baseSource, sourceKey: 'retention', currency: 'pln' },
        baseSource,
      ],
    });

    expect(normalized).toEqual({
      version: 1,
      sources: [
        baseSource,
        { ...baseSource, sourceKey: 'retention' },
      ],
    });
  });

  it('builds a v2 snapshot with immutable staff-type segment identity', () => {
    const snapshot = buildStaffPayoutSettlementSnapshotV2([
      segmentedSource({
        segmentKey: 'seg_second',
        earningStart: '2026-08-16',
        earningEnd: '2026-08-31',
        staffTypePeriodId: 11,
        staffType: ' LONG_TERM ',
      }),
      segmentedSource(),
    ], {
      rangeStart: '2026-08-01',
      rangeEnd: '2026-08-31',
    });

    expect(isStaffPayoutSettlementSnapshotV2(snapshot)).toBe(true);
    expect(snapshot.version).toBe(2);
    expect(snapshot.sources.map((source) => ({
      segmentKey: source.segmentKey,
      earningStart: source.earningStart,
      earningEnd: source.earningEnd,
      staffTypePeriodId: source.staffTypePeriodId,
      staffType: source.staffType,
      legacyExtrapolation: source.legacyExtrapolation,
    }))).toEqual([
      {
        segmentKey: 'seg_1234567890abcdef1234567890abcdef',
        earningStart: '2026-08-01',
        earningEnd: '2026-08-15',
        staffTypePeriodId: 10,
        staffType: 'volunteer',
        legacyExtrapolation: false,
      },
      {
        segmentKey: 'seg_second',
        earningStart: '2026-08-16',
        earningEnd: '2026-08-31',
        staffTypePeriodId: 11,
        staffType: 'long_term',
        legacyExtrapolation: false,
      },
    ]);
  });

  it('rejects partial, duplicate, and out-of-ledger v2 segment identities', () => {
    const partial = segmentedSource();
    delete (partial as { staffType?: unknown }).staffType;

    expect(normalizeStaffPayoutSettlementSnapshot({
      version: 2,
      sources: [partial],
    })).toBeNull();
    expect(normalizeStaffPayoutSettlementSnapshot({
      version: 2,
      sources: [segmentedSource(), segmentedSource()],
    })).toBeNull();
    expect(normalizeStaffPayoutSettlementSnapshot({
      version: 2,
      sources: [segmentedSource({ earningStart: '2026-07-31' })],
    }, {
      rangeStart: '2026-08-01',
      rangeEnd: '2026-08-31',
    })).toBeNull();
  });

  it('matches equivalent snapshots after normalization but never conflates v1 and v2', () => {
    expect(staffPayoutSettlementSnapshotsMatch(
      { version: 2, sources: [segmentedSource({ currency: 'pln' })] },
      { version: 2, sources: [segmentedSource()] },
    )).toBe(true);
    expect(staffPayoutSettlementSnapshotsMatch(
      { version: 1, sources: [baseSource] },
      { version: 2, sources: [segmentedSource()] },
    )).toBe(false);
  });
});
