import { formatPaymentMinor, formatRecordedPayment, paymentMethodLabel } from './stripePaymentDisplay';
import { paymentFixture } from '../components/bookings/__fixtures__/bookingPayments';

it.each([[24000, 'pln', '240.00 PLN'], [1200, 'jpy', '1,200 JPY'], [12345, 'bhd', '12.345 BHD'], [12000, 'isk', '120.00 ISK'], [12000, 'ugx', '120.00 UGX'], [0, 'eur', '0.00 EUR']])('formats Stripe minor units for %s %s', (amount, currency, expected) => {
  expect(formatPaymentMinor(Number(amount), String(currency))).toBe(expected);
});
it('does not turn unavailable money into zero', () => {
  expect(formatPaymentMinor(NaN, 'pln')).toBe('Not available');
  expect(formatRecordedPayment(null, 'PLN')).toBe('Not recorded');
  expect(formatRecordedPayment('', 'PLN')).toBe('Not recorded');
  expect(formatRecordedPayment('120.25', 'pln')).toBe('120.25 PLN');
});
it('labels cards with only their last four digits and supports non-card methods', () => {
  expect(paymentMethodLabel(paymentFixture.payment!.paymentMethod)).toBe('Mastercard •••• 0858');
  expect(paymentMethodLabel({ ...paymentFixture.payment!.paymentMethod!, type: 'blik', brand: null, last4: null })).toBe('BLIK');
  expect(paymentMethodLabel(null)).toBe('Payment method unavailable');
});
