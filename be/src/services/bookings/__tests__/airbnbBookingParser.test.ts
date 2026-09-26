jest.mock('../../configService.js', () => ({
  getConfigValue: jest.fn(() => null),
}));

import { AirbnbBookingParser } from '../parsers/airbnbBookingParser.js';
import type { BookingParserContext } from '../types.js';

const buildContext = (total: string): BookingParserContext => ({
  messageId: 'airbnb-total-test',
  subject: 'Ada booked your experience',
  from: 'Airbnb <automated@airbnb.com>',
  headers: { from: 'Airbnb <automated@airbnb.com>' },
  textBody: ['Airbnb Experiences', 'Confirmation code HM123456', total].join('\n'),
});

describe('Airbnb earnings totals', () => {
  it.each([
    ['legacy amount-before-symbol format', 'TOTAL (PLN) 100.00 Z\u0141', 100],
    ['new symbol-before-amount format', 'TOTAL (PLN) Z\u0141 100.00', 100],
    [
      'new format with localized non-breaking whitespace',
      'TOTAL\u00a0(PLN)\u202fZ\u0141\u00a01,234.56',
      1234.56,
    ],
  ])('parses the %s', async (_label, total, expectedAmount) => {
    const parsed = await new AirbnbBookingParser().parse(buildContext(total));

    expect(parsed?.bookingFields).toEqual(
      expect.objectContaining({
        baseAmount: expectedAmount,
        priceGross: expectedAmount,
        priceNet: expectedAmount,
        currency: 'PLN',
      }),
    );
  });

  it('does not treat an unrelated word before a number as a currency token', async () => {
    const parsed = await new AirbnbBookingParser().parse(buildContext('TOTAL (PLN) Fee 100.00'));

    expect(parsed?.bookingFields?.baseAmount).toBeUndefined();
  });

  it('does not treat a subtotal as the earnings total', async () => {
    const parsed = await new AirbnbBookingParser().parse(buildContext('SUBTOTAL (PLN) Z\u0141 100.00'));

    expect(parsed?.bookingFields?.baseAmount).toBeUndefined();
  });
});

describe('Airbnb reservation amendments', () => {
  it('parses an identifier-free guest addition instead of treating footer text as a reminder', async () => {
    const parsed = await new AirbnbBookingParser().parse({
      messageId: 'airbnb-guest-addition',
      subject: 'Mathias added a guest to Krawl Through Krakow Pub Crawl',
      from: 'Airbnb <automated@airbnb.com>',
      headers: { from: 'Airbnb <automated@airbnb.com>' },
      receivedAt: new Date('2026-09-26T17:01:31.000Z'),
      textBody: [
        'Mathias updated their reservation',
        'Mathias has added 1 guest to the reservation.',
        'Updated reservation',
        'https://www.airbnb.com/hosting/experience/134745428 Krawl Through Krakow Pub Crawl Hosted by David',
        'Friday, November 20 9:00 PM · 5 guests',
        'Manage email reminders',
      ].join('\n'),
    });

    expect(parsed).toEqual(expect.objectContaining({
      platform: 'airbnb',
      platformBookingId: 'airbnb-amend-airbnb-guest-addition',
      eventType: 'amended',
      status: 'amended',
      bookingFields: expect.objectContaining({
        guestFirstName: 'Mathias',
        partySizeTotal: 5,
        partySizeAdults: 5,
        experienceDate: '2026-11-20',
      }),
    }));
  });

  it('still ignores reminder emails based on their subject', async () => {
    const parsed = await new AirbnbBookingParser().parse({
      ...buildContext('TOTAL (PLN) Zł 100.00'),
      subject: 'Reminder: Ada booked your experience',
    });

    expect(parsed).toBeNull();
  });
});
