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
