jest.mock('../../../models/Partner.js', () => ({ PartnerPayment: { findOrCreate: jest.fn(), findAll: jest.fn() } }));
jest.mock('../../../finance/services/stripeClient.js', () => ({ getStorefrontStripeClient: jest.fn() }));
import { PartnerPayment } from '../../../models/Partner';
import { getStorefrontStripeClient } from '../../../finance/services/stripeClient';
import { refundPartnerPayments, verifiedPartnerPayments } from '../partnerPaymentLedger';
import { hashToken } from '../partnerPolicy';

const order = { publicId: 'order', stripePaymentIntentId: 'pi_initial' } as any;
const booking = { id: 9, total: 150, commission: 30 } as any;
const transaction = { LOCK: { UPDATE: 'update' } } as any;
let stripe: any;
beforeEach(() => {
  jest.resetAllMocks();
  (PartnerPayment.findAll as jest.Mock).mockResolvedValue([
    { id: 1, reference: 'initial', amount: 100, paymentIntentId: 'pi_initial' },
    { id: 2, reference: 'amendment-2', amount: 50, paymentIntentId: 'pi_extra' },
  ]);
  stripe = { paymentIntents: { retrieve: jest.fn(async (id: string) => ({ id, status: 'succeeded', amount_received: id === 'pi_initial' ? 10000 : 5000, currency: 'pln', metadata: id === 'pi_initial' ? { orderPublicId: 'order' } : { partnerPaymentReference: 'amendment-2', partnerBookingId: '9' }, latest_charge: { paid: true, amount: id === 'pi_initial' ? 10000 : 5000, amount_refunded: 0 } })) }, refunds: { list: jest.fn().mockResolvedValue({ data: [], has_more: false }), create: jest.fn(async (params: any) => ({ id: 'refund_' + params.payment_intent, amount: params.amount, status: 'succeeded' })) } };
  (getStorefrontStripeClient as jest.Mock).mockReturnValue(stripe);
});
it('refunds across the latest and original charges without losing payment identity', async () => {
  const result = await refundPartnerPayments(order, booking, 75, 'request', 'Customer adjustment', transaction);
  expect(result.map(row => row.amount)).toEqual([50, 25]);
  expect(stripe.refunds.create).toHaveBeenNthCalledWith(1, expect.objectContaining({ payment_intent: 'pi_extra', amount: 5000 }), expect.anything());
  expect(stripe.refunds.create).toHaveBeenNthCalledWith(2, expect.objectContaining({ payment_intent: 'pi_initial', amount: 2500 }), expect.anything());
});
it('rejects an excessive refund before any provider mutation', async () => {
  await expect(refundPartnerPayments(order, booking, 150.01, 'request', 'Reason', transaction)).rejects.toThrow(/exceeds/);
  expect(stripe.refunds.create).not.toHaveBeenCalled();
});
it('recovers a completed refund part before continuing the remaining original charge', async () => {
  stripe.refunds.list.mockImplementation(async ({ payment_intent }: any) => ({ data: payment_intent === 'pi_extra' ? [{ id: 're_existing', amount: 5000, status: 'succeeded', metadata: { partnerOperation: hashToken('9:request:2'), partnerRequestedMinor: '7500' } }] : [], has_more: false }));
  const result = await refundPartnerPayments(order, booking, 75, 'request', 'Reason', transaction);
  expect(result[0].refundId).toBe('re_existing');
  expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
  expect(stripe.refunds.create).toHaveBeenCalledWith(expect.objectContaining({ payment_intent: 'pi_initial', amount: 2500 }), expect.anything());
});
it('does not trust a succeeded payment from another booking', async () => {
  stripe.paymentIntents.retrieve.mockResolvedValue({ status: 'succeeded', amount_received: 10000, currency: 'pln', metadata: { orderPublicId: 'another-order' } });
  await expect(verifiedPartnerPayments(order, booking, transaction)).rejects.toThrow(/does not match/);
});
