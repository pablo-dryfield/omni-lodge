import StorefrontOngoingCart from '../../models/StorefrontOngoingCart';
import { getConfigValue } from '../configService';
import { quoteStorefrontCart, type StorefrontQuote } from '../storefrontCommerceService';
import { normalizeSavedCartCustomer, normalizeSavedCartFromQuote } from '../storefrontSavedCartService';
import { recordServerJourneyEvent } from '../storefrontJourneyService';
import {
  markOngoingCartConverted,
  recordOngoingCartEvent,
  recordOngoingCartEventByIdentity,
  upsertOngoingCart,
} from '../storefrontOngoingCartService';

jest.mock('../../models/StorefrontOngoingCart.js', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), findAll: jest.fn(), create: jest.fn(), update: jest.fn() },
}));
jest.mock('../configService.js', () => ({ getConfigValue: jest.fn() }));
jest.mock('../storefrontCommerceService.js', () => ({ quoteStorefrontCart: jest.fn() }));
jest.mock('../storefrontSavedCartService.js', () => ({
  normalizeSavedCartCustomer: jest.fn(),
  normalizeSavedCartFromQuote: jest.fn(),
}));
jest.mock('../storefrontJourneyService.js', () => ({ recordServerJourneyEvent: jest.fn() }));

const model = StorefrontOngoingCart as unknown as {
  findOne: jest.Mock;
  findAll: jest.Mock;
  create: jest.Mock;
  update: jest.Mock;
};
const mockedGetConfigValue = getConfigValue as jest.MockedFunction<typeof getConfigValue>;
const mockedQuote = quoteStorefrontCart as jest.MockedFunction<typeof quoteStorefrontCart>;
const mockedCustomer = normalizeSavedCartCustomer as jest.MockedFunction<typeof normalizeSavedCartCustomer>;
const mockedCart = normalizeSavedCartFromQuote as jest.MockedFunction<typeof normalizeSavedCartFromQuote>;
const mockedRecordJourneyEvent = recordServerJourneyEvent as jest.MockedFunction<
  typeof recordServerJourneyEvent
>;

const quote = {
  currency: 'PLN',
  subtotal: 120,
  addonTotal: 0,
  discountTotal: 0,
  total: 120,
  discountCode: null,
  discountCodes: [],
  promotionId: null,
  discounts: [],
  items: [],
} as StorefrontQuote;

describe('storefront ongoing cart service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetConfigValue.mockReturnValue(30);
    mockedCustomer.mockReturnValue({
      fullName: 'Alex Smith',
      email: 'alex@example.com',
      phoneCountry: 'PL',
      phone: '500100200',
    });
    mockedCart.mockReturnValue({ items: [] });
  });

  it('updates the existing browser cart and reuses the quote already calculated by the controller', async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    const existing = { update };
    model.findOne.mockResolvedValue(existing);

    const before = Date.now();
    const result = await upsertOngoingCart({
      sessionId: '25ae7a5a-1dc8-4ef0-a404-5b0e1bf6af8d',
      cart: { items: [] },
      customer: {},
      attribution: { utm_source: 'google' },
      quote,
      clientContext: {
        browserId: '7a2913c3-3a11-4b3b-8e62-af1d1ced7420',
        pageId: '71f3385a-e2f0-414e-ab9f-e66f71ef3aa4',
      },
    });

    expect(result).toBe(existing);
    expect(mockedQuote).not.toHaveBeenCalled();
    expect(model.create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'active',
      quoteSnapshot: quote,
      recoverySentAt: null,
      recoveryMessageId: null,
      metadata: expect.objectContaining({
        cartFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
        sessionIds: ['25ae7a5a-1dc8-4ef0-a404-5b0e1bf6af8d'],
        browserIds: ['7a2913c3-3a11-4b3b-8e62-af1d1ced7420'],
        pageIds: ['71f3385a-e2f0-414e-ab9f-e66f71ef3aa4'],
      }),
    }));
    const values = update.mock.calls[0][0];
    expect(values.recoveryDueAt.getTime()).toBeGreaterThanOrEqual(before + 30 * 60_000);
  });

  it('reuses the ongoing cart public ID when the browser session ID changes', async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    const existing = { status: 'active', update };
    model.findOne.mockResolvedValue(existing);

    const result = await upsertOngoingCart({
      sessionId: 'd4087928-d6ac-4de3-8c27-532960f4df77',
      publicId: '25ae7a5a-1dc8-4ef0-a404-5b0e1bf6af8d',
      cart: { items: [] },
      customer: {},
      quote,
    });

    expect(result).toBe(existing);
    expect(model.findOne).toHaveBeenCalledTimes(1);
    expect(model.findOne).toHaveBeenCalledWith({
      where: {
        publicId: '25ae7a5a-1dc8-4ef0-a404-5b0e1bf6af8d',
      },
    });
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('never creates a replacement when the requested cart has already converted', async () => {
    model.findOne.mockResolvedValue({ status: 'converted' });

    await expect(upsertOngoingCart({
      sessionId: 'd4087928-d6ac-4de3-8c27-532960f4df77',
      publicId: '25ae7a5a-1dc8-4ef0-a404-5b0e1bf6af8d',
      cart: { items: [] },
      customer: {},
      quote,
    })).rejects.toMatchObject({ status: 409, message: 'This cart has already been paid.' });

    expect(model.create).not.toHaveBeenCalled();
  });

  it('reuses an identical recent cart for the same normalized email and phone', async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    const duplicate = {
      status: 'active',
      customer: mockedCustomer(),
      cart: { items: [] },
      metadata: {},
      update,
    };
    model.findOne.mockResolvedValue(null);
    model.findAll
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([duplicate]);

    const result = await upsertOngoingCart({
      sessionId: 'd4087928-d6ac-4de3-8c27-532960f4df77',
      cart: { items: [] },
      customer: {},
      quote,
    });

    expect(result).toBe(duplicate);
    expect(model.create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        sessionIds: ['d4087928-d6ac-4de3-8c27-532960f4df77'],
      }),
    }));
  });

  it('blocks a stale quote from recreating a recently converted session cart', async () => {
    model.findOne.mockResolvedValue(null);
    model.findAll.mockResolvedValueOnce([{
      status: 'converted',
      convertedAt: new Date(),
      cart: { items: [] },
      metadata: {},
    }]);

    await expect(upsertOngoingCart({
      sessionId: 'd4087928-d6ac-4de3-8c27-532960f4df77',
      cart: { items: [] },
      customer: {},
      quote,
    })).rejects.toMatchObject({ status: 409, message: 'This cart has already been paid.' });

    expect(model.create).not.toHaveBeenCalled();
  });

  it('preserves the checkout-started milestone when the cart is quoted again', async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    model.findOne.mockResolvedValue({ status: 'checkout_started', update });

    await upsertOngoingCart({
      sessionId: 'd4087928-d6ac-4de3-8c27-532960f4df77',
      cart: { items: [] },
      customer: {},
      quote,
    });

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'checkout_started' }));
  });

  it('removes a paid order from the ongoing lifecycle without deleting its audit record', async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    model.findAll
      .mockResolvedValueOnce([{
        id: 1,
        sessionId: '25ae7a5a-1dc8-4ef0-a404-5b0e1bf6af8d',
        customer: mockedCustomer(),
        cart: { items: [] },
        metadata: {},
        recoveryOpenedAt: null,
        recoveredAt: null,
        update,
      }])
      .mockResolvedValueOnce([]);
    const paidAt = new Date('2026-08-26T12:00:00Z');

    await markOngoingCartConverted(41001, paidAt);

    expect(update).toHaveBeenCalledWith(
      { status: 'converted', convertedAt: paidAt },
      { transaction: undefined },
    );
  });

  it('marks a paid order as recovered only after its recovery email link was opened', async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    model.findAll
      .mockResolvedValueOnce([{
        id: 1,
        sessionId: '25ae7a5a-1dc8-4ef0-a404-5b0e1bf6af8d',
        customer: mockedCustomer(),
        cart: { items: [] },
        metadata: {},
        recoveryOpenedAt: new Date('2026-08-26T11:30:00Z'),
        recoveredAt: null,
        update,
      }])
      .mockResolvedValueOnce([]);
    const paidAt = new Date('2026-08-26T12:00:00Z');

    await markOngoingCartConverted(41001, paidAt);

    expect(update).toHaveBeenCalledWith(
      { status: 'converted', convertedAt: paidAt, recoveredAt: paidAt },
      { transaction: undefined },
    );
  });

  it('dismisses active duplicates from the same cart session after payment', async () => {
    const paidUpdate = jest.fn().mockResolvedValue(undefined);
    const duplicateUpdate = jest.fn().mockResolvedValue(undefined);
    const customer = mockedCustomer();
    const paid = {
      id: 1,
      publicId: '25ae7a5a-1dc8-4ef0-a404-5b0e1bf6af8d',
      sessionId: 'd4087928-d6ac-4de3-8c27-532960f4df77',
      customer,
      cart: { items: [] },
      metadata: {},
      recoveryOpenedAt: null,
      recoveredAt: null,
      update: paidUpdate,
    };
    const duplicate = {
      id: 2,
      sessionId: paid.sessionId,
      customer,
      cart: { items: [] },
      metadata: {},
      update: duplicateUpdate,
    };
    model.findAll
      .mockResolvedValueOnce([paid])
      .mockResolvedValueOnce([duplicate]);
    const paidAt = new Date('2026-08-26T12:00:00Z');

    await markOngoingCartConverted(41001, paidAt);

    expect(duplicateUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'dismissed',
      dismissedAt: paidAt,
      metadata: expect.objectContaining({
        events: [expect.objectContaining({ type: 'post_payment_duplicate_dismissed' })],
      }),
    }), { transaction: undefined });
  });

  it('stores a customer-facing cart event in the journey timeline', async () => {
    const ongoing = {
      metadata: { recoveryCount: 1 },
    } as unknown as StorefrontOngoingCart;

    await recordOngoingCartEvent(ongoing, {
      type: 'checkout_cancelled',
      severity: 'warning',
      message: 'Customer returned from Stripe without completing payment.',
      details: { orderPublicId: 'order-73' },
      dedupeKey: 'checkout_cancelled:order-73',
    });

    expect(mockedRecordJourneyEvent).toHaveBeenCalledWith(ongoing, expect.objectContaining({
      type: 'checkout_cancelled',
      severity: 'warning',
      details: { orderPublicId: 'order-73' },
      dedupeKey: 'checkout_cancelled:order-73',
    }));
  });

  it('resets recovery timing for a new Stripe payment failure', async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    model.findOne.mockResolvedValue({ metadata: { events: [] }, update });

    const before = Date.now();
    await recordOngoingCartEventByIdentity(
      { publicId: '25ae7a5a-1dc8-4ef0-a404-5b0e1bf6af8d' },
      {
        type: 'payment_failed',
        severity: 'error',
        message: 'Stripe could not complete the payment.',
        details: { code: 'card_declined' },
        dedupeKey: 'stripe:evt_test_failure',
      },
      { resetRecoveryDue: true },
    );

    expect(update).toHaveBeenNthCalledWith(1, expect.objectContaining({
      lastActivityAt: expect.any(Date),
      recoveryDueAt: expect.any(Date),
    }));
    const timing = update.mock.calls[0][0];
    expect(timing.recoveryDueAt.getTime()).toBeGreaterThanOrEqual(before + 30 * 60_000);
    expect(mockedRecordJourneyEvent).toHaveBeenCalledWith(
      expect.objectContaining({ update }),
      expect.objectContaining({ type: 'payment_failed' }),
    );
  });
});
