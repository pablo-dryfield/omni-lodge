import Decimal from 'decimal.js';
import HttpError from '../../errors/HttpError.js';

const Money = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type StripeSettlementFee = {
  feeMinor: number;
  currency: string;
  chargeCurrency: string;
  exchangeRate: number | null;
};

const currencyScale = (currency: string): number => {
  // Stripe retains two-decimal API compatibility for ISK and UGX.
  const digits = ['ISK', 'UGX'].includes(currency) ? 2
    : new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  if (digits == null || digits > 2) throw new HttpError(409, 'The currency needs more precision than the booking fee field supports.');
  return 10 ** digits;
};

export const normalizeStripeFeeForBooking = (source: StripeSettlementFee, bookingCurrency: string | null) => {
  const currency = String(bookingCurrency ?? '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new HttpError(409, 'The booking currency is missing.');
  if (!Number.isSafeInteger(source.feeMinor) || source.feeMinor < 0) throw new HttpError(409, 'Invalid Stripe fee.');
  if (source.currency === currency) return { feeMinor: source.feeMinor, currency, exchangeRateUsed: null };
  if (source.chargeCurrency !== currency || source.exchangeRate == null || !Number.isFinite(source.exchangeRate) || source.exchangeRate <= 0) {
    throw new HttpError(409, 'Stripe did not provide the transaction exchange rate needed for this booking currency.');
  }
  // Stripe's rate converts charge currency to settlement currency, so reverse it for reporting.
  const feeMinor = new Money(source.feeMinor).div(currencyScale(source.currency)).div(source.exchangeRate)
    .mul(currencyScale(currency)).toDecimalPlaces(0, Money.ROUND_HALF_UP).toNumber();
  if (!Number.isSafeInteger(feeMinor) || feeMinor < 0) throw new HttpError(409, 'The converted fee exceeds supported precision.');
  return { feeMinor, currency, exchangeRateUsed: source.exchangeRate };
};

/** Equal booking-line shares preserve the total, with deterministic native-unit remainders. */
export const allocateBookingStripeFee = (feeMinor: number, currency: string, bookingIds: number[]): Map<number, string> => {
  if (!Number.isSafeInteger(feeMinor) || feeMinor < 0 || !bookingIds.length) throw new HttpError(409, 'Invalid fee allocation.');
  const ids = [...new Set(bookingIds)].sort((a, b) => a - b);
  if (ids.some(value => !Number.isSafeInteger(value) || value <= 0)) throw new HttpError(409, 'Invalid booking identity.');
  const scale = currencyScale(currency);
  const base = Math.floor(feeMinor / ids.length), remainder = feeMinor % ids.length;
  return new Map(ids.map((bookingId, index) => [bookingId, new Money(base + (index < remainder ? 1 : 0)).div(scale).toFixed(2)]));
};
