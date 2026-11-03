import HttpError from '../errors/HttpError.js';
import type { CompensationSettlementIntentPayload } from './compensationSettlementIntentService.js';
import { isSegmentedCompensationSettlementIntent } from './compensationSettlementIntentService.js';
import { splitDatedEarningsByStaffTypeAndRouting } from './staffPayoutEarningSegmentationService.js';
import {
  normalizeStaffPayoutSettlementSnapshot,
  buildStaffPayoutSettlementSnapshotV2,
} from './staffPayoutSettlementSnapshotService.js';
import type { StaffPayoutSettlementSnapshotSourceV2 } from '../types/StaffPayoutSettlementSnapshot.js';

const conflict = () => new HttpError(409,
  'Review pay changed or has already been settled. Refresh Staff Payments before routing unpaid reviews.');

/** Whole unpaid review components only: never change the route behind a paid segment. */
export const buildReviewFundRoutingPlan = (params: {
  snapshot: unknown;
  intents: CompensationSettlementIntentPayload[];
  userId: number;
  rangeStart: string;
  rangeEnd: string;
}) => {
  const snapshot = normalizeStaffPayoutSettlementSnapshot(params.snapshot, params);
  if (!snapshot || snapshot.version !== 2 || !params.intents.length) throw conflict();
  const selected = new Set<string>();
  for (const intent of params.intents) {
    if (!isSegmentedCompensationSettlementIntent(intent)
      || intent.userId !== params.userId || intent.rangeStart !== params.rangeStart || intent.rangeEnd !== params.rangeEnd
      || intent.sourceKey !== 'compensation_component' || intent.category !== 'review'
      || intent.staffType !== 'volunteer' || intent.destination !== 'staff_vendor'
      || intent.fundId !== null || intent.componentId === null
      || intent.outstandingAmountMinor !== intent.grossAmountMinor || intent.grossAmountMinor <= 0
      || selected.has(intent.segmentKey)) throw conflict();
    const saved = snapshot.sources.find(source => source.segmentKey === intent.segmentKey
      && source.sourceKey === intent.sourceKey && source.componentId === intent.componentId);
    if (!saved || saved.grossAmountMinor !== intent.grossAmountMinor || saved.category !== intent.category
      || saved.destination !== intent.destination || saved.fundId !== intent.fundId || saved.ruleId !== intent.ruleId
      || saved.currency !== intent.currency || saved.staffType !== intent.staffType
      || saved.staffTypePeriodId !== intent.staffTypePeriodId || saved.earningStart !== intent.earningStart
      || saved.earningEnd !== intent.earningEnd || saved.legacyExtrapolation !== intent.legacyExtrapolation) throw conflict();
    selected.add(intent.segmentKey);
  }
  const sources = snapshot.sources.filter(source => selected.has(source.segmentKey));
  const componentIds = [...new Set(sources.map(source => source.componentId as number))];
  // A month-scoped component rule covers every staff-type segment of that component.
  if (snapshot.sources.some(source => source.sourceKey === 'compensation_component'
    && source.componentId !== null && componentIds.includes(source.componentId)
    && !selected.has(source.segmentKey))) throw conflict();
  const amountMinor = sources.reduce((sum, source) => sum + source.grossAmountMinor, 0);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw conflict();
  return { snapshot, sources, componentIds, amountMinor };
};

export const rerouteReviewFundSources = (params: {
  sources: StaffPayoutSettlementSnapshotSourceV2[];
  selectedSegmentKeys: ReadonlySet<string>;
  rulesByComponent: ReadonlyMap<number, number>;
  fundId: number;
}) => buildStaffPayoutSettlementSnapshotV2(params.sources.map(source => {
  if (!params.selectedSegmentKeys.has(source.segmentKey)) return source;
  const ruleId = params.rulesByComponent.get(source.componentId as number);
  if (!ruleId) throw conflict();
  const routing = { ruleId, destination: 'volunteer_fund' as const, fundId: params.fundId };
  // Segment identity includes the rule, destination and month. Use the same
  // canonical builder as the report; keep the evidenced earning dates intact.
  const [segment] = splitDatedEarningsByStaffTypeAndRouting({
    sourceKey: source.sourceKey, componentId: source.componentId,
    earnings: [{ date: source.earningStart, amountMinor: source.grossAmountMinor }],
    periods: [{ id: source.staffTypePeriodId, staffType: source.staffType,
      effectiveStart: source.earningStart, effectiveEnd: source.earningEnd,
      legacyExtrapolation: source.legacyExtrapolation }],
    routingByDate: new Map([[source.earningStart, routing]]),
  });
  return { ...source, ...routing, segmentKey: segment.segmentKey };
}));
