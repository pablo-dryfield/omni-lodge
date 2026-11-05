import StorefrontOrder from '../../models/StorefrontOrder';
import { getStorefrontStripeClient } from '../../finance/services/stripeClient';
import { assertCartPaymentsEditable } from '../storefrontCartPaymentGuardService';
jest.mock('../../models/StorefrontOrder.js', () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock('../../finance/services/stripeClient.js', () => ({ getStorefrontStripeClient: jest.fn(), isStorefrontStripeConfigured: () => true }));
const retrieve = jest.fn(), session = jest.fn(), transaction = {} as never;
beforeEach(() => {
  jest.resetAllMocks();
  (StorefrontOrder.findByPk as jest.Mock).mockResolvedValue({ paymentStatus: 'unpaid', stripePaymentIntentId: 'pi_existing' });
  (getStorefrontStripeClient as jest.Mock).mockReturnValue({ paymentIntents: { retrieve }, checkout: { sessions: { retrieve: session } } });
});
it.each(['processing', 'requires_capture', 'requires_action', 'succeeded'])('blocks a cart save/identity merge while payment is %s', async status => {
  retrieve.mockResolvedValue({ status });
  await expect(assertCartPaymentsEditable([{ orderId: 9 }], transaction)).rejects.toMatchObject({ status: 409 });
});
it('allows changes to an unsubmitted draft and reads each linked payment only once', async () => {
  retrieve.mockResolvedValue({ status: 'requires_payment_method' });
  await expect(assertCartPaymentsEditable([{ orderId: 9 }, { orderId: 9 }], transaction)).resolves.toBeUndefined();
  expect(retrieve).toHaveBeenCalledTimes(1);
});
it('fails closed when the payment provider cannot verify the current status', async () => {
  retrieve.mockRejectedValue(new Error('Provider unavailable'));
  await expect(assertCartPaymentsEditable([{ orderId: 9 }], transaction)).rejects.toThrow('Provider unavailable');
});
it('blocks a paid database order before calling the payment provider', async () => {
  (StorefrontOrder.findByPk as jest.Mock).mockResolvedValue({ paymentStatus: 'paid' });
  await expect(assertCartPaymentsEditable([{ orderId: 9 }], transaction)).rejects.toMatchObject({ status: 409 });
  expect(retrieve).not.toHaveBeenCalled();
});
it('also protects completed legacy hosted checkouts', async () => {
  (StorefrontOrder.findByPk as jest.Mock).mockResolvedValue({ paymentStatus: 'unpaid', stripeCheckoutSessionId: 'cs_existing' });
  session.mockResolvedValue({ status: 'complete' });
  await expect(assertCartPaymentsEditable([{ orderId: 9 }], transaction)).rejects.toMatchObject({ status: 409 });
});
