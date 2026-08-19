jest.mock('../../configService.js', () => ({
  getConfigValue: jest.fn(() => null),
}));

import { FreeTourBookingParser } from '../parsers/freeTourBookingParser.js';
import type { BookingParserContext } from '../types.js';

const BOOKING_ID = '40761-20260819110313-600';

const buildContext = (tourDate: string): BookingParserContext => {
  const from = 'FreeTour <bookings@freetour.com>';

  return {
    messageId: 'freetour-date-test',
    subject: `Paid reservation from FreeTour.com - Booking ID: ${BOOKING_ID}`,
    from,
    headers: { from },
    textBody: [
      'Krakow Pub Crawl Tour Reservation',
      `Date of the Tour: ${tourDate}`,
      'Language: English',
      'Adults: 2',
      'Booking Name: Ada Lovelace',
      'Booking E-mail: ada@example.com',
      'Booking phone: +48 123 456 789',
      `Booking Reference Number: ${BOOKING_ID}`,
      'Booking Total Cost: \u20ac20.00',
      'Paid: \u20ac20.00',
      'Balance due: \u20ac0.00',
      'If you are unable to attend',
    ].join('\n'),
  };
};

describe('FreeTour tour dates', () => {
  it.each([
    ['weekday/day-first format', '9:00 PM, Wednesday, 19 August 2026'],
    ['legacy month-first format', '9:00 PM, August 19, 2026'],
    ['legacy abbreviated-month format', '9:00 PM, Aug 19, 2026'],
    ['legacy format without the year comma', '9:00 PM, August 19 2026'],
  ])('parses the %s', async (_label, tourDate) => {
    const parsed = await new FreeTourBookingParser().parse(buildContext(tourDate));

    expect(parsed?.platformBookingId).toBe(BOOKING_ID);
    expect(parsed?.bookingFields).toEqual(
      expect.objectContaining({
        experienceDate: '2026-08-19',
        experienceStartAt: new Date('2026-08-19T19:00:00.000Z'),
      }),
    );
  });

  it.each([
    ['a mismatched weekday', '9:00 PM, Tuesday, 19 August 2026'],
    ['an invalid calendar date', '9:00 PM, 30 February 2026'],
    ['an invalid time', '9:77 PM, 19 August 2026'],
  ])('returns null experience fields for %s', async (_label, tourDate) => {
    const parsed = await new FreeTourBookingParser().parse(buildContext(tourDate));

    expect(parsed?.bookingFields).toEqual(
      expect.objectContaining({
        experienceDate: null,
        experienceStartAt: null,
      }),
    );
  });
});
