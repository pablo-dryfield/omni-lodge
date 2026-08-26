import {
  buildCustomerStorefrontEmail,
  buildInternalStorefrontEmail,
} from '../storefrontOrderEmailService';
import { getConfigValue } from '../configService';
import type StorefrontOrder from '../../models/StorefrontOrder';
import type StorefrontOrderItem from '../../models/StorefrontOrderItem';

jest.mock('../../config/database.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/Booking.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/Product.js', () => ({ __esModule: true, default: {} }));
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
      },
    },
  ],
]);

describe('storefront paid-order emails', () => {
  beforeEach(() => {
    mockedGetConfigValue.mockReturnValue({
      title: 'Cancellation policy',
      summary: 'Custom cancellation terms.',
      items: [],
    });
  });

  it('builds a useful customer confirmation in HTML and plain text', () => {
    const email = buildCustomerStorefrontEmail(order, bookingIds, productDetails);

    expect(email.subject).toContain('Booking confirmed');
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

  it('omits the cancellation policy when none is configured', () => {
    mockedGetConfigValue.mockReturnValue(null);

    const email = buildCustomerStorefrontEmail(order);

    expect(email.htmlBody).not.toContain('Cancellation policy');
    expect(email.textBody).not.toContain('CANCELLATION POLICY');
  });

  it('builds an operator notification with contact and payment details', () => {
    const email = buildInternalStorefrontEmail(order, bookingIds, productDetails);

    expect(email.subject).toContain('New paid storefront order');
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

  it('uses the order reference and shows each OmniLodge ID for multiple experiences', () => {
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
    const email = buildCustomerStorefrontEmail(multiOrder, new Map([[501, 41001], [502, 41002]]));

    expect(email.htmlBody).toContain('Order reference');
    expect(email.htmlBody).toContain(order.publicId);
    expect(email.htmlBody).toContain('OmniLodge booking ID');
    expect(email.htmlBody).toContain('41001');
    expect(email.htmlBody).toContain('41002');
  });

  it('escapes customer-controlled values in HTML', () => {
    const unsafe = {
      ...order,
      customerFirstName: '<img src=x onerror=alert(1)>',
    } as unknown as StorefrontOrder;

    const email = buildCustomerStorefrontEmail(unsafe, bookingIds);
    expect(email.htmlBody).not.toContain('<img src=x');
    expect(email.htmlBody).toContain('&lt;img src=x');
  });
});
