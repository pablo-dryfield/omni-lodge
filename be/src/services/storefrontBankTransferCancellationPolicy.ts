export type BankTransferCancellationSnapshot = {
  orderSource: string;
  paymentMethod: string;
  status: string;
  paymentStatus: string;
};

export type BankTransferCancellationDecision = 'cancel' | 'already_cancelled' | 'reject';

/**
 * Keeps cancellation eligibility independent from Stripe/refund flows.
 * The caller must evaluate this policy while holding the storefront-order lock.
 */
export const resolveBankTransferCancellation = (
  order: BankTransferCancellationSnapshot,
): BankTransferCancellationDecision => {
  if (order.orderSource !== 'backoffice' || order.paymentMethod !== 'bank_transfer') return 'reject';
  if (order.paymentStatus !== 'unpaid') return 'reject';
  if (order.status === 'cancelled') return 'already_cancelled';
  return order.status === 'pending_payment' ? 'cancel' : 'reject';
};
