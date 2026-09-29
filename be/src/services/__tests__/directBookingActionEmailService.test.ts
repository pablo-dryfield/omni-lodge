import { buildDirectBookingActionEmail, sendInternalDirectBookingActionEmail } from '../directBookingActionEmailService';
import type Booking from '../../models/Booking';
import { sendMessage } from '../bookings/gmailClient.js';
import { getConfigValue } from '../configService.js';

jest.mock('../../models/Booking.js', () => ({ __esModule: true, default: {} }));
jest.mock('../bookings/gmailClient.js', () => ({ sendMessage: jest.fn() }));
jest.mock('../configService.js', () => ({ getConfigValue: jest.fn() }));

const booking = {
  id: 9812,
  platform: 'omnilodge',
  productName: 'Pub Crawl',
  guestFirstName: 'Dean',
  guestLastName: 'Mikan',
  guestEmail: 'dean@example.com',
  guestPhone: '+61400000000',
  experienceDate: '2026-08-07',
  experienceStartAt: new Date('2026-08-07T19:00:00.000Z'),
  partySizeTotal: 1,
  priceGross: '110.00',
  baseAmount: '110.00',
  currency: 'PLN',
  paymentMethod: 'stripe',
  notes: 'Storefront order example',
} as unknown as Booking;

describe('direct booking action email', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getConfigValue as jest.Mock).mockImplementation((key: string) => ({
      STOREFRONT_EMAIL_FROM_ADDRESS: 'pubthroughkrakow@gmail.com',
      STOREFRONT_EMAIL_FROM_NAME: 'Krawl Through Krakow',
      STOREFRONT_NOTIFICATION_EMAIL: 'pubthroughkrakow@gmail.com',
      DIRECT_BOOKINGS_EMAIL_FROM_ADDRESS: 'foodtourkrk@gmail.com',
      DIRECT_BOOKINGS_EMAIL_FROM_NAME: 'Food Tour Krakow',
      DIRECT_BOOKINGS_NOTIFICATION_EMAIL: 'foodtourkrk@gmail.com',
    })[key] ?? null);
    (sendMessage as jest.Mock).mockResolvedValue({
      id: 'message-1',
      rfcMessageId: '<message-1@example.com>',
      threadId: 'thread-1',
      labelIds: ['SENT'],
      to: 'pubthroughkrakow@gmail.com',
      from: '"Krawl Through Krakow" <pubthroughkrakow@gmail.com>',
    });
  });

  it('uses the actual storefront product and omits the Food Tour meeting point', () => {
    const email = buildDirectBookingActionEmail(booking, {
      kind: 'cancellation',
      refundedAmount: 110,
      refundCurrency: 'PLN',
    });

    expect(email.subject).toContain('Pub Crawl');
    expect(email.textBody).toContain('Start time: 9:00 PM');
    expect(email.textBody).not.toContain("St. Mary's Basilica");
    expect(email.htmlBody).not.toContain('pretzel on a stick');
  });

  it('uses the OmniLodge Pub Crawl mailbox for Airbnb amendment notifications', async () => {
    const airbnbBooking = { ...booking, platform: 'airbnb', platformBookingId: 'HMABC123' } as unknown as Booking;

    await sendInternalDirectBookingActionEmail(airbnbBooking, { kind: 'amend' });

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      to: 'pubthroughkrakow@gmail.com',
      from: '"Krawl Through Krakow" <pubthroughkrakow@gmail.com>',
    }));
  });
});
