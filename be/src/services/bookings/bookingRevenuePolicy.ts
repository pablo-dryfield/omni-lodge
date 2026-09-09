type BookingPaymentSnapshot = {
  paymentStatus?: unknown;
};

const normalizePaymentStatus = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

/**
 * An explicitly unpaid booking is operationally real, but its sale is not yet
 * recognized. Legacy bookings with an absent or unknown payment status retain
 * their historical behavior.
 */
export const isBookingRevenueRecognized = (booking: BookingPaymentSnapshot): boolean =>
  normalizePaymentStatus(booking.paymentStatus) !== 'unpaid';
