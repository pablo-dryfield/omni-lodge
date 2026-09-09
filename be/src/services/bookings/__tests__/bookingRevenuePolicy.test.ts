import { isBookingRevenueRecognized } from '../bookingRevenuePolicy';

describe('isBookingRevenueRecognized', () => {
  it.each(['unpaid', ' UNPAID '])('does not recognize explicit unpaid bookings (%s)', (paymentStatus) => {
    expect(isBookingRevenueRecognized({ paymentStatus })).toBe(false);
  });

  it.each([undefined, null, '', 'unknown', 'paid', 'deposit', 'partial', 'refunded'])(
    'preserves revenue behavior for non-explicit-unpaid status %p',
    (paymentStatus) => {
      expect(isBookingRevenueRecognized({ paymentStatus })).toBe(true);
    },
  );
});
