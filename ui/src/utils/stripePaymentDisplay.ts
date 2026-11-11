import type { PaymentMethodDetails } from '../api/bookingPayments';

// Stripe charge units differ from ISO display units for ISK and UGX.
const ZERO_DECIMAL = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);
export function formatPaymentMinor(amount: number, currency: string): string {
  const code = currency.toUpperCase();
  if (!Number.isFinite(amount)) return 'Not available';
  try {
    const digits = ZERO_DECIMAL.has(code) ? 0 : ['ISK', 'UGX'].includes(code) ? 2 : new Intl.NumberFormat('en-GB', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits;
    return `${new Intl.NumberFormat('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount / (10 ** digits))} ${code}`;
  } catch { return `${amount} minor units (${code || 'unknown currency'})`; }
}
export function formatRecordedPayment(amount: string | null, currency: string | null): string {
  if (amount == null || !amount.trim() || !currency || !Number.isFinite(Number(amount))) return 'Not recorded';
  try { return `${new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(amount))} ${currency.toUpperCase()}`; }
  catch { return 'Not recorded'; }
}
export const paymentLabel = (value: string | null | undefined): string => value
  ? ({ requires_capture: 'Authorized', requires_action: 'Authentication required', requires_payment_method: 'Payment method required', requires_confirmation: 'Awaiting confirmation', succeeded: 'Succeeded', canceled: 'Cancelled', sepa_debit: 'SEPA Direct Debit', card: 'Card', blik: 'BLIK', p24: 'Przelewy24', apple_pay: 'Apple Pay', google_pay: 'Google Pay' } as Record<string, string>)[value] ?? value.replace(/[_.-]+/g, ' ').replace(/^\w/, c => c.toUpperCase())
  : 'Not recorded';
export const paymentStatusColor = (value: string | null | undefined) => ['succeeded', 'paid', 'won', 'authenticated'].includes(value ?? '') ? 'teal'
  : ['failed', 'canceled', 'lost', 'requires_payment_method'].includes(value ?? '') ? 'red'
    : ['processing', 'pending', 'requires_action', 'requires_capture', 'needs_response', 'warning_needs_response'].includes(value ?? '') ? 'orange' : 'gray';
export function paymentMethodLabel(method: PaymentMethodDetails | null): string {
  if (!method) return 'Payment method unavailable';
  return `${paymentLabel(method.brand || method.type)}${method.last4 ? ` •••• ${method.last4}` : ''}`;
}
export const stripeEventLabel = (type: string) => ({
  'payment_intent.created': 'Payment started', 'payment_intent.amount_capturable_updated': 'Payment authorized',
  'payment_intent.succeeded': 'Payment succeeded', 'payment_intent.payment_failed': 'Payment failed',
  'payment_intent.canceled': 'Payment cancelled', 'payment_intent.requires_action': 'Customer authentication required',
  'charge.succeeded': 'Charge succeeded', 'charge.failed': 'Charge failed', 'charge.captured': 'Payment captured',
  'charge.refunded': 'Charge refund updated', 'refund.created': 'Refund created', 'refund.updated': 'Refund updated',
  'refund.failed': 'Refund failed', 'charge.dispute.created': 'Dispute opened', 'charge.dispute.closed': 'Dispute closed',
} as Record<string, string>)[type] ?? paymentLabel(type);
