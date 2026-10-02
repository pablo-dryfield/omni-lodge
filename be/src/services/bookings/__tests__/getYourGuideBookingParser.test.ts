jest.mock('../../configService.js', () => ({
  getConfigValue: jest.fn(() => null),
}));

import { GetYourGuideBookingParser } from '../parsers/getYourGuideBookingParser.js';
import type { BookingParserContext } from '../types.js';

const buildContext = (dateLine: string): BookingParserContext => {
  const from = 'GetYourGuide <do-not-reply@notification.getyourguide.com>';

  return {
    messageId: 'getyourguide-date-test',
    subject: 'Booking - S264786 - GYGBLHA3ZMHH',
    from,
    headers: { from },
    textBody: [
      'Hi Supply Partner, great news!',
      'Your offer has been booked: Krakow: Pub Crawl 1H Open Bar, VIP Entry & Welcome Shots',
      'Reference number GYGBLHA3ZMHH',
      dateLine,
      'Number of participants 2 x Adults (Age 0 - 99)',
      'Main customer Luna Amelia customer-5k5f65a2ys3u22tk@reply.getyourguide.com',
      'Phone: +4529902697',
      'Language: Danish',
      'Tour language English (Live tour guide)',
      'Price zł 245.00',
      'Open booking',
    ].join(' '),
  };
};

describe('GetYourGuide booking date parsing', () => {
  it.each([
    ['legacy format without a separator after the year', 'Date October 1, 2026 9:00 PM'],
    ['new format with a comma after the year', 'Date October 1, 2026, 9:00 PM'],
    ['new format with a narrow no-break space before AM/PM', 'Date October 1, 2026, 9:00\u202fPM'],
  ])('parses the %s', async (_label, dateLine) => {
    const parsed = await new GetYourGuideBookingParser().parse(buildContext(dateLine));

    expect(parsed?.platformBookingId).toBe('GYGBLHA3ZMHH');
    expect(parsed?.bookingFields).toEqual(
      expect.objectContaining({
        experienceDate: '2026-10-01',
        experienceStartAt: new Date('2026-10-01T19:00:00.000Z'),
      }),
    );
  });
});
