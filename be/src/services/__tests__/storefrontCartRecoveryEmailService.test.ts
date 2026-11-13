import { quoteStorefrontCart } from '../storefrontCommerceService';
import StorefrontOngoingCart from '../../models/StorefrontOngoingCart';
import Product from '../../models/Product';
import { sendMessage } from '../bookings/gmailClient';
import { getConfigValue } from '../configService';
import { dismissCartWithPaidMatch } from '../storefrontCartBookingMatchService';
import { evaluateRecoveryOffer } from '../storefrontRecoveryOfferService';
import {
  buildStorefrontCartRecoveryEmail,
  prepareStorefrontCartRecoveryEmail,
  loadStorefrontCartRecoveryProducts,
  refreshDuplicateRecoveryCart,
  sendAndRecordStorefrontCartRecoveryEmail,
} from '../storefrontCartRecoveryEmailService';

jest.mock('../../models/StorefrontOngoingCart.js', () => ({
  __esModule: true,
  default: { update: jest.fn() },
}));
jest.mock('../../models/Product.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../utils/logger.js', () => ({ __esModule: true, default: { warn: jest.fn() } }));
jest.mock('../storefrontRecoveryOfferService.js', () => ({
  evaluateRecoveryOffer: jest.fn(async cart => ({ override: { mode: 'automatic', promotionId: null }, groupSize: 2,
    guestCountMode: 'largest_group', offer: null, quote: cart.quoteSnapshot, warnings: [], error: null, previewVersion: 'a'.repeat(64) })),
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
    (Product.findAll as jest.Mock).mockResolvedValue([]);
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

  it('does not send a stale preview after the effective offer changes', async () => {
    const cart = { ...ongoing, status: 'sending_recovery', reload: jest.fn() } as unknown as StorefrontOngoingCart;
    await expect(sendAndRecordStorefrontCartRecoveryEmail(cart, 'b'.repeat(64))).rejects.toMatchObject({ status: 409 });
    expect(mockedSendMessage).not.toHaveBeenCalled();
  });

  it('does not send an invalid manually selected coupon', async () => {
    const cart = { ...ongoing, status: 'sending_recovery', reload: jest.fn() } as unknown as StorefrontOngoingCart;
    (evaluateRecoveryOffer as jest.Mock).mockResolvedValueOnce({ quote: ongoing.quoteSnapshot, offer: null, error: 'Coupon expired.' });
    await expect(sendAndRecordStorefrontCartRecoveryEmail(cart)).rejects.toMatchObject({ status: 400 });
    expect(mockedSendMessage).not.toHaveBeenCalled();
  });

  it('previews the chosen code, discounted total and version-bound link without changing the saved cart or sending', async () => {
    const offer = { promotionId: 7, code: 'GROUP10', name: 'Group offer', amount: 36.8,
      originalTotal: 368, total: 331.2, currency: 'PLN', source: 'rule', ruleId: 'group', ruleName: 'Large group',
      applyAutomatically: true, validTo: null, cartFingerprint: 'original-selection' };
    (evaluateRecoveryOffer as jest.Mock).mockResolvedValueOnce({
      offer, error: null, previewVersion: 'c'.repeat(64),
      quote: { ...ongoing.quoteSnapshot, total: 331.2, discountTotal: 36.8 },
    });
    const prepared = await prepareStorefrontCartRecoveryEmail(ongoing);
    expect(prepared.email.recoveryUrl).toContain(`&rt=${ongoing.recoveryToken}.${'c'.repeat(64)}`);
    expect(prepared.email.htmlBody).toContain('GROUP10');
    expect(prepared.email.htmlBody).toContain('Your total with this code');
    expect(prepared.email.textBody).toContain('331.20');
    expect(prepared.email.textBody).toContain('Your code is applied when you open your booking');
    expect(ongoing.quoteSnapshot.total).toBe(368);
    expect(ongoing.recoveryToken).not.toContain('.');
    expect(mockedSendMessage).not.toHaveBeenCalled();
  });

  it('records the exact emailed offer and its version for later recovery without altering the cart price', async () => {
    const offer = { promotionId: 7, code: 'GROUP10', name: 'Group offer', amount: 36.8,
      originalTotal: 368, total: 331.2, currency: 'PLN', source: 'manual', ruleId: null, ruleName: null,
      applyAutomatically: true, validTo: null, cartFingerprint: 'original-selection' };
    (evaluateRecoveryOffer as jest.Mock).mockResolvedValueOnce({
      offer, warnings: [], error: null, previewVersion: 'c'.repeat(64),
      quote: { ...ongoing.quoteSnapshot, total: 331.2, discountTotal: 36.8 },
    });
    const cart = { ...ongoing, id: 15, status: 'sending_recovery', reload: jest.fn() } as unknown as StorefrontOngoingCart;
    mockedSendMessage.mockResolvedValue({ id: 'offered-email' } as never);
    model.update.mockResolvedValue([1]);
    await sendAndRecordStorefrontCartRecoveryEmail(cart, 'c'.repeat(64));
    expect(model.update).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ recoveryOfferSent: { ...offer, previewVersion: 'c'.repeat(64) },
        events: [expect.objectContaining({ type: 'recovery_email_sent', details: expect.objectContaining({ offer }) })] }),
    }), { where: { id: 15, status: 'sending_recovery' } });
    expect(model.update.mock.calls[0][0]).not.toHaveProperty('total');
    expect(mockedSendMessage.mock.calls[0][0].textBody).toContain('GROUP10');
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

  it('uses configured product content without inventing availability or social proof', async () => {
    (Product.findAll as jest.Mock).mockResolvedValue([{
      id: 28, name: 'Pub Crawl', imageUrl: 'https://images.example.com/crawl.jpg', images: [],
      storefrontConfig: { content: { summary: 'Meet fellow travellers & explore Krakow.', highlights: ['Local hosts', 'A guided night out'] } },
    }]);
    const products = await loadStorefrontCartRecoveryProducts(ongoing);
    const email = buildStorefrontCartRecoveryEmail(ongoing, products);
    expect(email.htmlBody).toContain('src="https://images.example.com/crawl.jpg"');
    expect(email.htmlBody).toContain('Meet fellow travellers &amp; explore Krakow.');
    expect(email.textBody).toContain('Local hosts');
    expect(email.htmlBody).not.toMatch(/only \d+ (?:spots|places)|reserved for you|rated 4\./i);
  });

  it('rejects unsafe product image URLs and uses the first valid ordered gallery image', async () => {
    (Product.findAll as jest.Mock).mockResolvedValue([{
      id: 28, name: 'Pub Crawl', imageUrl: 'javascript:alert(1)', storefrontConfig: {},
      images: [
        { url: 'https://images.example.com/later.jpg', alt: 'Later', order: 3 },
        { url: 'data:text/html,unsafe', alt: 'Unsafe', order: 1 },
        { url: 'https://images.example.com/first.jpg', alt: 'Friends at the crawl', order: 2 },
      ],
    }]);
    const products = await loadStorefrontCartRecoveryProducts(ongoing);
    expect(products.get(28)).toMatchObject({ imageUrl: 'https://images.example.com/first.jpg', imageAlt: 'Friends at the crawl' });
    const email = buildStorefrontCartRecoveryEmail(ongoing, products);
    expect(email.htmlBody).not.toContain('javascript:');
    expect(email.htmlBody).not.toContain('data:text/html');
  });

  it('keeps rendering the recovery link when optional product content cannot load', async () => {
    (Product.findAll as jest.Mock).mockRejectedValue(new Error('Content unavailable'));
    const email = buildStorefrontCartRecoveryEmail(ongoing, await loadStorefrontCartRecoveryProducts(ongoing));
    expect(email.htmlBody).toContain('CONTINUE MY BOOKING');
    expect(email.htmlBody).not.toContain('<img');
    expect(email.recoveryUrl).toContain('&rt=');
  });

  it('uses each experience selected time and configured meeting point in HTML and plain text', async () => {
    mockedGetConfigValue.mockImplementation(key => key === 'STOREFRONT_RECOVERY_EMAIL_SHOW_MEETING_POINT' ? true : null);
    (Product.findAll as jest.Mock).mockResolvedValue([
      { id: 28, name: 'Pub Crawl', images: [], storefrontConfig: { content: { meetingPoint: {
        name: 'Adam Mickiewicz Monument', address: 'Rynek Glowny, Krakow', instructions: 'Look for the pink umbrella.',
        mapUrl: 'https://maps.example.com/crawl?a=1&b=2', photoUrl: 'https://images.example.com/meeting.jpg', photoAlt: 'Find our pink umbrella',
      } } } },
      { id: 29, name: 'Food Tour', images: [], storefrontConfig: { defaultStartTime: '14:00', content: { meetingPoint: {
        name: 'Food tour meeting point', address: 'A different address',
      } } } },
    ]);
    const first = ongoing.quoteSnapshot.items[0];
    const cart = { ...ongoing, quoteSnapshot: { ...ongoing.quoteSnapshot, items: [
      first, { ...first, productId: 29, productName: 'Food Tour', experienceTime: '19:30' },
    ] } } as unknown as StorefrontOngoingCart;
    const email = buildStorefrontCartRecoveryEmail(cart, await loadStorefrontCartRecoveryProducts(cart));
    expect(email.htmlBody).toContain('Starts at 21:00');
    expect(email.htmlBody).toContain('Starts at 19:30');
    expect(email.htmlBody).not.toContain('14:00');
    expect(email.htmlBody).toContain('Adam Mickiewicz Monument');
    expect(email.htmlBody).toContain('Food tour meeting point');
    expect(email.htmlBody).toContain('href="https://maps.example.com/crawl?a=1&amp;b=2"');
    expect(email.htmlBody).toContain('alt="Find our pink umbrella"');
    expect(email.textBody).toContain('Starting time: 19:30 (Krakow local time)');
    expect(email.textBody).toContain('Look for the pink umbrella.');
    expect(email.textBody).toContain('You can also pay in cash by speaking to the pub crawl leader at the meeting point.');
  });

  it('escapes meeting instructions and rejects unsafe directions and photo URLs', async () => {
    mockedGetConfigValue.mockImplementation(key => key === 'STOREFRONT_RECOVERY_EMAIL_SHOW_MEETING_POINT' ? true : null);
    (Product.findAll as jest.Mock).mockResolvedValue([{ id: 28, name: 'Pub Crawl', images: [], storefrontConfig: { content: {
      meetingPoint: { name: 'Place <script>', instructions: 'Find "pink" & yellow', mapUrl: 'javascript:alert(1)', photoUrl: 'data:text/html,unsafe' },
    } } }]);
    const email = buildStorefrontCartRecoveryEmail(ongoing, await loadStorefrontCartRecoveryProducts(ongoing));
    expect(email.htmlBody).toContain('Place &lt;script&gt;');
    expect(email.htmlBody).toContain('Find &quot;pink&quot; &amp; yellow');
    expect(email.htmlBody).not.toContain('javascript:');
    expect(email.htmlBody).not.toContain('data:text/html');
    expect(email.htmlBody).not.toContain('GET MAP DIRECTIONS');
    expect(email.textBody).not.toContain('javascript:');
  });

  it('omits empty meeting details and does not invent a starting time or cash invitation', async () => {
    mockedGetConfigValue.mockImplementation(key => key === 'STOREFRONT_RECOVERY_EMAIL_SHOW_MEETING_POINT' ? true : null);
    (Product.findAll as jest.Mock).mockResolvedValue([{ id: 28, name: 'Pub Crawl', images: [], storefrontConfig: { content: {
      meetingPoint: { name: ' ', mapUrl: 'javascript:alert(1)', photoAlt: 'Unused description' },
    } } }]);
    const cart = { ...ongoing, quoteSnapshot: { ...ongoing.quoteSnapshot, items: [
      { ...ongoing.quoteSnapshot.items[0], experienceTime: null },
    ] } } as unknown as StorefrontOngoingCart;
    const email = buildStorefrontCartRecoveryEmail(cart, await loadStorefrontCartRecoveryProducts(cart));
    expect(email.htmlBody).toContain('Starting time to be confirmed');
    expect(email.htmlBody).not.toContain('Meeting point</h3>');
    expect(email.htmlBody).not.toContain('Prefer to meet the group first?');
  });

  it.each([false, null])('hides the whole meeting section when its switch is %s while retaining the experience and checkout link', async enabled => {
    mockedGetConfigValue.mockImplementation(key => key === 'STOREFRONT_RECOVERY_EMAIL_SHOW_MEETING_POINT' ? enabled : null);
    (Product.findAll as jest.Mock).mockResolvedValue([{ id: 28, name: 'Pub Crawl', images: [], storefrontConfig: { content: {
      meetingPoint: { name: 'Private meeting sample', address: 'Meeting sample address', instructions: 'Look for the test umbrella',
        mapUrl: 'https://maps.example.com/meeting', photoUrl: 'https://images.example.com/meeting-photo.jpg' },
    } } }]);
    const email = buildStorefrontCartRecoveryEmail(ongoing, await loadStorefrontCartRecoveryProducts(ongoing));
    for (const content of [email.htmlBody, email.textBody]) {
      expect(content).not.toContain('Prefer to meet the group first?');
      expect(content).not.toContain('Private meeting sample');
      expect(content).not.toContain('Meeting sample address');
      expect(content).not.toContain('Look for the test umbrella');
      expect(content).not.toContain('maps.example.com/meeting');
      expect(content).not.toContain('images.example.com/meeting-photo.jpg');
      expect(content).not.toContain('You can also pay in cash');
      expect(content).toContain('Pub Crawl');
      expect(content).toContain('21:00');
      expect(content).toContain('https://');
    }
    expect(email.htmlBody).toContain('CONTINUE MY BOOKING');
  });

  it('escapes customer and product content and renders every saved experience separately', () => {
    const item = ongoing.quoteSnapshot.items[0];
    const cart = {
      ...ongoing, customer: { ...ongoing.customer, fullName: '<Alex> Morgan' },
      quoteSnapshot: { ...ongoing.quoteSnapshot, items: [item, { ...item, productId: 29, productName: 'Food & <Wine>', experienceTime: '19:30' }] },
    } as unknown as StorefrontOngoingCart;
    const email = buildStorefrontCartRecoveryEmail(cart);
    expect(email.htmlBody).toContain('Hi &lt;Alex&gt;');
    expect(email.htmlBody).toContain('Food &amp; &lt;Wine&gt;');
    expect(email.htmlBody).toContain('Your saved experiences');
    expect(email.htmlBody).toContain('19:30');
    expect(email.htmlBody.match(/href="https:\/\/example.com\/store2\/cart\?/g)).toHaveLength(2);
    expect(email.htmlBody).not.toContain('<Alex>');
  });
});


describe('legacy duplicate recovery drafts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Product.findAll as jest.Mock).mockResolvedValue([]);
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
      subject: 'Still thinking about Pub Crawl?',
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
