import { createHash } from 'node:crypto';
import StorefrontPromotion from '../models/StorefrontPromotion.js';
import type StorefrontOngoingCart from '../models/StorefrontOngoingCart.js';
import HttpError from '../errors/HttpError.js';
import { DEFAULT_RECOVERY_OFFER_RULES, RECOVERY_OFFER_CONFIG_KEY, parseRecoveryOfferRules } from '../config/storefrontRecoveryOfferConfig.js';
import { getConfigValue, refreshConfigCacheKeys } from './configService.js';
import { quoteStorefrontCart, type StorefrontCartInput, type StorefrontQuote } from './storefrontCommerceService.js';
import { ongoingCartFingerprint } from './storefrontOngoingCartService.js';

export type RecoveryOfferOverride = { mode: 'automatic' | 'coupon' | 'none'; promotionId: number | null };
export type RecoveryOffer = {
  promotionId: number; code: string; name: string; amount: number; originalTotal: number; total: number;
  currency: string; source: 'rule' | 'manual'; ruleId: string | null; ruleName: string | null;
  applyAutomatically: boolean; validTo: string | null; cartFingerprint: string;
};
export type RecoveryOfferEvaluation = {
  override: RecoveryOfferOverride; groupSize: number; guestCountMode: 'largest_group' | 'total_guests';
  offer: RecoveryOffer | null; quote: StorefrontQuote; warnings: string[]; error: string | null; previewVersion: string;
};

export const parseRecoveryOfferOverride = (value: unknown): RecoveryOfferOverride => {
  if (value == null) return { mode: 'automatic', promotionId: null };
  if (typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Invalid recovery offer override.');
  const input = value as Record<string, unknown>;
  if (!['automatic', 'coupon', 'none'].includes(String(input.mode))) throw new HttpError(400, 'Choose automatic rules, a specific coupon, or no offer.');
  if (input.mode === 'coupon' && (!Number.isSafeInteger(input.promotionId) || Number(input.promotionId) <= 0)) throw new HttpError(400, 'Choose a coupon for this cart.');
  return { mode: input.mode as RecoveryOfferOverride['mode'], promotionId: input.mode === 'coupon' ? Number(input.promotionId) : null };
};

const cartWithCoupon = (cart: StorefrontCartInput, code: string): StorefrontCartInput => ({
  ...cart, discountCode: code, discountCodes: [code],
});

export const evaluateRecoveryOffer = async (ongoing: StorefrontOngoingCart): Promise<RecoveryOfferEvaluation> => {
  await refreshConfigCacheKeys([RECOVERY_OFFER_CONFIG_KEY]);
  const raw = getConfigValue(RECOVERY_OFFER_CONFIG_KEY);
  const rules = raw == null ? DEFAULT_RECOVERY_OFFER_RULES : parseRecoveryOfferRules(raw);
  const override = parseRecoveryOfferOverride(ongoing.metadata?.recoveryOfferOverride);
  const quantities = ongoing.quoteSnapshot.items.map(item => Math.max(0, Number(item.quantity) || 0));
  const groupSize = rules.guestCountMode === 'total_guests' ? quantities.reduce((a, b) => a + b, 0) : Math.max(0, ...quantities);
  const candidates = override.mode === 'coupon'
    ? [{ promotionId: override.promotionId!, id: null, name: null }]
    : override.mode === 'none' ? [] : rules.rules.filter(rule => rule.enabled && groupSize >= rule.minGuests);
  const warnings: string[] = [];
  let errorMessage: string | null = null;
  let quote = ongoing.quoteSnapshot;
  let offer: RecoveryOffer | null = null;
  if (candidates.length) {
    const baseline = await quoteStorefrontCart(ongoing.cart);
    quote = baseline;
    for (const candidate of candidates) {
      try {
        const promotion = await StorefrontPromotion.findByPk(candidate.promotionId);
        if (!promotion || !promotion.isActive) throw new HttpError(400, 'The selected coupon is missing or inactive.');
        // The commerce quote enforces validity dates, currency, products, minimum
        // spend and remaining redemptions, without reserving or redeeming a code.
        const discounted = await quoteStorefrontCart(cartWithCoupon(ongoing.cart, promotion.code));
        const discount = discounted.discounts.find(row => Number(row.promotionId) === Number(promotion.id));
        if (!discount || discounted.total >= baseline.total) throw new HttpError(400, 'This coupon does not improve the cart total. Any existing equal or better discount is kept.');
        quote = discounted;
        offer = {
          promotionId: Number(promotion.id), code: promotion.code, name: promotion.name,
          amount: Number(discount.amount), originalTotal: discounted.total + Number(discount.amount), total: discounted.total,
          currency: discounted.currency, source: override.mode === 'coupon' ? 'manual' : 'rule',
          ruleId: candidate.id, ruleName: candidate.name,
          applyAutomatically: rules.applyAutomatically,
          validTo: promotion.validTo ? new Date(promotion.validTo).toISOString() : null,
          cartFingerprint: ongoingCartFingerprint(ongoing.cart),
        };
        break;
      } catch (error) {
        if (!(error instanceof HttpError) || error.status !== 400) throw error;
        if (override.mode === 'coupon') { errorMessage = error.message; break; }
        warnings.push(`${candidate.name ?? 'Recovery rule'}: ${error.message}`);
      }
    }
  }
  const previewVersion = createHash('sha256').update(JSON.stringify({
    cart: ongoingCartFingerprint(ongoing.cart), override, rules, offer, quote, errorMessage,
  })).digest('hex');
  return { override, groupSize, guestCountMode: rules.guestCountMode, offer, quote, warnings, error: errorMessage, previewVersion };
};

export const getRecoveryCouponOptions = async () => {
  const rows = await StorefrontPromotion.findAll({ order: [['code', 'ASC']] });
  const now = Date.now();
  return rows.map(row => ({
    value: String(row.id), code: row.code,
    label: `${row.code} · ${row.name} · ${row.type === 'percentage' ? `${Number(row.value)}%` : `${row.currency} ${Number(row.value)}`}`,
    disabled: !row.isActive || Boolean(row.validFrom && new Date(row.validFrom).getTime() > now)
      || Boolean(row.validTo && new Date(row.validTo).getTime() < now)
      || (row.maxRedemptions !== null && Number(row.redemptionCount) >= Number(row.maxRedemptions)),
  }));
};

// Apply only the offer actually sent, for the same cart selection, through its
// tracked recovery link. Never mutate the saved cart during a link-open request.
export const recoveredCartWithOffer = async (
  ongoing: StorefrontOngoingCart, token: string, baseline: StorefrontQuote,
): Promise<{ cart: StorefrontCartInput; quote: StorefrontQuote }> => {
  const original = { cart: ongoing.cart, quote: baseline };
  const [baseToken, version] = token.split('.');
  if (!version || !/^[a-f0-9]{64}$/.test(version)) return original;
  const latest = ongoing.metadata?.recoveryOfferSent as (RecoveryOffer & { previewVersion?: string }) | null | undefined;
  const events = Array.isArray(ongoing.metadata?.events) ? ongoing.metadata.events : [];
  const historical = [...events].reverse().find(event => event?.type === 'recovery_email_sent' && event?.details?.previewVersion === version);
  const raw = latest?.previewVersion === version ? latest : historical?.details?.offer;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return original;
  const sent = raw as Partial<RecoveryOffer>;
  if (!baseToken || baseToken !== ongoing.recoveryToken || !ongoing.firstRecoverySentAt || sent.applyAutomatically !== true
    || sent.cartFingerprint !== ongoingCartFingerprint(ongoing.cart) || typeof sent.code !== 'string') return original;
  try {
    const cart = cartWithCoupon(ongoing.cart, sent.code);
    const quote = await quoteStorefrontCart(cart);
    if (!quote.discounts.some(row => Number(row.promotionId) === sent.promotionId) || quote.total > baseline.total) return original;
    return { cart, quote };
  } catch (error) {
    if (error instanceof HttpError && error.status === 400) return original;
    throw error;
  }
};
