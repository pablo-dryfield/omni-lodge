import { resolveBankTransferCancellation } from '../storefrontBankTransferCancellationPolicy';

const awaiting = {
  orderSource: 'backoffice',
  paymentMethod: 'bank_transfer',
  status: 'pending_payment',
  paymentStatus: 'unpaid',
};

describe('bank-transfer cancellation policy', () => {
  it('allows only an unpaid backoffice bank-transfer reservation', () => {
    expect(resolveBankTransferCancellation(awaiting)).toBe('cancel');
  });

  it('treats a repeated cancellation as an idempotent retry', () => {
    expect(resolveBankTransferCancellation({ ...awaiting, status: 'cancelled' })).toBe('already_cancelled');
  });

  it.each([
    { paymentStatus: 'paid', status: 'confirmed' },
    { paymentStatus: 'refunded', status: 'cancelled' },
    { paymentMethod: 'stripe' },
    { orderSource: 'storefront' },
    { status: 'confirmed' },
  ])('rejects non-eligible state %#', (patch) => {
    expect(resolveBankTransferCancellation({ ...awaiting, ...patch })).toBe('reject');
  });
});
