import { buildReviewFundRoutingPlan, rerouteReviewFundSources } from '../reviewPaymentFundRoutingService.js';
import { splitDatedEarningsByStaffTypeAndRouting } from '../staffPayoutEarningSegmentationService.js';
import type { CompensationSettlementIntentPayloadV2 } from '../compensationSettlementIntentService.js';
import type { StaffPayoutSettlementSnapshotV2 } from '../../types/StaffPayoutSettlementSnapshot.js';

const first = { sourceKey: 'compensation_component', componentId: 4, category: 'review',
  destination: 'staff_vendor' as const, fundId: null, currency: 'PLN', ruleId: 3,
  grossAmountMinor: 4000, segmentKey: 'seg_before', staffTypePeriodId: 11,
  staffType: 'volunteer', earningStart: '2026-10-06', earningEnd: '2026-10-07', legacyExtrapolation: false };
const second = { ...first, grossAmountMinor: 6000, segmentKey: 'seg_after', staffTypePeriodId: 12,
  earningStart: '2026-10-08', earningEnd: '2026-10-29' };
const snapshot: StaffPayoutSettlementSnapshotV2 = { version: 2, sources: [first, second,
  { ...second, componentId: 16, category: 'commission', destination: 'volunteer_fund', fundId: 1, segmentKey: 'seg_guiding' }] };
const intents = [first, second].map(source => ({ ...source, version: 2 as const, userId: 101,
  rangeStart: '2026-10-01', rangeEnd: '2026-10-31', outstandingAmountMinor: source.grossAmountMinor,
  issuedAt: 12345, direction: 'payable' as const, referenceIds: [], routingOverrideReason: null }));
const params = { snapshot, intents, userId: 101, rangeStart: '2026-10-01', rangeEnd: '2026-10-31' };

it('moves both historical review segments once and leaves guiding untouched', () => {
  const plan = buildReviewFundRoutingPlan(params);
  expect(plan.amountMinor).toBe(10000);
  expect(plan.componentIds).toEqual([4]);
  const result = rerouteReviewFundSources({ sources: plan.snapshot.sources,
    selectedSegmentKeys: new Set(plan.sources.map(source => source.segmentKey)), rulesByComponent: new Map([[4, 90]]), fundId: 1 });
  expect(result.sources.filter(source => source.componentId === 4)).toEqual(expect.arrayContaining([
    expect.objectContaining({ destination: 'volunteer_fund', grossAmountMinor: 4000, ruleId: 90, earningEnd: '2026-10-07' }),
    expect.objectContaining({ destination: 'volunteer_fund', grossAmountMinor: 6000, ruleId: 90, earningEnd: '2026-10-29' }),
  ]));
  expect(result.sources.find(source => source.componentId === 16)).toEqual(snapshot.sources[2]);
  const expected = splitDatedEarningsByStaffTypeAndRouting({ sourceKey: first.sourceKey, componentId: 4,
    earnings: [{ date: first.earningStart, amountMinor: 4000 }],
    periods: [{ id: 11, staffType: 'volunteer', effectiveStart: '2026-09-14', effectiveEnd: '2026-10-07' }],
    routingByDate: new Map([[first.earningStart, { ruleId: 90, destination: 'volunteer_fund', fundId: 1 }]]) });
  expect(result.sources.find(source => source.staffTypePeriodId === 11)?.segmentKey).toBe(expected[0].segmentKey);
  expect(() => buildReviewFundRoutingPlan({ ...params, snapshot: result })).toThrow(/changed|settled/);
});

it.each([
  ['partial payment', { outstandingAmountMinor: 100 }],
  ['another staff member', { userId: 1 }],
  ['another month', { rangeStart: '2026-09-01' }],
  ['non-volunteer', { staffType: 'long_term' }],
  ['non-review', { category: 'commission' }],
  ['fund-routed', { destination: 'volunteer_fund', fundId: 1 }],
  ['wrong amount', { grossAmountMinor: 999 }],
  ['changed dates', { earningEnd: '2026-10-06' }],
  ['changed rule', { ruleId: 88 }],
])('rejects %s authorization', (_label, changes) => {
  expect(() => buildReviewFundRoutingPlan({ ...params, intents: [{ ...intents[0], ...changes } as CompensationSettlementIntentPayloadV2, intents[1]] })).toThrow();
});

it('rejects incomplete components, duplicates, and missing snapshots', () => {
  expect(() => buildReviewFundRoutingPlan({ ...params, intents: [intents[0]] })).toThrow();
  expect(() => buildReviewFundRoutingPlan({ ...params, intents: [...intents, intents[0]] })).toThrow();
  expect(() => buildReviewFundRoutingPlan({ ...params, snapshot: null })).toThrow();
});
