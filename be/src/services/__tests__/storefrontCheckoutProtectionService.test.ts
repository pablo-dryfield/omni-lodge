import type Stripe from 'stripe';
import { checkoutSelectionFingerprint, protectStorefrontPaymentSelection } from '../storefrontCheckoutProtectionService';
const cancel = jest.fn();
const stripe = { paymentIntents: { cancel } } as unknown as Stripe;
const intent = { id: 'pi_unsubmitted', status: 'requires_payment_method', amount: 12000, currency: 'pln' } as Stripe.PaymentIntent;
beforeEach(() => { jest.resetAllMocks(); cancel.mockResolvedValue({ status: 'canceled' }); });
it('reuses an identical unpaid selection without touching Stripe', async () => {
  await expect(protectStorefrontPaymentSelection(stripe, intent, true, 12000, 'pln')).resolves.toBe('reuse');
  expect(cancel).not.toHaveBeenCalled();
});
it('cancels an old attempt before a different selection can create its own order', async () => {
  await expect(protectStorefrontPaymentSelection(stripe, intent, false, 16400, 'pln')).resolves.toBe('replace');
  expect(cancel).toHaveBeenCalledWith('pi_unsubmitted', { cancellation_reason: 'abandoned' });
});
it.each(['processing', 'requires_capture', 'requires_action', 'succeeded'])('blocks edits during %s', async status => {
  await expect(protectStorefrontPaymentSelection(stripe, { ...intent, status } as Stripe.PaymentIntent, false, 16400, 'pln')).rejects.toMatchObject({ status: 409 });
  expect(cancel).not.toHaveBeenCalled();
});
it('blocks changes when payment starts after retrieval but before cancellation', async () => {
  cancel.mockRejectedValue(new Error('Payment already succeeded'));
  await expect(protectStorefrontPaymentSelection(stripe, intent, false, 16400, 'pln')).rejects.toMatchObject({ status: 409 });
});
it('does not reuse an amount/currency mismatch or a cancelled attempt', async () => {
  await expect(protectStorefrontPaymentSelection(stripe, intent, true, 16400, 'pln')).resolves.toBe('replace');
  await expect(protectStorefrontPaymentSelection(stripe, { ...intent, status: 'canceled' }, true, 12000, 'pln')).resolves.toBe('replace');
});
it('changes the order fingerprint for guests, extras, price or customer while ignoring object key order', () => {
  const quote = { items: [{ productId: 28, quantity: 1, addons: [] }], total: 120 };
  const customer = { email: 'guest@example.invalid' };
  expect(checkoutSelectionFingerprint(quote, customer)).toBe(checkoutSelectionFingerprint({ total: 120, items: quote.items }, customer));
  expect(checkoutSelectionFingerprint({ ...quote, total: 164 }, customer)).not.toBe(checkoutSelectionFingerprint(quote, customer));
  expect(checkoutSelectionFingerprint({ ...quote, items: [{ ...quote.items[0], quantity: 2 }] }, customer)).not.toBe(checkoutSelectionFingerprint(quote, customer));
});
