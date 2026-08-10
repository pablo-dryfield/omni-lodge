import { buildDirectBookingActionEmail } from '../directBookingActionEmailService';
import type Booking from '../../models/Booking';

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
});
