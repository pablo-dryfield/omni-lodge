import type { StorefrontQuote } from '../../storefrontCommerceService.js';
import { calculatePartnerCommission, earnedRuleCommission, parseCommissionRule, type PartnerCommissionRule } from '../partnerCommission.js';
import { defaultAgreement, parseAgreement } from '../partnerPolicy.js';

const quote = (lines: Array<Pick<StorefrontQuote['items'][number], 'productId' | 'quantity' | 'total' | 'experienceDate' | 'experienceTime'>> = [{ productId: 28, quantity: 4, total: 400, experienceDate: '2027-01-01', experienceTime: '17:00' },
  { productId: 44, quantity: 4, total: 400, experienceDate: '2027-01-02', experienceTime: '19:30' }], discount = 0) =>
  ({ currency: 'PLN', items: lines, discountTotal: discount, total: lines.reduce((sum, row) => sum + row.total, 0) - discount }) as StorefrontQuote;
const agreement = (rule: PartnerCommissionRule) => ({ ...defaultAgreement, productIds: [28, 44], commissionRule: rule });

it.each([['person', 80], ['experience', 20], ['booking', 10]] as const)('charges fixed amounts per %s', (basis, expected) => {
  const result = calculatePartnerCommission(agreement({ type: 'fixed', basis, value: 10 }), quote());
  expect(result.commission).toBe(expected);
});
it.each(['person', 'experience', 'booking'] as const)('applies the percentage to the discounted price per %s without multiplying the price by guests again', basis => {
  expect(calculatePartnerCommission(agreement({ type: 'percentage', basis, value: 10 }), quote(undefined, 80)).commission).toBe(72);
});
it('preserves legacy percentage agreements', () => {
  expect(calculatePartnerCommission({ commissionPercent: 12.5 }, quote()).commission).toBe(100);
});
it('treats duplicate lines on one departure as one experience and different NYE times as separate experiences', () => {
  const lines = [{ productId: 28, quantity: 2, total: 200, experienceDate: '2026-12-31', experienceTime: '17:00' },
    { productId: 28, quantity: 2, total: 200, experienceDate: '2026-12-31', experienceTime: '17:00' }];
  const rule = agreement({ type: 'fixed', basis: 'experience', value: 20 });
  expect(calculatePartnerCommission(rule, quote(lines)).commission).toBe(20);
  lines[1].experienceTime = '19:30';
  expect(calculatePartnerCommission(rule, quote(lines)).commission).toBe(40);
});
it('combines a default commission and product-specific overrides', () => {
  const config = { ...agreement({ type: 'fixed', basis: 'person', value: 10 }),
    productCommissions: [{ productId: 44, rule: { type: 'percentage', basis: 'booking', value: 20 } as PartnerCommissionRule }] };
  const result = calculatePartnerCommission(config, quote());
  expect(result.commission).toBe(120);
  expect(result.groups.map(row => [row.productId, row.commission])).toEqual([[null, 40], [44, 80]]);
});
it('applies a per-booking product override once across all that product departures', () => {
  const config = { ...agreement({ type: 'fixed', basis: 'booking', value: 10 }),
    productCommissions: [{ productId: 28, rule: { type: 'fixed', basis: 'booking', value: 25 } as PartnerCommissionRule }] };
  const lines = [...quote().items, { ...quote().items[0], experienceTime: '19:30' }];
  expect(calculatePartnerCommission(config, quote(lines)).commission).toBe(35);
});
it('allocates discount cents exactly across commission rules', () => {
  const config = { ...agreement({ type: 'percentage', basis: 'booking', value: 10 }),
    productCommissions: [{ productId: 44, rule: { type: 'percentage', basis: 'booking', value: 20 } as PartnerCommissionRule }] };
  const result = calculatePartnerCommission(config, quote(undefined, 79.99));
  expect(result.groups.reduce((sum, row) => sum + Math.round(row.base * 100), 0)).toBe(72001);
  expect(result.commission).toBe(108);
});
it('rejects an initial commission above the customer price instead of silently changing the promised fixed rate', () => {
  expect(() => calculatePartnerCommission(agreement({ type: 'fixed', basis: 'person', value: 101 }), quote())).toThrow(/exceeds/);
});
it('keeps fixed commission after money-only partial refunds, including a platform-funded shortfall', () => {
  const result = calculatePartnerCommission(agreement({ type: 'fixed', basis: 'booking', value: 20 }), quote());
  expect(earnedRuleCommission(result, 10)).toBe(20);
  expect(earnedRuleCommission(result, 0)).toBe(20);
  expect(earnedRuleCommission(result, 10, true)).toBe(0);
});
it('reduces percentage fees on refunds and recalculates fixed fees when booked guests are removed', () => {
  const percent = calculatePartnerCommission(agreement({ type: 'percentage', basis: 'person', value: 20 }), quote());
  expect(earnedRuleCommission(percent, 400)).toBe(80);
  const fixed = agreement({ type: 'fixed', basis: 'person', value: 10 });
  expect(calculatePartnerCommission(fixed, quote([{ ...quote().items[0], quantity: 2 }])).commission).toBe(20);
});
it.each([{ type: 'fixed', basis: 'guest', value: 10 }, { type: 'percentage', basis: 'booking', value: 101 },
  { type: 'fixed', basis: 'person', value: -1 }, { type: 'fixed', basis: 'person', value: 1.001 },
  { type: 'fixed', basis: 'person', value: '10' }, { type: 'fixed', basis: 'person', value: Infinity },
  { type: 'fixed', basis: 'person', value: 10, privatePrice: 1 }])('rejects malformed commission rules: %j', rule => {
  expect(() => parseCommissionRule(rule)).toThrow();
});
it('validates product scope and uniqueness for overrides', () => {
  const rule = { type: 'fixed', basis: 'person', value: 10 };
  expect(() => parseAgreement({ productIds: [28], productCommissions: [{ productId: 44, rule }] })).toThrow(/approved/);
  expect(() => parseAgreement({ productIds: [28], productCommissions: [{ productId: 28, rule }, { productId: 28, rule }] })).toThrow(/one commission/);
  expect(parseAgreement({ productIds: [28], commissionRule: rule, productCommissions: [{ productId: 28, rule }] }).commissionRule).toEqual(rule);
});
