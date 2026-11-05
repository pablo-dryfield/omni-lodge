import StorefrontOngoingCart from '../../models/StorefrontOngoingCart';
import sequelize from '../../config/database';
import { getConfigValue } from '../configService';
import { quoteStorefrontCart, type StorefrontQuote } from '../storefrontCommerceService';
import { normalizeSavedCartCustomer, normalizeSavedCartFromQuote } from '../storefrontSavedCartService';
import { recordServerJourneyEvent } from '../storefrontJourneyService';
import {
  markOngoingCartConverted,
  assertOngoingCartVersion,
  ongoingCartFingerprint,
  recordOngoingCartEvent,
  recordOngoingCartEventByIdentity,
  upsertOngoingCart,
} from '../storefrontOngoingCartService';

jest.mock('../../config/database.js', () => ({ __esModule: true, default: { transaction: jest.fn(), query: jest.fn() } }));
jest.mock('../storefrontCartBookingMatchService.js', () => ({ dismissCartWithPaidMatch: jest.fn() }));
jest.mock('../storefrontCartPaymentGuardService.js', () => ({ assertCartPaymentsEditable: jest.fn() }));

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
const transaction = { LOCK: { UPDATE: 'UPDATE' } };
const experience = { productId: 28, quantity: 2, experienceDate: '2026-08-29', experienceTime: '21:00' };

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
    jest.resetAllMocks();
    (sequelize.transaction as jest.Mock).mockImplementation(callback => callback(transaction));
    (sequelize.query as jest.Mock).mockResolvedValue([]);
    model.findAll.mockResolvedValue([]);
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
    }), { transaction });
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
      transaction, lock: 'UPDATE',
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

  it('keeps a new browser selection and archives the old matching cart without returning its payment context', async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    const duplicate = {
      id: 10, publicId: 'old-public-id', orderId: 70,
      status: 'active',
      customer: mockedCustomer(),
      cart: { items: [] },
      metadata: {},
      update,
    };
    const current = { id: 11, publicId: 'new-public-id', metadata: {}, update: jest.fn().mockResolvedValue(undefined) };
    model.create.mockResolvedValue(current);
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

    expect(result).toBe(current);
    expect(model.create).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'd4087928-d6ac-4de3-8c27-532960f4df77', cart: { items: [] }, orderId: null,
    }), { transaction });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'dismissed',
      metadata: expect.objectContaining({
        mergedIntoCartPublicId: 'new-public-id', mergeReason: 'customer_identity',
      }),
    }), { transaction });
    expect(current.update).toHaveBeenCalledWith({ metadata: { mergedCartIds: [10], identityReview: null } }, { transaction });
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

  it('keeps exact-name matches separate and marks them for contact review', async () => {
    const duplicate = { id: 10, customer: { ...mockedCustomer(), email: 'other@example.com', phone: '600100200' }, update: jest.fn() };
    const current = { id: 11, metadata: {}, update: jest.fn() };
    model.findOne.mockResolvedValue(null);
    model.findAll.mockResolvedValueOnce([]).mockResolvedValueOnce([duplicate]);
    model.create.mockResolvedValue(current);
    await upsertOngoingCart({ sessionId: 'd4087928-d6ac-4de3-8c27-532960f4df77', cart: {}, customer: {}, quote });
    expect(duplicate.update).not.toHaveBeenCalled();
    expect(current.update).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({
      identityReview: { reason: 'Name matches; email and phone do not.', candidateCartIds: [10] },
    }) }), { transaction });
  });

  it('accepts newly submitted selections from a superseded browser without returning the successor cart', async () => {
    model.findOne.mockResolvedValueOnce({ status: 'dismissed', metadata: { mergeReason: 'customer_identity' } }).mockResolvedValueOnce(null);
    const current = { id: 12, publicId: 'new-independent-id', metadata: {} };
    model.create.mockResolvedValue(current);
    const result = await upsertOngoingCart({ sessionId: 'd4087928-d6ac-4de3-8c27-532960f4df77',
      publicId: '25ae7a5a-1dc8-4ef0-a404-5b0e1bf6af8d', cart: {}, customer: {}, quote });
    expect(result).toBe(current);
    expect(model.create).toHaveBeenCalledWith(expect.objectContaining({ orderId: null }), { transaction });
  });

  it('does not change selections while a matching cart is sending recovery', async () => {
    const update = jest.fn();
    model.findOne.mockResolvedValue({ id: 12, status: 'sending_recovery', update });
    await expect(upsertOngoingCart({ sessionId: 'd4087928-d6ac-4de3-8c27-532960f4df77',
      cart: {}, customer: {}, quote })).rejects.toMatchObject({ status: 409 });
    expect(update).not.toHaveBeenCalled();
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

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'checkout_started' }), { transaction });
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

  it('dismisses an older matching experience after payment despite changed guest count and discount', async () => {
    const paidUpdate = jest.fn().mockResolvedValue(undefined);
    const duplicateUpdate = jest.fn().mockResolvedValue(undefined);
    const customer = mockedCustomer();
    const paid = {
      id: 1,
      publicId: '25ae7a5a-1dc8-4ef0-a404-5b0e1bf6af8d',
      sessionId: 'd4087928-d6ac-4de3-8c27-532960f4df77',
      customer,
      cart: { items: [experience], discountCode: 'STUDENT' },
      metadata: {},
      recoveryOpenedAt: null,
      recoveredAt: null,
      update: paidUpdate,
    };
    const duplicate = {
      id: 2,
      sessionId: paid.sessionId,
      customer,
      cart: { items: [{ ...experience, quantity: 3 }] },
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

  it.each([
    { cart: { items: [{ ...experience, experienceDate: '2026-08-30' }] } },
    { cart: { items: [{ ...experience, experienceTime: '19:30' }] } },
    { cart: { items: [{ ...experience, productId: 99 }] } },
    { createdAt: new Date('2026-08-27T12:00:00Z') },
  ])('keeps a different trip or a cart created after payment active: %j', async difference => {
    const duplicate = { id: 2, customer: mockedCustomer(), cart: { items: [experience] }, update: jest.fn(), ...difference };
    model.findAll.mockResolvedValueOnce([]).mockResolvedValueOnce([duplicate]);
    await markOngoingCartConverted(41001, new Date('2026-08-26T12:00:00Z'), undefined, {
      customer: mockedCustomer()!, cart: { items: [experience] },
    });
    expect(duplicate.update).not.toHaveBeenCalled();
  });

  it('detaches an earlier paid order when its cart now contains a different date', async () => {
    const current = { id: 1, customer: mockedCustomer(), cart: { items: [{ ...experience, experienceDate: '2026-08-30' }] }, metadata: {}, update: jest.fn() };
    model.findAll.mockResolvedValueOnce([current]).mockResolvedValueOnce([]);
    await markOngoingCartConverted(41001, new Date(), undefined, { customer: mockedCustomer()!, cart: { items: [experience] } });
    expect(current.update).toHaveBeenCalledWith({ orderId: null, metadata: { previousPaidOrderId: 41001 } }, { transaction: undefined });
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


describe('cart revision protection', () => {
  const selection = { items: [experience] };
  const current = () => ({ status: 'active', metadata: { cartVersionProtocol: 1 }, cart: selection } as unknown as StorefrontOngoingCart);
  it('rejects an older device changing a newer selection', () => {
    expect(() => assertOngoingCartVersion(current(), 'a'.repeat(64), { items: [{ ...experience, quantity: 3 }] }, 1)).toThrow('changed on another device');
  });
  it('accepts a known current version and idempotent retries', () => {
    expect(() => assertOngoingCartVersion(current(), ongoingCartFingerprint(selection), { items: [{ ...experience, quantity: 3 }] }, 1)).not.toThrow();
    expect(() => assertOngoingCartVersion(current(), 'a'.repeat(64), selection, 1)).not.toThrow();
  });
  it('rejects superseded device IDs without revealing another cart', () => {
    const cart = { ...current(), status: 'dismissed', metadata: { mergeReason: 'customer_identity', cartVersionProtocol: 1 } } as unknown as StorefrontOngoingCart;
    expect(() => assertOngoingCartVersion(cart, ongoingCartFingerprint(selection), selection, 1)).toThrow('changed on another device');
  });
  it('does not require a version for an existing legacy client until a versioned client saves it', () => {
    expect(() => assertOngoingCartVersion({ ...current(), metadata: {} } as unknown as StorefrontOngoingCart, undefined, { items: [] })).not.toThrow();
    expect(() => assertOngoingCartVersion(current(), undefined, { items: [] })).toThrow('changed on another device');
  });
});
