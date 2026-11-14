import HttpError from '../../errors/HttpError.js';
import type { StorefrontQuote } from '../storefrontCommerceService.js';
import { allocateRefundMinor } from './partnerRefundAllocation.js';

export type PartnerCommissionRule = { type: 'fixed' | 'percentage'; basis: 'person' | 'experience' | 'booking'; value: number };
export type PartnerProductCommission = { productId: number; rule: PartnerCommissionRule };
export type PartnerCommissionConfiguration = {
  commissionPercent: number;
  commissionRule?: PartnerCommissionRule | null;
  productCommissions?: PartnerProductCommission[];
};
export type PartnerCommissionCalculation = {
  version: 1; currency: 'PLN'; total: number; commission: number;
  groups: Array<{ productId: number | null; rule: PartnerCommissionRule; units: number; base: number; commission: number }>;
};
const cents = (value: number) => Math.round((value + Number.EPSILON) * 100);

export function parseCommissionRule(value: unknown): PartnerCommissionRule {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'A commission rule is required.');
  const x = value as Record<string, unknown>;
  if (Object.keys(x).some(key => !['type', 'basis', 'value'].includes(key)) || !['fixed', 'percentage'].includes(String(x.type))
    || !['person', 'experience', 'booking'].includes(String(x.basis)) || typeof x.value !== 'number'
    || !Number.isFinite(x.value) || x.value < 0 || x.value > (x.type === 'percentage' ? 100 : 1000000)
    || cents(x.value) / 100 !== x.value) throw new HttpError(400, 'Use a valid commission type, basis and non-negative rate with up to two decimals.');
  return { type: x.type as PartnerCommissionRule['type'], basis: x.basis as PartnerCommissionRule['basis'], value: x.value };
}

export const defaultCommissionRule = (agreement: PartnerCommissionConfiguration): PartnerCommissionRule =>
  agreement.commissionRule ?? { type: 'percentage', basis: 'booking', value: agreement.commissionPercent };

/** Discounts use the same integer allocation as operational booking projection.
 * A departure is a product/date/time, even if it appears on several guest lines.
 * Percentages apply to the discounted price, never the entire price per guest.
 */
export function calculatePartnerCommission(agreement: PartnerCommissionConfiguration, quote: Pick<StorefrontQuote, 'currency' | 'items' | 'discountTotal' | 'total'>): PartnerCommissionCalculation {
  if (quote.currency !== 'PLN') throw new HttpError(400, 'Partner fixed commission rates are configured in PLN.');
  const gross = quote.items.map(item => cents(item.total));
  const discounts = allocateRefundMinor(cents(quote.discountTotal), gross);
  const overrides = new Map((agreement.productCommissions ?? []).map(value => [value.productId, value.rule]));
  const groups = new Map<number | null, { rule: PartnerCommissionRule; base: number; guests: number; departures: Set<string> }>();
  quote.items.forEach((item, index) => {
    const key = overrides.has(item.productId) ? item.productId : null;
    const group = groups.get(key) ?? { rule: overrides.get(item.productId) ?? defaultCommissionRule(agreement), base: 0, guests: 0, departures: new Set<string>() };
    group.base += gross[index] - discounts[index];
    group.guests += item.quantity;
    group.departures.add(JSON.stringify([item.productId, item.experienceDate, item.experienceTime]));
    groups.set(key, group);
  });
  const breakdown = [...groups].map(([productId, group]) => {
    const units = group.rule.basis === 'person' ? group.guests : group.rule.basis === 'experience' ? group.departures.size : 1;
    const requested = group.rule.type === 'percentage' ? Math.round(group.base * group.rule.value / 100) : cents(group.rule.value) * units;
    const commission = requested;
    return { productId, rule: group.rule, units, base: group.base / 100, commission: commission / 100 };
  });
  const commission = breakdown.reduce((sum, group) => sum + cents(group.commission), 0);
  if (commission > cents(quote.total)) throw new HttpError(400, 'Partner commission exceeds the customer total. Review the commission rule or discount.');
  return { version: 1, currency: 'PLN', total: quote.total, commission: commission / 100, groups: breakdown };
}

/** The current quote already includes amendment credits. Only the remaining
 * customer money reduces percentage commission. Fixed commission is retained
 * until the booked units change; refunds can therefore create a platform cost.
 * Cancelled/disputed sales earn zero.
 */
export function earnedRuleCommission(calculation: PartnerCommissionCalculation, retained: number, cancelled = false): number {
  if (cancelled || calculation.total <= 0) return 0;
  const ratio = Math.max(0, Math.min(1, retained / calculation.total));
  const result = calculation.groups.reduce((sum, group) => sum + Math.round(cents(group.commission)
    * (group.rule.type === 'fixed' ? 1 : ratio)), 0);
  return result / 100;
}
