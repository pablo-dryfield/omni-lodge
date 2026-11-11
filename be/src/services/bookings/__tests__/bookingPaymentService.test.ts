jest.mock('../../../__mocks__/sequelizeModelStub', () => jest.requireMock('../../../models/User.js'));
jest.mock('../../../models/Booking.js', () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock('../../../models/BookingEvent.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../../models/StorefrontOrder.js', () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock('../../../models/User.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../../finance/services/stripeClient.js', () => ({ getStripeClient: jest.fn(), getDirectStripeClient: jest.fn(), normalizeDirectStripeMerchant: (v: string) => v === 'food-tour' ? 'food-tour' : undefined }));
jest.mock('../../ecwidService.js', () => ({ getEcwidOrder: jest.fn() }));
jest.mock('../../configService.js', () => ({ getConfigValue: jest.fn(), refreshConfigCacheKeys: jest.fn() }));

import Booking from '../../../models/Booking';
import BookingEvent from '../../../models/BookingEvent';
import StorefrontOrder from '../../../models/StorefrontOrder';
import User from '../../../models/User';
import { getDirectStripeClient, getStripeClient } from '../../../finance/services/stripeClient';
import { getEcwidOrder } from '../../ecwidService';
import { getConfigValue, refreshConfigCacheKeys } from '../../configService';
import { getBookingPaymentDetails, getBookingPaymentEvents, getBookingStripeFeeSnapshot, paymentReadError } from '../bookingPaymentService';

const now = Math.floor(new Date('2026-11-11T12:00:00Z').getTime() / 1000);
const response = <T extends object>(row: T) => ({ ...row, lastResponse: { requestId: 'req_Read123', statusCode: 200 } });
const list = (data: unknown[] = [], more = false) => response({ data, has_more: more });
const charge = (extra = {}) => ({ id: 'ch_One', payment_intent: 'pi_One', amount: 24000, amount_captured: 24000, amount_refunded: 3000, currency: 'pln', status: 'succeeded', paid: true, captured: true, created: now - 100, livemode: true,
  payment_method_details: { type: 'card', card: { brand: 'mastercard', last4: '0858', exp_month: 3, exp_year: 2029, country: 'PL', funding: 'credit', wallet: { type: 'apple_pay' }, three_d_secure: { result: 'authenticated', version: '2.2.0', authentication_flow: 'frictionless' }, fingerprint: 'PRIVATE-FINGERPRINT' } },
  billing_details: { name: 'Alex Morgan', email: 'alex@example.com', address: { line1: 'PRIVATE-ADDRESS' } }, receipt_url: 'https://pay.stripe.com/receipts/test',
  balance_transaction: { id: 'txn_One', amount: 24000, fee: 400, net: 23600, currency: 'pln' }, ...extra });
const intent = (extra = {}) => response({ id: 'pi_One', amount: 24000, amount_received: 24000, amount_capturable: 0, currency: 'pln', status: 'succeeded', created: now - 200, livemode: true, latest_charge: charge(), payment_method: null, client_secret: 'PRIVATE-CLIENT-SECRET', ...extra });
const client = {
  paymentIntents: { retrieve: jest.fn() }, charges: { retrieve: jest.fn(), list: jest.fn() }, refunds: { list: jest.fn() }, disputes: { list: jest.fn() },
  accounts: { retrieve: jest.fn() }, events: { list: jest.fn() }, balanceTransactions: { retrieve: jest.fn() },
};
const booking = (extra = {}) => ({ id: 42, platform: 'direct', notes: 'Stripe payment: pi_One\nStripe livemode: true', paymentMethod: 'card', paymentStatus: 'paid', priceGross: '120.00', currency: 'PLN', refundedAmount: '0', ...extra });
const event = (id: string, data: object, type = 'payment_intent.succeeded') => ({ id, type, created: now - 20, data: { object: data }, request: { id: 'req_Original', idempotency_key: 'PRIVATE-IDEMPOTENCY' } });

beforeEach(() => {
  jest.resetAllMocks(); jest.useFakeTimers().setSystemTime(now * 1000);
  (Booking.findByPk as jest.Mock).mockResolvedValue(booking());
  (BookingEvent.findAll as jest.Mock).mockResolvedValue([]); (User.findAll as jest.Mock).mockResolvedValue([]);
  (getConfigValue as jest.Mock).mockImplementation(key => ({ BOOKING_PAYMENTS_PAGE_SIZE: 10, BOOKING_PAYMENTS_EVENT_SCAN_PAGES: 2, BOOKING_PAYMENTS_REQUEST_TIMEOUT_MS: 4000 } as Record<string, number>)[key]);
  (getStripeClient as jest.Mock).mockReturnValue(client); (getDirectStripeClient as jest.Mock).mockReturnValue(client);
  client.paymentIntents.retrieve.mockResolvedValue(intent()); client.charges.retrieve.mockResolvedValue(response(charge()));
  client.accounts.retrieve.mockResolvedValue(response({ id: 'acct_Main' })); client.charges.list.mockResolvedValue(list([charge()]));
  client.refunds.list.mockResolvedValue(list([{ id: 're_One', amount: 3000, currency: 'pln', status: 'succeeded', created: now - 10, reason: 'requested_by_customer' }]));
  client.disputes.list.mockResolvedValue(list()); client.events.list.mockResolvedValue(list());
});
afterEach(() => jest.useRealTimers());

it('reads a fee without loading unrelated payment history or mutating a booking', async () => {
  const result = await getBookingStripeFeeSnapshot(booking({ stripeMerchant: 'food-tour' }) as never, { timeout: 5000 });
  expect(result).toMatchObject({ feeMinor: 400, currency: 'PLN', balanceTransactionId: 'txn_One', chargeId: 'ch_One', paymentIntentId: 'pi_One', mode: 'live', merchant: 'food-tour' });
  expect(getDirectStripeClient).toHaveBeenCalledWith('food-tour', 'live');
  expect(client.refunds.list).not.toHaveBeenCalled();
  expect(client.accounts.retrieve).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
});

it.each([null, { id: 'txn_One', fee: 0, currency: 'pln' }])('keeps unavailable fees distinct from a verified zero fee: %j', async balance => {
  client.paymentIntents.retrieve.mockResolvedValue(intent({ latest_charge: charge({ balance_transaction: balance }) }));
  const result = await getBookingStripeFeeSnapshot(booking() as never, {});
  if (balance === null) expect(result).toBeNull();
  else expect(result).toMatchObject({ feeMinor: 0, balanceTransactionId: 'txn_One' });
});

it('fetches a non-expanded balance transaction and retains its settlement currency', async () => {
  client.paymentIntents.retrieve.mockResolvedValue(intent({ latest_charge: charge({ balance_transaction: 'txn_One' }) }));
  client.balanceTransactions.retrieve.mockResolvedValue({ id: 'txn_One', fee: 151, currency: 'eur' });
  expect(await getBookingStripeFeeSnapshot(booking() as never, { timeout: 3000 })).toMatchObject({ currency: 'EUR', feeMinor: 151 });
  expect(client.balanceTransactions.retrieve).toHaveBeenCalledWith('txn_One', {}, { timeout: 3000 });
});

it.each([{ captured: false }, { paid: false }])('does not record a fee before capture: %j', async state => {
  client.paymentIntents.retrieve.mockResolvedValue(intent({ latest_charge: charge(state) }));
  expect(await getBookingStripeFeeSnapshot(booking() as never, {})).toBeNull();
});

it.each([undefined, -1, 1.5, NaN])('never substitutes zero for an invalid or missing provider fee: %s', async fee => {
  client.paymentIntents.retrieve.mockResolvedValue(intent({ latest_charge: charge({ balance_transaction: { id: 'txn_One', fee, currency: 'pln' } }) }));
  await expect(getBookingStripeFeeSnapshot(booking() as never, {})).rejects.toThrow('valid processing-fee');
});

it('reads stored direct payment references and exposes only a safe payment-method summary', async () => {
  const result = await getBookingPaymentDetails(42);
  expect(result).toMatchObject({ state: 'available', scope: 'booking', recorded: { amount: '120.00' }, payment: { id: 'pi_One', amount: 24000, amountRefunded: 3000, paymentMethod: { brand: 'mastercard', last4: '0858', wallet: 'apple_pay', threeDSecure: { result: 'authenticated' } }, settlement: { fee: 400, net: 23600 } } });
  expect(result.payment?.dashboardUrl).toBe('https://dashboard.stripe.com/acct_Main/payments/pi_One');
  expect(client.refunds.list).toHaveBeenCalledWith({ payment_intent: 'pi_One', limit: 10 }, { timeout: 4000, maxNetworkRetries: 0 });
  expect(result.requests[0]).toMatchObject({ method: 'GET', status: 200, source: 'refresh' });
  expect(JSON.stringify(result)).not.toContain('PRIVATE-');
  expect(refreshConfigCacheKeys).toHaveBeenCalledWith(expect.arrayContaining(['BOOKING_PAYMENTS_PAGE_SIZE', 'FOOD_TOUR_STRIPE_SECRET_KEY']));
});

it('resolves Ecwid order references through its live account and labels whole-order totals', async () => {
  (Booking.findByPk as jest.Mock).mockResolvedValue(booking({ platform: 'ecwid', platformBookingId: 'ABC-123', notes: null }));
  (getEcwidOrder as jest.Mock).mockResolvedValue({ externalTransactionId: 'ch_One' });
  const result = await getBookingPaymentDetails(42);
  expect(getEcwidOrder).toHaveBeenCalledWith('ABC'); expect(getStripeClient).toHaveBeenCalled();
  expect(getDirectStripeClient).not.toHaveBeenCalled();
  expect(result).toMatchObject({ scope: 'order', orderReference: 'ABC', merchant: 'Ecwid', payment: { id: 'pi_One' } });
});

it('uses the persisted storefront order and its separate Food Tour Stripe merchant', async () => {
  (Booking.findByPk as jest.Mock).mockResolvedValue(booking({ platform: 'omnilodge', platformOrderId: 'order-42', stripeMerchant: 'food-tour', notes: null }));
  (StorefrontOrder.findOne as jest.Mock).mockResolvedValue({ publicId: 'order-42', stripePaymentIntentId: 'pi_One', metadata: { stripeMode: 'test' } });
  client.paymentIntents.retrieve.mockResolvedValue(intent({ livemode: false }));
  const result = await getBookingPaymentDetails(42);
  expect(StorefrontOrder.findOne).toHaveBeenCalledWith({ where: { publicId: 'order-42' } });
  expect(getDirectStripeClient).toHaveBeenCalledWith('food-tour', 'test'); expect(getStripeClient).not.toHaveBeenCalled();
  expect(result).toMatchObject({ scope: 'order', merchant: 'Food Tour', payment: { mode: 'test' } });
  expect(result.payment?.dashboardUrl).toContain('/test/payments/');
});

it('never falls back to another merchant or mode when a stored Food Tour reference is missing', async () => {
  (Booking.findByPk as jest.Mock).mockResolvedValue(booking({ stripeMerchant: 'food-tour' }));
  client.paymentIntents.retrieve.mockRejectedValue({ code: 'resource_missing', message: 'PRIVATE-SECRET' });
  expect(await getBookingPaymentDetails(42)).toMatchObject({ state: 'unavailable', message: expect.stringContaining('not found') });
  expect(getDirectStripeClient).toHaveBeenCalledTimes(1); expect(getDirectStripeClient).toHaveBeenCalledWith('food-tour', 'live');
  expect(getStripeClient).not.toHaveBeenCalled();
});

it('tries the other mode only for an unknown-mode missing object and drops wrong-mode request references', async () => {
  (Booking.findByPk as jest.Mock).mockResolvedValue(booking({ notes: 'pi_One' }));
  client.paymentIntents.retrieve.mockRejectedValueOnce({ code: 'resource_missing', requestId: 'req_WrongMode', statusCode: 404 }).mockResolvedValueOnce(intent());
  const result = await getBookingPaymentDetails(42);
  expect(getDirectStripeClient).toHaveBeenNthCalledWith(1, undefined, 'test'); expect(getDirectStripeClient).toHaveBeenNthCalledWith(2, undefined, 'live');
  expect(result.state).toBe('available'); expect(JSON.stringify(result.requests)).not.toContain('req_WrongMode');
});

it.each(['requires_capture', 'requires_payment_method', 'processing', 'canceled'])('displays %s payments without applying refund eligibility guards', async status => {
  client.paymentIntents.retrieve.mockResolvedValue(intent({ status, latest_charge: null, amount_received: 0, amount_capturable: status === 'requires_capture' ? 24000 : 0, canceled_at: status === 'canceled' ? now - 40 : null, payment_method: { type: 'card', card: { brand: 'visa', last4: '4242' } } }));
  expect((await getBookingPaymentDetails(42)).payment).toMatchObject({ status, paymentMethod: { brand: 'visa', last4: '4242' } });
});

it('retains authorized legacy charge amounts and rejects unsafe receipt URLs', async () => {
  (Booking.findByPk as jest.Mock).mockResolvedValue(booking({ notes: 'ch_One\nStripe mode: live' }));
  client.charges.retrieve.mockResolvedValue(response(charge({ payment_intent: null, captured: false, amount_captured: 0, receipt_url: 'https://evil.example/receipt' })));
  const result = await getBookingPaymentDetails(42);
  expect(result.payment).toMatchObject({ id: 'ch_One', status: 'requires_capture', amountReceived: 0, amountCapturable: 24000, receiptUrl: null });
  expect(client.refunds.list).toHaveBeenCalledWith(expect.objectContaining({ charge: 'ch_One' }), expect.anything());
});

it('expands a string latest-charge reference and reports a fully refunded payment', async () => {
  client.paymentIntents.retrieve.mockResolvedValue(intent({ latest_charge: 'ch_One' }));
  client.charges.retrieve.mockResolvedValue(response(charge({ amount_refunded: 24000 })));
  const result = await getBookingPaymentDetails(42);
  expect(client.charges.retrieve).toHaveBeenCalledWith('ch_One', { expand: ['balance_transaction'] }, expect.anything());
  expect(result.payment).toMatchObject({ amountRefunded: 24000, amountReceived: 24000, settlement: { fee: 400 } });
});

it('identifies an Ecwid connection failure without leaking its response', async () => {
  (Booking.findByPk as jest.Mock).mockResolvedValue(booking({ platform: 'ecwid', platformOrderId: 'ABC' }));
  (getEcwidOrder as jest.Mock).mockRejectedValue(new Error('PRIVATE-ECWID-TOKEN'));
  const result = await getBookingPaymentDetails(42);
  expect(result.state).toBe('unavailable'); expect(result.message).toContain('Ecwid connection');
  expect(JSON.stringify(result)).not.toContain('PRIVATE'); expect(client.paymentIntents.retrieve).not.toHaveBeenCalled();
});

it.each([{ platform: 'viator' }, { paymentMethod: 'bank_transfer' }, { notes: '' }])('shows saved payment data when Stripe is inapplicable or unlinked: %j', async extra => {
  (Booking.findByPk as jest.Mock).mockResolvedValue(booking(extra));
  const result = await getBookingPaymentDetails(42);
  expect(result.payment).toBeNull(); expect(result.message).toBeTruthy(); expect(result.recorded.amount).toBe('120.00');
  expect(client.paymentIntents.retrieve).not.toHaveBeenCalled();
});

it('keeps core information when refunds fail and explicitly marks truncated sections', async () => {
  client.refunds.list.mockRejectedValue({ type: 'StripePermissionError', message: 'PRIVATE-KEY' });
  client.disputes.list.mockResolvedValue(list([{ id: 'dp_One', amount: 24000, currency: 'pln', created: now - 5, status: 'needs_response', reason: 'fraudulent' }], true));
  const result = await getBookingPaymentDetails(42);
  expect(result.state).toBe('available'); expect(result.warnings[0]).toContain('Refunds:'); expect(result.truncated).toContain('disputes');
  expect(result.disputes[0].reason).toBe('fraudulent'); expect(JSON.stringify(result)).not.toContain('PRIVATE-KEY');
});

it('includes local payment audit actions with actor names but never raw payloads', async () => {
  (BookingEvent.findAll as jest.Mock).mockResolvedValue([{ id: 7, eventType: 'note', eventPayload: { action: 'counter-addon-refund-submitted', actorId: 8, stripeRefundId: 're_One', secret: 'PRIVATE-PAYLOAD' }, occurredAt: new Date(now * 1000) }, { id: 8, eventType: 'amendment', eventPayload: {} }]);
  (User.findAll as jest.Mock).mockResolvedValue([{ id: 8, firstName: 'A', lastName: 'Manager' }]);
  const result = await getBookingPaymentDetails(42);
  expect(result.activity).toContainEqual(expect.objectContaining({ id: 'booking-event-7', actor: 'A Manager', reference: 're_One' }));
  expect(result.activity.some(row => row.id === 'booking-event-8')).toBe(false);
  expect(JSON.stringify(result)).not.toContain('PRIVATE-PAYLOAD');
});

it('filters account events to this payment, safely projects them and resumes a bounded search', async () => {
  client.events.list.mockResolvedValueOnce(list([event('evt_Other', { id: 'pi_Unrelated', amount: 1000, metadata: { private: 'PRIVATE-OTHER' } }), event('evt_Match', { id: 're_One', payment_intent: 'pi_One', amount: 3000, currency: 'pln', client_secret: 'PRIVATE-EVENT' }, 'refund.created')], true))
    .mockResolvedValueOnce(list([event('evt_Last', { id: 'ch_One', payment_intent: 'pi_One', amount: 24000, currency: 'pln' }, 'charge.succeeded')], true));
  const result = await getBookingPaymentEvents(42);
  expect(result.events.map(row => row.id)).toEqual(['evt_Match', 'evt_Last']); expect(result).toMatchObject({ paymentId: 'pi_One', mode: 'live', hasMore: true, nextCursor: `${now}.evt_Last`, scanned: 3 });
  expect(client.events.list).toHaveBeenNthCalledWith(1, { limit: 10, created: { gte: now - 200, lte: now } }, expect.anything());
  expect(client.events.list).toHaveBeenNthCalledWith(2, expect.objectContaining({ starting_after: 'evt_Match' }), expect.anything());
  expect(result.requests.find(row => row.source === 'event')).toMatchObject({ id: 'req_Original', method: null, status: null, path: null });
  expect(JSON.stringify(result)).not.toContain('PRIVATE-'); expect(JSON.stringify(result.events)).not.toContain('pi_Unrelated');
  await getBookingPaymentEvents(42, result.nextCursor!);
  expect(client.events.list).toHaveBeenLastCalledWith(expect.objectContaining({ starting_after: 'evt_Last', created: { gte: now - 200, lte: now } }), expect.anything());
});

it('bounds old payments to the actual 30-day provider window', async () => {
  client.paymentIntents.retrieve.mockResolvedValue(intent({ created: now - 80 * 86400 }));
  const result = await getBookingPaymentEvents(42);
  expect(result.from).toBe(now - 30 * 86400); expect(result.hasMore).toBe(false);
});

it.each(['bad', `${now + 1}.evt_Future`, `${now - 31 * 86400}.evt_Expired`, `${now - 500}.evt_BeforePayment`])('rejects invalid or stale cursors: %s', async cursor => {
  await expect(getBookingPaymentEvents(42, cursor)).rejects.toMatchObject({ status: 400 });
  expect(client.events.list).not.toHaveBeenCalled();
});

it('handles missing bookings before using Stripe and sanitizes provider failures', async () => {
  (Booking.findByPk as jest.Mock).mockResolvedValue(null);
  await expect(getBookingPaymentDetails(42)).rejects.toMatchObject({ status: 404 });
  expect(getDirectStripeClient).not.toHaveBeenCalled();
  expect(paymentReadError({ message: 'sk_live_PRIVATE' })).not.toContain('PRIVATE');
});
