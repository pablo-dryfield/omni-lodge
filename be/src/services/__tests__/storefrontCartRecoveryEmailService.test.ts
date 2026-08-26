import StorefrontOngoingCart from '../../models/StorefrontOngoingCart';
import { sendMessage } from '../bookings/gmailClient';
import { getConfigValue } from '../configService';
import {
  buildStorefrontCartRecoveryEmail,
  sendAndRecordStorefrontCartRecoveryEmail,
} from '../storefrontCartRecoveryEmailService';

jest.mock('../../models/StorefrontOngoingCart.js', () => ({
  __esModule: true,
  default: { update: jest.fn() },
}));
jest.mock('../bookings/gmailClient.js', () => ({ sendMessage: jest.fn() }));
jest.mock('../configService.js', () => ({ getConfigValue: jest.fn() }));

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
    expect(reload).toHaveBeenCalledTimes(1);
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
