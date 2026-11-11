import type { BookingPaymentDetails, BookingPaymentEvents } from '../../../api/bookingPayments';

export const paymentFixture: BookingPaymentDetails = {
  bookingId: 42, state: 'available', message: null, scope: 'order', orderReference: 'order-42', merchant: 'Food Tour',
  recorded: { amount: '120.00', currency: 'PLN', paymentStatus: 'paid', paymentMethod: 'card', refundedAmount: '0' },
  payment: { id: 'pi_One', paymentIntentId: 'pi_One', chargeId: 'ch_One', mode: 'live', accountId: 'acct_One', amount: 24000, amountReceived: 24000, amountCapturable: 0, amountRefunded: 3000, currency: 'pln', status: 'succeeded', created: 1794400000, canceledAt: null, receiptEmail: 'alex@example.com', billingName: 'Alex Morgan', receiptUrl: 'https://pay.stripe.com/receipts/demo', description: 'Two Food Tour bookings', statementDescriptor: 'FOOD TOUR KRAKOW',
    paymentMethod: { type: 'card', brand: 'mastercard', last4: '0858', expiryMonth: 3, expiryYear: 2029, country: 'PL', funding: 'credit', wallet: 'apple_pay', threeDSecure: { result: 'authenticated', version: '2.2.0', flow: 'frictionless' } },
    dashboardUrl: 'https://dashboard.stripe.com/acct_One/payments/pi_One', settlement: { amount: 24000, fee: 400, net: 23600, currency: 'pln' } },
  charges: [{ id: 'ch_One', amount: 24000, currency: 'pln', status: 'succeeded', created: 1794400000, reason: null, description: null, dashboardUrl: 'https://dashboard.stripe.com/payments/pi_One' }],
  refunds: [{ id: 're_One', amount: 3000, currency: 'pln', status: 'succeeded', created: 1794401000, reason: 'requested_by_customer', description: null, dashboardUrl: 'https://dashboard.stripe.com/payments/pi_One' }], disputes: [], truncated: [], warnings: [],
  activity: [{ id: 'payment-created-pi_One', source: 'stripe', title: 'Payment started', created: 1794400000, status: null, amount: 24000, currency: 'pln', actor: null, reference: 'pi_One' }],
  requests: [{ id: 'req_Read', created: 1794400000, source: 'refresh', description: 'Read during this refresh', method: 'GET', path: '/v1/payment_intents/pi_One', status: 200, dashboardUrl: 'https://dashboard.stripe.com/logs/req_Read' }], checkedAt: '2026-11-11T12:00:00Z',
};
export const eventsFixture: BookingPaymentEvents = {
  paymentId: 'pi_One', mode: 'live', events: [{ id: 'evt_One', type: 'payment_intent.succeeded', created: 1794400500, objectId: 'pi_One', status: 'succeeded', amount: 24000, currency: 'pln', requestId: 'req_Original', dashboardUrl: 'https://dashboard.stripe.com/events/evt_One' }],
  requests: [{ id: 'req_Original', created: 1794400500, source: 'event', description: 'Payment intent succeeded', method: null, path: null, status: null, dashboardUrl: 'https://dashboard.stripe.com/logs/req_Original' }],
  hasMore: false, nextCursor: null, scanned: 50, from: 1794400000, to: 1794401000, checkedAt: '2026-11-11T12:00:00Z',
};
