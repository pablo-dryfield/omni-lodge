import { resolvePaidOrderFulfillmentPolicy } from '../storefrontOrderFulfillmentPolicy';

const request = {
  actorId: 19,
  paymentMethod: 'bank_transfer',
  paymentReceivedByUserId: 19,
  paymentNote: 'Seen in the bank account',
  receivedPaymentReference: 'BANK-NEW',
  clientRequestId: 'c93c9750-72d3-4cf5-aa0e-e23258c78a31',
  stripePaymentIntentId: null,
  fallbackPaymentMethod: 'unknown',
  systemUserId: 1,
};

describe('resolvePaidOrderFulfillmentPolicy', () => {
  it.each([
    { status: 'confirmed', paymentStatus: 'partial' },
    { status: 'confirmed', paymentStatus: 'refunded' },
    { status: 'cancelled', paymentStatus: 'paid' },
    { status: 'cancelled', paymentStatus: 'unpaid' },
  ])('does not revive terminal order state $status/$paymentStatus', (state) => {
    const policy = resolvePaidOrderFulfillmentPolicy({
      ...state,
      paymentMethod: 'bank_transfer',
      metadata: {},
      createdByUserId: 3,
      paymentReceivedByUserId: 7,
    }, request);

    expect(policy.shouldProcess).toBe(false);
  });

  it('lets the first verifier own the receipt attribution', () => {
    const policy = resolvePaidOrderFulfillmentPolicy({
      status: 'pending_payment',
      paymentStatus: 'unpaid',
      paymentMethod: 'bank_transfer',
      metadata: { original: true },
      createdByUserId: 3,
      paymentReceivedByUserId: null,
    }, request);

    expect(policy).toMatchObject({
      shouldProcess: true,
      firstSettlement: true,
      actorId: 19,
      paymentMethod: 'bank_transfer',
      metadata: {
        original: true,
        receivedPaymentReference: 'BANK-NEW',
        paymentReceiptRequestId: request.clientRequestId,
      },
      receiptUpdates: {
        paymentReceivedByUserId: 19,
        paymentNote: 'Seen in the bank account',
      },
    });
  });

  it('preserves the first verifier, note, reference, method, and Stripe ID on a paid retry', () => {
    const existingMetadata = {
      receivedPaymentReference: 'BANK-FIRST',
      paymentReceiptRequestId: '35b399eb-269a-48e0-b06e-71bab70ee6fc',
    };
    const policy = resolvePaidOrderFulfillmentPolicy({
      status: 'confirmed',
      paymentStatus: 'paid',
      paymentMethod: 'bank_transfer',
      metadata: existingMetadata,
      createdByUserId: 3,
      paymentReceivedByUserId: 7,
    }, {
      ...request,
      paymentMethod: 'stripe',
      stripePaymentIntentId: 'pi_late_callback',
    });

    expect(policy).toEqual({
      shouldProcess: true,
      firstSettlement: false,
      actorId: 7,
      paymentMethod: 'bank_transfer',
      metadata: existingMetadata,
      receiptUpdates: {},
    });
  });
});
