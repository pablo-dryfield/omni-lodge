import { quoteStorefrontCart } from '../storefrontCommerceService';
import StorefrontOngoingCart from '../../models/StorefrontOngoingCart';
import { sendMessage } from '../bookings/gmailClient';
import { getConfigValue } from '../configService';
import { dismissCartWithPaidMatch } from '../storefrontCartBookingMatchService';
import {
  buildStorefrontCartRecoveryEmail,
  refreshDuplicateRecoveryCart,
  sendAndRecordStorefrontCartRecoveryEmail,
} from '../storefrontCartRecoveryEmailService';

jest.mock('../../models/StorefrontOngoingCart.js', () => ({
  __esModule: true,
  default: { update: jest.fn() },
}));
jest.mock('../storefrontCommerceService.js', () => ({ quoteStorefrontCart: jest.fn() }));
jest.mock('../storefrontSavedCartService.js', () => ({ normalizeSavedCartFromQuote: (quote: { items: unknown[] }) => ({ items: quote.items }) }));
jest.mock('../bookings/gmailClient.js', () => ({ sendMessage: jest.fn() }));
jest.mock('../configService.js', () => ({ getConfigValue: jest.fn() }));
jest.mock('../storefrontCartBookingMatchService.js', () => ({ dismissCartWithPaidMatch: jest.fn() }));

const mockedGetConfigValue = getConfigValue as jest.MockedFunction<typeof getConfigValue>;
const mockedSendMessage = sendMessage as jest.MockedFunction<typeof sendMessage>;
const model = StorefrontOngoingCart as unknown as { update: jest.Mock };

const ongoing = {
  publicId: '25ae7a5a-1dc8-4ef0-a404-5b0e1bf6af8d',
  recoveryToken: 'f2ce385d-b2d7-40d4-8156-ec9681753af1',
  customer: {
    fullName: 'Alex Smith',
    email: 'alex@example.com',
    phoneCountry: 'GB',
    phone: '7700900123',
  },
  quoteSnapshot: {
    currency: 'PLN',
    subtotal: 240,
    addonTotal: 128,
    discountTotal: 0,
    total: 368,
    discountCode: null,
    discountCodes: [],
    promotionId: null,
    discounts: [],
    items: [{
      productId: 28,
      productName: 'Pub Crawl',
      productSlug: 'pub-crawl-28',
      quantity: 2,
      experienceDate: '2026-08-29',
      experienceTime: '21:00',
      unitPrice: 120,
      baseTotal: 240,
      addonTotal: 128,
      total: 368,
      options: { participants: { men: 1, women: 1 } },
      addons: [{
        addonId: 3,
        name: 'T-Shirts',
        quantity: 2,
        value: null,
        variants: [{ value: 'S', quantity: 1 }, { value: 'M', quantity: 1 }],
        unitPrice: 59,
        total: 118,
      }],
    }],
  },
} as unknown as StorefrontOngoingCart;

describe('storefront abandoned cart recovery email', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (dismissCartWithPaidMatch as jest.Mock).mockResolvedValue(false);
    mockedGetConfigValue.mockImplementation((key) => (
      key === 'STOREFRONT_PUBLIC_URL' ? 'https://example.com/store2/' : null
    ));
  });

  it('records a manual recovery resend without replacing its first-send timestamp', async () => {
    const firstSentAt = new Date('2026-08-26T10:00:00Z');
    const reload = jest.fn().mockResolvedValue(undefined);
    const sendingCart = {
      ...ongoing,
      id: 12,
      status: 'sending_recovery',
      firstRecoverySentAt: firstSentAt,
      recoveryCount: 1,
      metadata: { recoveryCount: 1 },
      reload,
    } as unknown as StorefrontOngoingCart;
    mockedSendMessage.mockResolvedValue({ id: 'message-2' } as never);
    model.update.mockResolvedValue([1]);

    await sendAndRecordStorefrontCartRecoveryEmail(sendingCart);

    expect(model.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'recovery_sent',
        firstRecoverySentAt: firstSentAt,
        recoveryCount: 2,
        recoveryMessageId: 'message-2',
      }),
      { where: { id: 12, status: 'sending_recovery' } },
    );
    expect(reload).toHaveBeenCalledTimes(3);
  });

  it('does not send a recovery email when the same experience is already booked and paid', async () => {
    (dismissCartWithPaidMatch as jest.Mock).mockResolvedValue(true);
    const cart = { ...ongoing, status: 'sending_recovery', reload: jest.fn() } as unknown as StorefrontOngoingCart;
    await expect(sendAndRecordStorefrontCartRecoveryEmail(cart)).rejects.toMatchObject({ status: 409 });
    expect(mockedSendMessage).not.toHaveBeenCalled();
    expect(model.update).not.toHaveBeenCalled();
  });

  it('does not send after a concurrent payment converts the claimed cart', async () => {
    const cart = { ...ongoing, status: 'sending_recovery', reload: jest.fn() };
    cart.reload.mockImplementationOnce(() => undefined).mockImplementationOnce(() => { cart.status = 'converted'; });
    await expect(sendAndRecordStorefrontCartRecoveryEmail(cart as unknown as StorefrontOngoingCart)).rejects.toMatchObject({ status: 409 });
    expect(mockedSendMessage).not.toHaveBeenCalled();
  });

  it('includes the personalized cart, selections, total, and secure recovery link', () => {
    const email = buildStorefrontCartRecoveryEmail(ongoing);

    expect(email.subject).toContain('Pub Crawl');
    expect(email.htmlBody).toContain('Hi Alex');
    expect(email.htmlBody).toContain('Pub Crawl');
    expect(email.htmlBody).toContain('29 Aug 2026');
    expect(email.htmlBody).toContain('1 man, 1 woman');
    expect(email.htmlBody).toContain('T-Shirts: S x 1, M x 1');
    expect(email.textBody).toContain('PLN');
    expect(email.recoveryUrl).toBe(
      'https://example.com/store2/cart?recover=25ae7a5a-1dc8-4ef0-a404-5b0e1bf6af8d&rt=f2ce385d-b2d7-40d4-8156-ec9681753af1',
    );
    expect(email.htmlBody).toContain(email.recoveryUrl.replace('&', '&amp;'));
  });
});


describe('legacy duplicate recovery drafts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (dismissCartWithPaidMatch as jest.Mock).mockResolvedValue(false);
    mockedGetConfigValue.mockReturnValue(null as never);
  });
  const duplicateDraft = () => {
    const latest = { ...ongoing.quoteSnapshot.items[0], quantity: 1, total: 164 };
    return { ...ongoing, id: 99, status: 'sending_recovery', total: 284, updatedAt: new Date(),
      metadata: {}, cart: { items: [{ ...latest, addons: [] }, latest] },
      quoteSnapshot: { ...ongoing.quoteSnapshot, total: 284, items: [{ ...latest, total: 120, addons: [] }, latest] },
      reload: jest.fn(),
    };
  };
  it('reprices and audits a duplicate draft before emailing only its latest selection', async () => {
    const cart = duplicateDraft();
    const quote = { ...ongoing.quoteSnapshot, total: 164, items: [cart.quoteSnapshot.items[1]] };
    (quoteStorefrontCart as jest.Mock).mockResolvedValue(quote);
    model.update.mockImplementation(async patch => {
      Object.assign(cart, patch);
      return [1];
    });
    mockedSendMessage.mockResolvedValue({ id: 'one-selection' } as never);
    await sendAndRecordStorefrontCartRecoveryEmail(cart as unknown as StorefrontOngoingCart);
    expect(model.update).toHaveBeenCalledWith(expect.objectContaining({ total: 164,
      metadata: expect.objectContaining({ events: [expect.objectContaining({ type: 'cart_item_updated' })] }),
    }), { where: { id: 99, status: 'sending_recovery', updatedAt: expect.any(Date) } });
    expect(mockedSendMessage).toHaveBeenCalledWith(expect.objectContaining({
      subject: 'Your Pub Crawl booking is still waiting',
      textBody: expect.stringContaining('164.00'),
    }));
    expect(mockedSendMessage.mock.calls[0][0].textBody?.match(/Pub Crawl -/g)).toHaveLength(1);
  });
  it('never normalizes a completed paid cart', async () => {
    const cart = { ...duplicateDraft(), status: 'converted' };
    await expect(refreshDuplicateRecoveryCart(cart as unknown as StorefrontOngoingCart)).rejects.toMatchObject({ status: 409 });
    expect(quoteStorefrontCart).not.toHaveBeenCalled();
    expect(model.update).not.toHaveBeenCalled();
  });
  it('does not send if another checkout changes the cart during duplicate cleanup', async () => {
    const cart = duplicateDraft();
    (quoteStorefrontCart as jest.Mock).mockResolvedValue({ ...ongoing.quoteSnapshot, items: [cart.quoteSnapshot.items[1]] });
    model.update.mockResolvedValue([0]);
    await expect(sendAndRecordStorefrontCartRecoveryEmail(cart as unknown as StorefrontOngoingCart)).rejects.toMatchObject({ status: 409 });
    expect(mockedSendMessage).not.toHaveBeenCalled();
  });
});
