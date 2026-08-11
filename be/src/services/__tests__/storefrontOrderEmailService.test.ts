import {
  buildCustomerStorefrontEmail,
  buildInternalStorefrontEmail,
} from '../storefrontOrderEmailService';
import { getConfigValue } from '../configService';
import type StorefrontOrder from '../../models/StorefrontOrder';

jest.mock('../../config/database.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/StorefrontOrder.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/StorefrontOrderItem.js', () => ({ __esModule: true, default: {} }));
jest.mock('../bookings/gmailClient.js', () => ({ sendMessage: jest.fn() }));
jest.mock('../configService.js', () => ({ getConfigValue: jest.fn() }));

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
      productName: 'Krawl Through Krakow Pub Crawl',
      quantity: 2,
      experienceDate: '2026-08-15',
      experienceTime: '21:00',
      total: 230,
      addons: [{ name: 'Instant photos', quantity: 1 }],
    },
  ],
} as unknown as StorefrontOrder;

describe('storefront paid-order emails', () => {
  beforeEach(() => {
    mockedGetConfigValue.mockReturnValue({
      title: 'Cancellation policy',
      summary: 'Custom cancellation terms.',
      items: [],
    });
  });

  it('builds a useful customer confirmation in HTML and plain text', () => {
    const email = buildCustomerStorefrontEmail(order);

    expect(email.subject).toContain('Booking confirmed');
    expect(email.htmlBody).toContain('Krawl Through Krakow Pub Crawl');
    expect(email.htmlBody).toContain('Saturday, 15 August 2026');
    expect(email.htmlBody).toContain('Instant photos');
    expect(email.textBody).toContain(order.publicId);
    expect(email.textBody).toContain('Total paid');
    expect(email.htmlBody).toContain('Cancellation policy');
    expect(email.htmlBody).toContain('Custom cancellation terms.');
    expect(email.htmlBody).not.toContain('24 hours or more before the start time');
    expect(email.textBody).toContain('+48791847981');
    expect(email.textBody).toContain('pubthroughkrakow@gmail.com');
    expect(`${email.subject}${email.htmlBody}${email.textBody}`).not.toMatch(/Ã|Â|â|Ä|Ĺ/);
  });

  it('omits the cancellation policy when none is configured', () => {
    mockedGetConfigValue.mockReturnValue(null);

    const email = buildCustomerStorefrontEmail(order);

    expect(email.htmlBody).not.toContain('Cancellation policy');
    expect(email.textBody).not.toContain('CANCELLATION POLICY');
  });

  it('builds an operator notification with contact and payment details', () => {
    const email = buildInternalStorefrontEmail(order);

    expect(email.subject).toContain('New paid storefront order');
    expect(email.htmlBody).toContain('alex@example.com');
    expect(email.textBody).toContain('+48123456789');
    expect(email.textBody).toContain('KRAKOW10');
  });

  it('escapes customer-controlled values in HTML', () => {
    const unsafe = {
      ...order,
      customerFirstName: '<img src=x onerror=alert(1)>',
    } as unknown as StorefrontOrder;

    const email = buildCustomerStorefrontEmail(unsafe);
    expect(email.htmlBody).not.toContain('<img src=x');
    expect(email.htmlBody).toContain('&lt;img src=x');
  });
});
