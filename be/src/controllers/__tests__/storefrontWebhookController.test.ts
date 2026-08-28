import { getStorefrontStripeClient } from '../../finance/services/stripeClient';
import StorefrontOrder from '../../models/StorefrontOrder';
import { getConfigValueRaw } from '../../services/configService';
import { recordOngoingCartEventByIdentity } from '../../services/storefrontOngoingCartService';
import { storefrontStripeWebhook } from '../storefrontWebhookController';
import { fulfillPaidOrder } from '../storefrontCommerceController';

jest.mock('../../finance/services/stripeClient.js', () => ({
  getStorefrontStripeClient: jest.fn(),
  storefrontStripeWebhookConfigKey: jest.fn(() => 'STOREFRONT_STRIPE_TEST_WEBHOOK_SECRET'),
}));
jest.mock('../../models/StorefrontOrder.js', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));
jest.mock('../../services/configService.js', () => ({ getConfigValueRaw: jest.fn() }));
jest.mock('../../services/storefrontOngoingCartService.js', () => ({
  recordOngoingCartEventByIdentity: jest.fn(),
}));
jest.mock('../storefrontCommerceController.js', () => ({ fulfillPaidOrder: jest.fn() }));
jest.mock('../../utils/logger.js', () => ({
  __esModule: true,
  default: { info: jest.fn() },
}));

const mockedStripeClient = getStorefrontStripeClient as jest.MockedFunction<typeof getStorefrontStripeClient>;
const mockedGetConfig = getConfigValueRaw as jest.MockedFunction<typeof getConfigValueRaw>;
const mockedRecordEvent = recordOngoingCartEventByIdentity as jest.MockedFunction<
  typeof recordOngoingCartEventByIdentity
>;
const mockedFulfill = fulfillPaidOrder as jest.MockedFunction<typeof fulfillPaidOrder>;
const mockedOrder = StorefrontOrder as unknown as { findOne: jest.Mock };

const response = () => {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  return { json, status };
};

describe('storefront Stripe webhook activity tracking', () => {
  const constructEvent = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetConfig.mockReturnValue('whsec_test');
    mockedStripeClient.mockReturnValue({
      webhooks: { constructEvent },
    } as never);
  });

  it('records a sanitized card or 3DS failure and resets recovery timing', async () => {
    constructEvent.mockReturnValue({
      id: 'evt_failed',
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: 'pi_failed',
          metadata: { orderPublicId: 'order-1', ongoingCartPublicId: 'cart-1' },
          last_payment_error: {
            type: 'card_error',
            code: 'card_declined',
            decline_code: 'generic_decline',
            message: 'Your card was declined.',
            payment_method: { id: 'pm_private' },
          },
        },
      },
    });
    const res = response();

    await storefrontStripeWebhook(
      { headers: { 'stripe-signature': 'signature' }, body: Buffer.from('{}') } as never,
      res as never,
      jest.fn(),
    );

    expect(mockedRecordEvent).toHaveBeenCalledWith(
      { publicId: 'cart-1' },
      expect.objectContaining({
        type: 'payment_failed',
        details: {
          stripeEventId: 'evt_failed',
          paymentIntentId: 'pi_failed',
          orderPublicId: 'order-1',
          errorType: 'card_error',
          code: 'card_declined',
          declineCode: 'generic_decline',
        },
        dedupeKey: 'stripe:evt_failed',
      }),
      { resetRecoveryDue: true },
    );
    expect(JSON.stringify(mockedRecordEvent.mock.calls[0])).not.toContain('pm_private');
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it('records checkout expiry without postponing cart recovery', async () => {
    constructEvent.mockReturnValue({
      id: 'evt_expired',
      type: 'checkout.session.expired',
      data: {
        object: {
          id: 'cs_expired',
          metadata: { orderPublicId: 'order-2', ongoingCartPublicId: 'cart-2' },
        },
      },
    });
    const res = response();

    await storefrontStripeWebhook(
      { headers: { 'stripe-signature': 'signature' }, body: Buffer.from('{}') } as never,
      res as never,
      jest.fn(),
    );

    expect(mockedRecordEvent).toHaveBeenCalledWith(
      { publicId: 'cart-2' },
      expect.objectContaining({ type: 'checkout_expired' }),
      { resetRecoveryDue: false },
    );
  });

  it('ignores expiry events for sessions deliberately replaced by the storefront', async () => {
    constructEvent.mockReturnValue({
      id: 'evt_replaced',
      type: 'checkout.session.expired',
      data: {
        object: {
          id: 'cs_replaced',
          metadata: { orderPublicId: 'order-3', ongoingCartPublicId: 'cart-3', ktkReplaced: 'true' },
        },
      },
    });
    const res = response();

    await storefrontStripeWebhook(
      { headers: { 'stripe-signature': 'signature' }, body: Buffer.from('{}') } as never,
      res as never,
      jest.fn(),
    );

    expect(mockedRecordEvent).not.toHaveBeenCalled();
  });

  it('ignores cancellation events for payment intents deliberately replaced by the storefront', async () => {
    constructEvent.mockReturnValue({
      id: 'evt_pi_replaced',
      type: 'payment_intent.canceled',
      data: {
        object: {
          id: 'pi_replaced',
          metadata: { orderPublicId: 'order-3', ongoingCartPublicId: 'cart-3', ktkReplaced: 'true' },
          cancellation_reason: 'abandoned',
        },
      },
    });
    const res = response();

    await storefrontStripeWebhook(
      { headers: { 'stripe-signature': 'signature' }, body: Buffer.from('{}') } as never,
      res as never,
      jest.fn(),
    );

    expect(mockedRecordEvent).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it('keeps successful checkout fulfillment unchanged', async () => {
    constructEvent.mockReturnValue({
      id: 'evt_paid',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_paid',
          payment_status: 'paid',
          metadata: { orderPublicId: 'order-4' },
        },
      },
    });
    const res = response();

    await storefrontStripeWebhook(
      { headers: { 'stripe-signature': 'signature' }, body: Buffer.from('{}') } as never,
      res as never,
      jest.fn(),
    );

    expect(mockedFulfill).toHaveBeenCalledWith('order-4', expect.objectContaining({ id: 'cs_paid' }));
    expect(mockedOrder.findOne).not.toHaveBeenCalled();
  });

  it('fulfills Payment Element orders from payment_intent.succeeded', async () => {
    constructEvent.mockReturnValue({
      id: 'evt_pi_paid',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_paid',
          object: 'payment_intent',
          livemode: false,
          status: 'succeeded',
          metadata: { orderPublicId: 'order-5', ongoingCartPublicId: 'cart-5' },
        },
      },
    });
    const res = response();

    await storefrontStripeWebhook(
      { headers: { 'stripe-signature': 'signature' }, body: Buffer.from('{}') } as never,
      res as never,
      jest.fn(),
    );

    expect(mockedFulfill).toHaveBeenCalledWith(
      'order-5',
      expect.objectContaining({ id: 'pi_paid', status: 'succeeded' }),
    );
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });
});
