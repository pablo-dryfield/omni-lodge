import {
  canAttributeGuidingComponent,
  guidingSettlementPolicy,
  partitionGuideCommission,
  validateGuidingSettlementPolicy,
} from '../guideCommissionSettlementService.js';
import { shouldRoutePubCrawlGuidingToVolunteerBudget } from '../pubCrawlGuidingReviewTargetRoutingService.js';

const regular = { componentId: 16, productKeys: new Set(['28', '31', '__null__']), preserveLegacyRounding: true };
const halloween = { componentId: 18, productKeys: new Set(['51']), preserveLegacyRounding: false };

it('identifies both regular and Halloween earnings once, leaving other tours generic', () => {
  const result = partitionGuideCommission(518.20, [
    { productId: 28, commission: 366.60 }, { productId: 51, commission: 141.60 }, { productId: 29, commission: 10 },
  ], [regular, halloween]);
  expect(result.map(({ componentId, amount }) => ({ componentId, amount }))).toEqual([
    { componentId: 16, amount: 366.60 }, { componentId: 18, amount: 141.60 }, { componentId: null, amount: 10 },
  ]);
  expect(result.flatMap(group => group.entries)).toHaveLength(3);
});

it('keeps the old regular-crawl rounding and balances the remaining cents', () => {
  expect(partitionGuideCommission(0.03, [
    { productId: 28, commission: 0.0149 }, { productId: 51, commission: 0.0149 },
  ], [regular, halloween]).map(group => group.amount)).toEqual([0.01, 0.02]);
  const entries = [28, 51, 29].map(productId => ({ productId, commission: 1 / 3 }));
  const result = partitionGuideCommission(1, entries, [regular, halloween]);
  expect(result.map(group => group.amount)).toEqual([0.33, 0.34, 0.33]);
  expect(result.reduce((sum, group) => sum + Math.round(group.amount * 100), 0)).toBe(100);
});

it('uses the last explicit mapping for overlapping products without duplicating money', () => {
  const result = partitionGuideCommission(12, [{ productId: 51, commission: 12 }], [
    { ...regular, productKeys: new Set(['51']) }, halloween,
  ]);
  expect(result).toEqual([{ componentId: 18, amount: 12, entries: [{ productId: 51, commission: 12 }] }]);
});

it('preserves generic sources without opt-in, including legacy totals with no breakdown', () => {
  expect(partitionGuideCommission(12, [{ productId: 51, commission: 12 }], [regular])[0].componentId).toBeNull();
  expect(partitionGuideCommission(12, [], [])).toEqual([{ componentId: null, amount: 12, entries: [] }]);
  expect(partitionGuideCommission(0, [], [regular, halloween])).toEqual([]);
});

it.each([NaN, Infinity, -1])('rejects invalid total %s', total => {
  expect(() => partitionGuideCommission(total, [], [])).toThrow('Invalid guide commission total');
});

it('keeps settled historical identities unless that component was already saved', () => {
  const candidate = { legacy: false, componentId: 18, hasSettlementActivity: true,
    savedSnapshot: { version: 2, sources: [{ sourceKey: 'guide_commission', componentId: null }] } };
  expect(canAttributeGuidingComponent(candidate)).toBe(false);
  expect(canAttributeGuidingComponent({ ...candidate, savedSnapshot: null })).toBe(false);
  expect(canAttributeGuidingComponent({ ...candidate, savedSnapshot: { sources: [null, {}] } })).toBe(false);
  expect(canAttributeGuidingComponent({ ...candidate, hasSettlementActivity: false })).toBe(true);
  expect(canAttributeGuidingComponent({ ...candidate, legacy: true })).toBe(true);
  expect(canAttributeGuidingComponent({ ...candidate, savedSnapshot: { version: 2,
    sources: [{ sourceKey: 'compensation_component', componentId: 18 }] } })).toBe(true);
});

it('enables new components explicitly while keeping regular guiding compatibility', () => {
  expect(guidingSettlementPolicy({ name: 'Pub Crawl Guiding', config: {} })).toEqual({ legacy: true, enabled: true, reviewTargetRequired: true });
  expect(guidingSettlementPolicy({ name: 'NYE Pub Crawl Guiding', config: {} }).enabled).toBe(false);
  const config = { guideCommission: { settlementComponent: true, reviewTargetRequired: true } };
  const policy = guidingSettlementPolicy({ name: 'Halloween Pub Crawl Guiding', config });
  expect(policy).toEqual({ legacy: false, enabled: true, reviewTargetRequired: true });
  const staff = { staffType: 'long_term', livesInAccom: true, userTypeSlug: 'pub-crawl-guide',
    userTypeName: 'Pub Crawl Guides', reviewPaymentOverride: false, totalEligibleReviews: 14, minReviews: 15 };
  expect(policy.reviewTargetRequired && shouldRoutePubCrawlGuidingToVolunteerBudget(staff)).toBe(true);
  expect(shouldRoutePubCrawlGuidingToVolunteerBudget({ ...staff, reviewPaymentOverride: true })).toBe(false);
  expect(shouldRoutePubCrawlGuidingToVolunteerBudget({ ...staff, staffType: 'volunteer' })).toBe(false);
});

it('validates operator-configured policy switches as booleans', () => {
  expect(validateGuidingSettlementPolicy({ guideCommission: { settlementComponent: 'true' } })).toMatch(/settlementComponent must be a boolean/);
  expect(validateGuidingSettlementPolicy({ guideCommission: { reviewTargetRequired: 1 } })).toMatch(/reviewTargetRequired must be a boolean/);
  expect(validateGuidingSettlementPolicy({ guideCommission: { settlementComponent: true, reviewTargetRequired: false } })).toBeNull();
  expect(validateGuidingSettlementPolicy(undefined)).toBeNull();
});
