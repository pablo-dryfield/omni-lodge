jest.mock('../../configService.js', () => ({
  getConfigValue: jest.fn(() => null),
}));

import { XperiencePolandBookingParser } from '../parsers/xperiencePolandBookingParser.js';
import type { BookingParserContext } from '../types.js';

const buildResaleContext = (
  overrides: Partial<BookingParserContext> = {},
): BookingParserContext => {
  const from = 'Pub Crawl Krakow <noreply@pubcrawlkrakow.pl>';
  const subject = 'New Booking: Konrad Meling - 1 pax - Saturday, September 12, 2026';
  const textBody = [
    'New Resale Booking',
    'Konrad Meling',
    '1 pax — Saturday, September 12, 2026, Krakow',
    '',
    'New booking made through Pub Crawl Krakow. Reference 0AOYSXQU.',
    '',
    '💰 Cash to collect on the night',
    'zł90.00',
    'Deposit zł30.00 paid online (charged 30.00 PLN) · full value zł120.00',
    '👤 Customer Details',
    '',
    'NameKonrad Meling Emailmelkon373@example.com Phone+48720570877',
    '',
    '📅 Booking Details',
    '',
    'DateSaturday, September 12, 2026 Time21:00 Group Size1 people PaymentDeposit zł30.00 paid · zł90.00 cash on arrival Collect on arrival90.00 PLN',
    '',
    'Reply to this email to contact Konrad Meling directly.',
    '',
    'Pub Crawl Krakow',
    'Ref 0AOYSXQU · Reply to contact the customer directly.',
    '© 2026 Pub Crawl Krakow',
  ].join('\n');

  return {
    messageId: '1a096e8c56df9b69',
    subject,
    from,
    headers: {
      from,
      'reply-to': 'melkon373@example.com',
    },
    textBody,
    snippet: 'New Resale Booking Konrad Meling 1 pax — Saturday, September 12, 2026, Krakow',
    receivedAt: new Date('2026-09-12T18:37:12.000Z'),
    ...overrides,
  };
};

describe('XperiencePoland Pub Crawl Krakow resale bookings', () => {
  it('parses the new resale booking template from Pub Crawl Krakow', async () => {
    const parser = new XperiencePolandBookingParser();
    const context = buildResaleContext();

    expect(parser.canParse(context)).toBe(true);

    const parsed = await parser.parse(context);

    expect(parsed).toEqual(
      expect.objectContaining({
        platform: 'xperiencepoland',
        platformBookingId: '0AOYSXQU',
        platformOrderId: '0AOYSXQU',
        status: 'confirmed',
        paymentStatus: 'unpaid',
        eventType: 'created',
        occurredAt: new Date('2026-09-12T18:37:12.000Z'),
        sourceReceivedAt: new Date('2026-09-12T18:37:12.000Z'),
        rawPayload: expect.objectContaining({
          xperienceEmailKind: 'resale_booking',
          resaleSource: 'pubcrawlkrakow.pl',
          depositAmount: 30,
          cashAmount: 90,
          fullValueAmount: 120,
          partnerCommissionAmount: 30,
          cashToCollectAmount: 90,
          externalFullValueAmount: 120,
        }),
      }),
    );
    expect(parsed?.bookingFields).toEqual(
      expect.objectContaining({
        productName: 'Pub Crawl Krakow',
        guestFirstName: 'Konrad',
        guestLastName: 'Meling',
        guestEmail: 'melkon373@example.com',
        guestPhone: '+48720570877',
        partySizeTotal: 1,
        partySizeAdults: 1,
        currency: 'PLN',
        paymentMethod: 'Cash on arrival',
        priceGross: 90,
        priceNet: 90,
        baseAmount: 90,
        commissionAmount: 30,
        experienceDate: '2026-09-12',
        experienceStartAt: new Date('2026-09-12T19:00:00.000Z'),
      }),
    );
    expect(parsed?.bookingFields?.notes).toContain('Cash to collect on arrival: 90.00 PLN');
    expect(parsed?.bookingFields?.notes).toContain('XperiencePoland commission/deposit retained: 30.00 PLN');
    expect(parsed?.bookingFields?.notes).toContain('External full value: 120.00 PLN');
  });

  it('does not parse reply threads as new resale bookings', () => {
    const parser = new XperiencePolandBookingParser();

    expect(parser.canParse(buildResaleContext({
      subject: 'Re: New Booking: Konrad Meling - 1 pax - Saturday, September 12, 2026',
    }))).toBe(false);
  });
});
