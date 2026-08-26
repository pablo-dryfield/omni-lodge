import StorefrontOngoingCart from '../../models/StorefrontOngoingCart';
import { getConfigValue } from '../configService';
import { quoteStorefrontCart, type StorefrontQuote } from '../storefrontCommerceService';
import { normalizeSavedCartCustomer, normalizeSavedCartFromQuote } from '../storefrontSavedCartService';
import {
  markOngoingCartConverted,
  recordOngoingCartEvent,
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
    });

    expect(result).toBe(existing);
    expect(mockedQuote).not.toHaveBeenCalled();
    expect(model.create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'active',
      quoteSnapshot: quote,
      recoverySentAt: null,
      recoveryMessageId: null,
    }));
    const values = update.mock.calls[0][0];
    expect(values.recoveryDueAt.getTime()).toBeGreaterThanOrEqual(before + 30 * 60_000);
  });

  it('reuses the ongoing cart public ID when the browser session ID changes', async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    const existing = { update };
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
        status: expect.any(Object),
      },
    });
    expect(update).toHaveBeenCalledTimes(1);
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
    model.findAll.mockResolvedValue([{ recoveryOpenedAt: null, recoveredAt: null, update }]);
    const paidAt = new Date('2026-08-26T12:00:00Z');

    await markOngoingCartConverted(41001, paidAt);

    expect(update).toHaveBeenCalledWith(
      { status: 'converted', convertedAt: paidAt },
      { transaction: undefined },
    );
  });

  it('marks a paid order as recovered only after its recovery email link was opened', async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    model.findAll.mockResolvedValue([{
      recoveryOpenedAt: new Date('2026-08-26T11:30:00Z'),
      recoveredAt: null,
      update,
    }]);
    const paidAt = new Date('2026-08-26T12:00:00Z');

    await markOngoingCartConverted(41001, paidAt);

    expect(update).toHaveBeenCalledWith(
      { status: 'converted', convertedAt: paidAt, recoveredAt: paidAt },
      { transaction: undefined },
    );
  });

  it('stores a customer-facing cart event without removing existing metadata', async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    const ongoing = {
      metadata: { recoveryCount: 1 },
      update,
    } as unknown as StorefrontOngoingCart;

    await recordOngoingCartEvent(ongoing, {
      type: 'checkout_cancelled',
      severity: 'warning',
      message: 'Customer returned from Stripe without completing payment.',
      details: { orderPublicId: 'order-73' },
      dedupeKey: 'checkout_cancelled:order-73',
    });

    expect(update).toHaveBeenCalledWith({
      metadata: {
        recoveryCount: 1,
        events: [expect.objectContaining({
          type: 'checkout_cancelled',
          severity: 'warning',
          details: {
            orderPublicId: 'order-73',
            dedupeKey: 'checkout_cancelled:order-73',
          },
        })],
      },
    });
  });
});
