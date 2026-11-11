import { allocateBookingStripeFee, normalizeStripeFeeForBooking } from '../stripeProcessingFee';

it('keeps matching currencies exact, including verified zero fees', () => {
  expect(normalizeStripeFeeForBooking({ feeMinor: 929, currency: 'PLN', chargeCurrency: 'PLN', exchangeRate: null }, 'PLN'))
    .toEqual({ feeMinor: 929, currency: 'PLN', exchangeRateUsed: null });
});

it('uses exact decimal half-up conversion in the correct direction before allocating', () => {
  expect(normalizeStripeFeeForBooking({ feeMinor: 101, currency: 'PLN', chargeCurrency: 'EUR', exchangeRate: 2 }, 'EUR').feeMinor).toBe(51);
  expect(normalizeStripeFeeForBooking({ feeMinor: 1000, currency: 'PLN', chargeCurrency: 'EUR', exchangeRate: 4.3 }, 'EUR').feeMinor).toBe(233);
  expect([...allocateBookingStripeFee(233, 'EUR', [1, 2])]).toEqual([[1, '1.17'], [2, '1.16']]);
});

it.each([null, 0, -1, NaN])('rejects missing or invalid transaction exchange rates: %s', exchangeRate => {
  expect(() => normalizeStripeFeeForBooking({ feeMinor: 1000, currency: 'PLN', chargeCurrency: 'EUR', exchangeRate }, 'EUR')).toThrow('exchange rate');
});

it('rejects a currency unrelated to the Stripe charge and missing booking currencies', () => {
  const source = { feeMinor: 1000, currency: 'PLN', chargeCurrency: 'EUR', exchangeRate: 4.3 };
  expect(() => normalizeStripeFeeForBooking(source, 'USD')).toThrow('exchange rate');
  expect(() => normalizeStripeFeeForBooking(source, null)).toThrow('currency is missing');
});
