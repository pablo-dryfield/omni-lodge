import type StorefrontOngoingCart from '../../models/StorefrontOngoingCart';
import StorefrontPromotion from '../../models/StorefrontPromotion';
import { getConfigValue, refreshConfigCacheKeys } from '../configService';
import { quoteStorefrontCart } from '../storefrontCommerceService';
import HttpError from '../../errors/HttpError';
import { evaluateRecoveryOffer, recoveredCartWithOffer } from '../storefrontRecoveryOfferService';
import { parseRecoveryOfferRules } from '../../config/storefrontRecoveryOfferConfig';

jest.mock('../../models/StorefrontPromotion.js', () => ({ __esModule: true, default: { findByPk: jest.fn(), findAll: jest.fn() } }));
jest.mock('../configService.js', () => ({ getConfigValue: jest.fn(), refreshConfigCacheKeys: jest.fn() }));
jest.mock('../storefrontCommerceService.js', () => ({ quoteStorefrontCart: jest.fn() }));
jest.mock('../storefrontOngoingCartService.js', () => ({ ongoingCartFingerprint: (cart: unknown) => JSON.stringify(cart) }));

const rules = { guestCountMode: 'largest_group', applyAutomatically: true, rules: [
  { id: 'group', name: 'Large group', enabled: true, minGuests: 9, promotionId: 1 },
] };
const cart = (quantities = [9], metadata: object = {}) => {
  const items = quantities.map((quantity, i) => ({ productId: i + 28, productName: 'Pub Crawl', quantity, total: quantity * 100, addons: [], options: {} }));
  const total = items.reduce((sum, item) => sum + item.total, 0);
  return { cart: { items }, quoteSnapshot: { items, total, currency: 'PLN', discounts: [] }, metadata,
    recoveryToken: 'token', firstRecoverySentAt: new Date() } as unknown as StorefrontOngoingCart;
};
const baseline = (input: StorefrontOngoingCart) => input.quoteSnapshot;
const discounted = (input: StorefrontOngoingCart, id = 1, amount = 90) => ({ ...input.quoteSnapshot,
  total: input.quoteSnapshot.total - amount, discountTotal: amount,
  discounts: [{ promotionId: id, code: `GROUP${id}`, amount }],
});
beforeEach(() => {
  jest.resetAllMocks();
  (getConfigValue as jest.Mock).mockReturnValue(rules);
  (refreshConfigCacheKeys as jest.Mock).mockResolvedValue(undefined);
  (StorefrontPromotion.findByPk as jest.Mock).mockImplementation(async id => ({ id, code: `GROUP${id}`, name: 'Group discount', isActive: true, validTo: null }));
});

it('offers the coupon for 9 guests, not 8, and refreshes live configuration', async () => {
  const small = await evaluateRecoveryOffer(cart([8]));
  expect(small.offer).toBeNull(); expect(quoteStorefrontCart).not.toHaveBeenCalled();
  const big = cart();
  (quoteStorefrontCart as jest.Mock).mockResolvedValueOnce(baseline(big)).mockResolvedValueOnce(discounted(big));
  const result = await evaluateRecoveryOffer(big);
  expect(result.offer).toMatchObject({ code: 'GROUP1', amount: 90, source: 'rule', total: 810 });
  expect(refreshConfigCacheKeys).toHaveBeenCalledWith(['STOREFRONT_RECOVERY_OFFER_RULES', 'STOREFRONT_RECOVERY_EMAIL_SHOW_MEETING_POINT']);
});

it('does not count the same five-person group twice unless total-guests mode is selected', async () => {
  const two = cart([5, 5]);
  expect((await evaluateRecoveryOffer(two)).offer).toBeNull();
  (getConfigValue as jest.Mock).mockReturnValue({ ...rules, guestCountMode: 'total_guests' });
  (quoteStorefrontCart as jest.Mock).mockResolvedValueOnce(baseline(two)).mockResolvedValueOnce(discounted(two));
  expect((await evaluateRecoveryOffer(two)).groupSize).toBe(10);
});

it('manual selection bypasses group size while no-offer overrides automatic rules', async () => {
  const manual = cart([1], { recoveryOfferOverride: { mode: 'coupon', promotionId: 2 } });
  (quoteStorefrontCart as jest.Mock).mockResolvedValueOnce(baseline(manual)).mockResolvedValueOnce(discounted(manual, 2, 10));
  expect((await evaluateRecoveryOffer(manual)).offer).toMatchObject({ promotionId: 2, source: 'manual' });
  expect((await evaluateRecoveryOffer(cart([20], { recoveryOfferOverride: { mode: 'none' } }))).offer).toBeNull();
  expect(quoteStorefrontCart).toHaveBeenCalledTimes(2);
});

it('skips an expired automatic coupon and tries the next matching rule', async () => {
  const input = cart();
  (getConfigValue as jest.Mock).mockReturnValue({ ...rules, rules: [...rules.rules,
    { ...rules.rules[0], id: 'backup', promotionId: 2 }] });
  (quoteStorefrontCart as jest.Mock).mockResolvedValueOnce(baseline(input))
    .mockRejectedValueOnce(new HttpError(400, 'Expired coupon')).mockResolvedValueOnce(discounted(input, 2));
  const result = await evaluateRecoveryOffer(input);
  expect(result.offer?.promotionId).toBe(2); expect(result.warnings[0]).toContain('Expired coupon');
});

it('keeps a better existing discount and flags an invalid manual offer without losing its editor', async () => {
  const input = cart([9], { recoveryOfferOverride: { mode: 'coupon', promotionId: 1 } });
  (quoteStorefrontCart as jest.Mock).mockResolvedValue(baseline(input));
  const result = await evaluateRecoveryOffer(input);
  expect(result.offer).toBeNull(); expect(result.error).toContain('equal or better discount');
});

it('changes the preview version when an offer changes', async () => {
  const input = cart();
  (quoteStorefrontCart as jest.Mock).mockResolvedValueOnce(baseline(input)).mockResolvedValueOnce(discounted(input, 1, 90));
  const first = await evaluateRecoveryOffer(input);
  (quoteStorefrontCart as jest.Mock).mockResolvedValueOnce(baseline(input)).mockResolvedValueOnce(discounted(input, 1, 100));
  const second = await evaluateRecoveryOffer(input);
  expect(first.previewVersion).not.toBe(second.previewVersion);
});

it('invalidates a preview when the meeting-section switch changes', async () => {
  const input = cart([1]);
  (getConfigValue as jest.Mock).mockImplementation(key => key === 'STOREFRONT_RECOVERY_EMAIL_SHOW_MEETING_POINT' ? false : rules);
  const hidden = await evaluateRecoveryOffer(input);
  (getConfigValue as jest.Mock).mockImplementation(key => key === 'STOREFRONT_RECOVERY_EMAIL_SHOW_MEETING_POINT' ? true : rules);
  const visible = await evaluateRecoveryOffer(input);
  expect(hidden.offer).toBeNull(); expect(visible.offer).toBeNull();
  expect(hidden.previewVersion).not.toBe(visible.previewVersion);
});

it('applies only the exact sent offer through a matching email link without saving the cart', async () => {
  const input = cart();
  (quoteStorefrontCart as jest.Mock).mockResolvedValueOnce(baseline(input)).mockResolvedValueOnce(discounted(input));
  const prepared = await evaluateRecoveryOffer(input);
  input.metadata = { recoveryOfferSent: { ...prepared.offer, previewVersion: prepared.previewVersion } };
  (quoteStorefrontCart as jest.Mock).mockResolvedValue(discounted(input));
  const result = await recoveredCartWithOffer(input, `token.${prepared.previewVersion}`, baseline(input));
  expect(result.cart.discountCodes).toEqual(['GROUP1']);
  expect(input.cart.discountCodes).toBeUndefined();
  const untracked = await recoveredCartWithOffer(input, 'wrong-token', baseline(input));
  expect(untracked.cart).toBe(input.cart);
});

it('preserves the coupon advertised in an older email and revalidates it at recovery', async () => {
  const input = cart();
  (quoteStorefrontCart as jest.Mock).mockResolvedValueOnce(baseline(input)).mockResolvedValueOnce(discounted(input));
  const old = await evaluateRecoveryOffer(input);
  input.metadata = { recoveryOfferSent: null, events: [{ type: 'recovery_email_sent', details: { previewVersion: old.previewVersion, offer: old.offer } }] };
  (quoteStorefrontCart as jest.Mock).mockResolvedValueOnce(discounted(input));
  expect((await recoveredCartWithOffer(input, `token.${old.previewVersion}`, baseline(input))).cart.discountCode).toBe('GROUP1');
  (quoteStorefrontCart as jest.Mock).mockRejectedValueOnce(new HttpError(400, 'Coupon exhausted'));
  expect((await recoveredCartWithOffer(input, `token.${old.previewVersion}`, baseline(input))).cart).toBe(input.cart);
  input.cart = { ...input.cart, discountCode: 'CUSTOMER-EDIT' };
  expect((await recoveredCartWithOffer(input, `token.${old.previewVersion}`, baseline(input))).cart).toBe(input.cart);
});

it.each([
  { ...rules, rules: [{ ...rules.rules[0], minGuests: 0 }] },
  { ...rules, rules: [{ ...rules.rules[0], promotionId: -1 }] },
  { ...rules, rules: [rules.rules[0], rules.rules[0]] },
  { ...rules, guestCountMode: 'anything' },
])('rejects invalid configuration before it is saved', invalid => {
  expect(() => parseRecoveryOfferRules(invalid)).toThrow();
});
