import {
  buildCustomerBankTransferCancellationEmail,
  buildCustomerBankTransferInstructionsEmail,
  buildCustomerStorefrontEmail,
  buildInternalStorefrontEmail,
  deliverStorefrontOrderEmails,
  isStorefrontOrderConfirmationEmailComplete,
} from '../storefrontOrderEmailService';
import { getConfigValue } from '../configService';
import type StorefrontOrder from '../../models/StorefrontOrder';
import type StorefrontOrderItem from '../../models/StorefrontOrderItem';
import sequelize from '../../config/database';
import Booking from '../../models/Booking';
import Product from '../../models/Product';
import { findLockedStorefrontOrderWithItems } from '../storefrontOrderPersistenceService';
import { sendMessage } from '../bookings/gmailClient';

jest.mock('../../config/database.js', () => ({ __esModule: true, default: { transaction: jest.fn() } }));
jest.mock('../../models/Booking.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../models/Product.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../models/StorefrontOrder.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/StorefrontOrderItem.js', () => ({ __esModule: true, default: {} }));
jest.mock('../bookings/gmailClient.js', () => ({ sendMessage: jest.fn() }));
jest.mock('../configService.js', () => ({ getConfigValue: jest.fn() }));
jest.mock('../storefrontOrderPersistenceService.js', () => ({ findLockedStorefrontOrderWithItems: jest.fn() }));

const mockedGetConfigValue = getConfigValue as jest.MockedFunction<typeof getConfigValue>;

const order = {
  publicId: '799dd50e-12d7-4c81-b202-e68186480ed6',
  paymentStatus: 'paid',
  currency: 'PLN',
  subtotal: 200,
  addonTotal: 30,
  discountTotal: 20,
  total: 210,
  customerFirstName: 'Alex',
  customerLastName: 'Smith',
  customerEmail: 'alex@example.com',
  customerPhone: '+48123456789',
  customerCountryCode: 'GB',
  discountCode: 'KRAKOW10',
  items: [
    {
      id: 501,
      productId: 28,
      productName: 'Krawl Through Krakow Pub Crawl',
      quantity: 2,
      experienceDate: '2026-08-15',
      experienceTime: '21:00',
      unitPrice: 100,
      baseTotal: 200,
      addonTotal: 30,
      total: 230,
      addons: [
        { name: 'Cocktails', quantity: 1, total: 10 },
        {
          name: 'T-Shirts',
          quantity: 3,
          total: 20,
          variants: [
            { value: 'S', quantity: 2 },
            { value: 'M', quantity: 1 },
          ],
        },
      ],
      options: { participants: { men: 1, women: 1 } },
    },
  ],
} as unknown as StorefrontOrder;

const bookingIds = new Map([[501, 41001]]);
const productDetails = new Map([
  [
    28,
    {
      summary: 'Krakow\'s biggest night out, all planned for you.',
      description: 'Start with an unlimited open bar and continue through Krakow\'s best venues.',
      highlights: ['Open bar with unlimited drinks for 1 hour'],
      importantInformation: ['Bring a valid photo ID.'],
      meetingPoint: {
        name: 'Adam Mickiewicz Monument',
        address: 'Rynek Glowny, 31-042 Krakow',
        instructions: 'Search for the pink umbrella!',
        mapUrl: 'https://maps.example.com/meeting-point',
        photoUrl: 'https://media.example.com/meeting-point.jpg',
        photoAlt: 'Statue & pink umbrella',
      },
    },
  ],
]);

describe('storefront paid-order emails', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetConfigValue.mockReturnValue({
      title: 'Cancellation policy',
      summary: 'Custom cancellation terms.',
      items: [],
    });
  });

  it('delivers the generated inline barcode through the actual customer notification path', async () => {
    mockedGetConfigValue.mockReturnValue(null);
    const transaction = {};
    (sequelize.transaction as jest.Mock).mockImplementation((callback) => callback(transaction));
    const storedOrder = { ...order, update: jest.fn(), customerEmailSentAt: null } as unknown as StorefrontOrder;
    jest.mocked(findLockedStorefrontOrderWithItems).mockResolvedValue(storedOrder);
    jest.mocked(Booking.findAll).mockResolvedValue([
      { id: 41001, platformBookingId: `${order.publicId}-501` } as Booking,
    ]);
    jest.mocked(Product.findAll).mockResolvedValue([]);

    await deliverStorefrontOrderEmails(order.publicId);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      to: order.customerEmail,
      htmlBody: expect.stringContaining('src="cid:booking-41001@omnilodge"'),
      attachments: [expect.objectContaining({
        contentId: 'booking-41001@omnilodge', contentType: 'image/png', content: expect.any(Buffer),
      })],
    }));
    expect(storedOrder.update).toHaveBeenCalledWith({ customerEmailSentAt: expect.any(Date) }, { transaction });
  });

  it('builds a useful customer confirmation in HTML and plain text', async () => {
    const email = await buildCustomerStorefrontEmail(order, bookingIds, productDetails);

    expect(email.subject).toContain('Booking confirmed');
    expect(email.htmlBody).toContain('src="cid:booking-41001@omnilodge"');
    expect(email.attachments).toHaveLength(1);
    expect(email.attachments[0].contentId).toBe('booking-41001@omnilodge');
    expect(email.attachments[0].content.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(email.htmlBody).toContain('src="https://media.example.com/meeting-point.jpg"');
    expect(email.htmlBody).toContain('alt="Statue &amp; pink umbrella"');
    expect(email.textBody).toContain('Meeting point photo: https://media.example.com/meeting-point.jpg');
    expect(email.htmlBody).toContain('Krawl Through Krakow Pub Crawl');
    expect(email.htmlBody).toContain('Saturday, 15 August 2026');
    expect(email.htmlBody).toContain('Booking reference');
    expect(email.htmlBody).toContain('41001');
    expect(email.textBody).not.toContain(order.publicId);
    expect(email.htmlBody).toContain('1 man · 1 woman');
    expect(email.htmlBody).toContain('Experience (2 ×');
    expect(email.htmlBody).toContain('Cocktails: 1');
    expect(email.htmlBody).toContain('T-Shirts: S × 2 · M × 1');
    expect(email.htmlBody).toContain('Experience total');
    expect(email.htmlBody).toContain('Experiences');
    expect(email.htmlBody).toContain('Add-ons');
    expect(email.htmlBody).toContain('Discount');
    expect(email.textBody).toContain('Total paid');
    expect(email.htmlBody).toContain('Customer details');
    expect(email.htmlBody).toContain('Alex Smith');
    expect(email.htmlBody).toContain('United Kingdom (+44)');
    expect(email.htmlBody).toContain('Cancellation policy');
    expect(email.htmlBody).toContain('Custom cancellation terms.');
    expect(email.htmlBody).not.toContain('24 hours or more before the start time');
    expect(email.htmlBody).toContain('Krakow&#39;s biggest night out');
    expect(email.htmlBody).toContain('Start with an unlimited open bar');
    expect(email.htmlBody).toContain('Open bar with unlimited drinks for 1 hour');
    expect(email.htmlBody).toContain('Bring a valid photo ID.');
    expect(email.htmlBody).toContain('Adam Mickiewicz Monument');
    expect(email.htmlBody).toContain('Search for the pink umbrella!');
    expect(email.htmlBody).toContain('OPEN IN GOOGLE MAPS');
    expect(email.textBody).toContain('MEETING POINT');
    expect(email.textBody).toContain('+48791847981');
    expect(email.textBody).toContain('pubthroughkrakow@gmail.com');
    expect(`${email.subject}${email.htmlBody}${email.textBody}`).not.toMatch(/Ã|Â|â|Ä|Ĺ/);
  });

  it('omits the cancellation policy when none is configured', async () => {
    mockedGetConfigValue.mockReturnValue(null);

    const email = await buildCustomerStorefrontEmail(order);
    expect(email.attachments).toEqual([]);
    expect(email.htmlBody).not.toContain('Booking barcode');

    expect(email.htmlBody).not.toContain('Cancellation policy');
    expect(email.textBody).not.toContain('CANCELLATION POLICY');
  });

  it('builds an operator notification with contact and payment details', () => {
    const email = buildInternalStorefrontEmail(order, bookingIds, productDetails);

    expect(email.subject).toBe('New Order - Saturday, 15 August 2026 | 1 Man · 1 Woman | PLN\u00a0210.00');
    expect(email.htmlBody).toContain('alex@example.com');
    expect(email.htmlBody).toContain('41001');
    expect(email.htmlBody).toContain('1 man · 1 woman');
    expect(email.htmlBody).toContain('T-Shirts: S × 2 · M × 1');
    expect(email.htmlBody).toContain('Experiences');
    expect(email.htmlBody).toContain('Customer details');
    expect(email.htmlBody).toContain('Adam Mickiewicz Monument');
    expect(email.textBody).toContain('+48123456789');
    expect(email.textBody).toContain('KRAKOW10');
  });

  it.each([
    [1, 1, 0, '1 Man'], [2, 2, 0, '2 Men'], [1, 0, 1, '1 Woman'], [2, 0, 2, '2 Women'],
    [3, 2, 1, '2 Men · 1 Woman'], [3, 1, 2, '1 Man · 2 Women'],
    [1, 0, 0, '1 Guest'], [3, 0, 0, '3 Guests'], [3, 1, 0, '1 Man · 2 Unspecified'],
    [2, 4, 0, '2 Guests'],
  ])('formats the operator subject for %s guests (%s men, %s women)', (quantity, men, women, expected) => {
    const subjectOrder = { ...order, items: [{ ...order.items![0], quantity, options: { participants: { men, women } } }] } as StorefrontOrder;
    expect(buildInternalStorefrontEmail(subjectOrder).subject).toBe(
      `New Order - Saturday, 15 August 2026 | ${expected} | PLN\u00a0210.00`,
    );
  });

  it('shows only populated marketing fields directly under the payment introduction and escapes HTML', () => {
    const email = buildInternalStorefrontEmail({
      ...order, attribution: { utm_source: 'google', utm_medium: ' cpc ', utm_campaign: '<summer & friends>', utm_term: 'not displayed' },
    } as StorefrontOrder);
    expect(email.textBody).toContain('Alex Smith completed payment.\nSource: google\nMedium: cpc\nCampaign: <summer & friends>\nDiscount Code: KRAKOW10');
    expect(email.htmlBody).toContain('&lt;summer &amp; friends&gt;');
    expect(email.htmlBody).not.toContain('<summer & friends>');
    expect(email.htmlBody).not.toContain('not displayed');
    expect(email.htmlBody).not.toContain('utm_source');
    expect(email.htmlBody).not.toContain('The confirmed experiences and customer details are below.');
    expect(email.textBody.match(/Discount Code:/g)).toHaveLength(1);
  });

  it('omits the marketing section when no UTM or discount values exist', () => {
    const email = buildInternalStorefrontEmail({
      ...order, discountCode: ' ', attribution: { utm_source: '', utm_medium: ' ', utm_campaign: null },
    } as unknown as StorefrontOrder);
    expect(email.textBody).not.toMatch(/Source:|Medium:|Campaign:|Discount Code:/);
    expect(email.htmlBody).not.toContain('table-layout:fixed');
  });

  it('keeps the customer introduction after the booking-reference barcode', async () => {
    const email = await buildCustomerStorefrontEmail(order, bookingIds, productDetails);
    const barcodeAt = email.htmlBody.indexOf('src="cid:booking-41001@omnilodge"');
    const introAt = email.htmlBody.indexOf('Your payment was successful.');
    expect(barcodeAt).toBeGreaterThan(-1);
    expect(introAt).toBeGreaterThan(barcodeAt);
    expect(email.htmlBody.indexOf('Experience details')).toBeGreaterThan(introAt);
    expect(email.htmlBody).not.toContain('Show this to the team at check-in.');
  });

  it('uses the order reference and shows each OmniLodge ID for multiple experiences', async () => {
    const firstItem = order.items![0];
    const secondItem = {
      ...firstItem,
      id: 502,
      productName: 'Krakow Boat Party',
    } as StorefrontOrderItem;
    const multiOrder = {
      ...order,
      items: [firstItem, secondItem],
    } as StorefrontOrder;
    const email = await buildCustomerStorefrontEmail(multiOrder, new Map([[501, 41001], [502, 41002]]));
    expect(email.attachments.map((attachment) => attachment.contentId)).toEqual([
      'booking-41001@omnilodge', 'booking-41002@omnilodge',
    ]);
    expect(email.htmlBody).toContain('src="cid:booking-41001@omnilodge"');
    expect(email.htmlBody).toContain('src="cid:booking-41002@omnilodge"');

    expect(email.htmlBody).toContain('Order reference');
    expect(email.htmlBody).toContain(order.publicId);
    expect(email.htmlBody).toContain('OmniLodge booking ID');
    expect(email.htmlBody).toContain('41001');
    expect(email.htmlBody).toContain('41002');
  });

  it('escapes customer-controlled values in HTML', async () => {
    const unsafe = {
      ...order,
      customerFirstName: '<img src=x onerror=alert(1)>',
    } as unknown as StorefrontOrder;

    const email = await buildCustomerStorefrontEmail(unsafe, bookingIds);
    expect(email.htmlBody).not.toContain('<img src=x');
    expect(email.htmlBody).toContain('&lt;img src=x');
  });

  it('builds reserved-booking instructions without claiming payment was received', () => {
    const pendingOrder = {
      ...order,
      paymentStatus: 'unpaid',
      paymentMethod: 'bank_transfer',
      paymentReference: 'KTK-BT-000321',
      paymentDueAt: null,
    } as unknown as StorefrontOrder;
    const email = buildCustomerBankTransferInstructionsEmail(
      pendingOrder,
      {
        beneficiary: 'Krawl Through Krakow Sp. z o.o.',
        iban: 'PL00123456789012345678901234',
        bic: 'BANKPLPW',
        bankName: 'Example Bank',
        instructions: 'Use the exact reference.',
      },
      bookingIds,
      productDetails,
    );

    expect(email.subject).toContain('Bank transfer details');
    expect(email.htmlBody).toContain('Awaiting bank transfer');
    expect(email.htmlBody).toContain('KTK-BT-000321');
    expect(email.htmlBody).toContain('PL00123456789012345678901234');
    expect(email.htmlBody).toContain('Krawl Through Krakow Sp. z o.o.');
    expect(email.textBody).toContain('Your final booking confirmation will be sent');
    expect(email.htmlBody).not.toContain('Paid in full');
    expect(email.textBody).not.toContain('Payment received');
    expect(email.textBody).toContain('Reservation expiry: No expiry');
    expect(email.htmlBody).toContain('No expiry');
    expect(email.textBody).not.toContain('Pay by:');
    expect(email.htmlBody).not.toContain('Pay by');
  });

  it('builds a distinct cancellation notice for an unpaid bank-transfer reservation', () => {
    const cancelledOrder = {
      ...order,
      status: 'cancelled',
      paymentStatus: 'unpaid',
      paymentMethod: 'bank_transfer',
      paymentReference: 'KTK-BT-000321',
    } as unknown as StorefrontOrder;

    const email = buildCustomerBankTransferCancellationEmail(
      cancelledOrder,
      bookingIds,
      productDetails,
    );

    expect(email.subject).toContain('Booking cancelled');
    expect(email.htmlBody).toContain('Reservation cancelled');
    expect(email.htmlBody).toContain('41001');
    expect(email.textBody).toContain('no refund is due');
    expect(email.htmlBody).not.toContain('Payment confirmed');
    expect(email.textBody).not.toContain('Total paid');
  });

  it('explains when an unpaid bank-transfer hold expired at its deadline', () => {
    const expiredOrder = {
      ...order,
      status: 'cancelled',
      paymentStatus: 'unpaid',
      paymentMethod: 'bank_transfer',
      metadata: { bankTransferCancellationReason: 'payment_deadline_expired' },
    } as unknown as StorefrontOrder;

    const email = buildCustomerBankTransferCancellationEmail(expiredOrder, bookingIds);

    expect(email.subject).toContain('Booking reservation expired');
    expect(email.htmlBody).toContain('Reservation expired');
    expect(email.textBody).toContain('deadline passed before payment was recorded');
  });

  it('requires the internal confirmation marker only when an internal recipient is configured', () => {
    mockedGetConfigValue.mockReturnValueOnce('bookings@example.com');
    expect(isStorefrontOrderConfirmationEmailComplete({
      ...order,
      customerEmailSentAt: new Date(),
      internalEmailSentAt: null,
    } as StorefrontOrder)).toBe(false);

    mockedGetConfigValue.mockReturnValueOnce('');
    expect(isStorefrontOrderConfirmationEmailComplete({
      ...order,
      customerEmailSentAt: new Date(),
      internalEmailSentAt: null,
    } as StorefrontOrder)).toBe(true);
  });

  it('treats intentionally disabled confirmation recipients as complete', () => {
    mockedGetConfigValue.mockReturnValueOnce('bookings@example.com');
    expect(isStorefrontOrderConfirmationEmailComplete({
      ...order,
      metadata: {
        confirmationNotifications: {
          customerConfirmation: false,
          internalConfirmation: false,
        },
      },
      customerEmailSentAt: null,
      internalEmailSentAt: null,
    } as StorefrontOrder)).toBe(true);
  });

  it('still waits for enabled recipients when only one confirmation channel is disabled', () => {
    mockedGetConfigValue.mockReturnValueOnce('bookings@example.com');
    expect(isStorefrontOrderConfirmationEmailComplete({
      ...order,
      metadata: {
        confirmationNotifications: {
          customerConfirmation: false,
          internalConfirmation: true,
        },
      },
      customerEmailSentAt: null,
      internalEmailSentAt: null,
    } as StorefrontOrder)).toBe(false);

    mockedGetConfigValue.mockReturnValueOnce('bookings@example.com');
    expect(isStorefrontOrderConfirmationEmailComplete({
      ...order,
      metadata: {
        confirmationNotifications: {
          customerConfirmation: false,
          internalConfirmation: true,
        },
      },
      customerEmailSentAt: null,
      internalEmailSentAt: new Date(),
    } as StorefrontOrder)).toBe(true);
  });
});
