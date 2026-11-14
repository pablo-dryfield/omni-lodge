jest.mock('../../../config/database.js', () => ({ __esModule: true, default: { transaction: jest.fn() } }));
jest.mock('../../../models/Partner.js', () => ({ PartnerBooking: { findOne: jest.fn(), update: jest.fn() }, PartnerProfile: { findByPk: jest.fn() }, PartnerPayment: { findOrCreate: jest.fn(), findAll: jest.fn() }, PartnerAmendment: { count: jest.fn() } }));
jest.mock('../../../models/StorefrontOrder.js', () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock('../../../models/Booking.js', () => ({ __esModule: true, default: { findAll: jest.fn().mockResolvedValue([]) } }));
jest.mock('../../../finance/services/stripeClient.js', () => ({ getStorefrontStripeClient: jest.fn(), isStorefrontStripeTestMode: () => true }));
jest.mock('../partnerConfig.js', () => ({ loadPartnerConfig: jest.fn() }));
jest.mock('../partnerEvents.js', () => ({ partnerEvent: jest.fn() }));
jest.mock('../../../models/BookingEvent.js', () => ({ __esModule: true, default: { create: jest.fn() } }));
import sequelize from '../../../config/database';
import { PartnerBooking, PartnerProfile, PartnerPayment, PartnerAmendment } from '../../../models/Partner';
import StorefrontOrder from '../../../models/StorefrontOrder';
import Booking from '../../../models/Booking';
import { getStorefrontStripeClient } from '../../../finance/services/stripeClient';
import { loadPartnerConfig } from '../partnerConfig';
import { reconcilePartnerOrder, partnerStatement } from '../partnerStripeService';

const transaction = { LOCK: { UPDATE: 'update' } };
let booking: any;
let stripe: any;
beforeEach(() => {
  jest.resetAllMocks();
  (Booking.findAll as jest.Mock).mockResolvedValue([]);
  (sequelize.transaction as jest.Mock).mockImplementation(fn => fn(transaction));
  (loadPartnerConfig as jest.Mock).mockResolvedValue({ connectEnabled: true });
  (StorefrontOrder.findByPk as jest.Mock).mockResolvedValue({ id: 55, publicId: 'order-55', orderSource: 'partner', paymentStatus: 'paid', stripePaymentIntentId: 'pi_55', status: 'confirmed' });
  booking = { id: 4, partnerId: 9, externalReference: 'test-reference', paymentMode: 'platform', status: 'pending_payment', paymentReceived: true, total: 100, commission: 20, refundedAmount: 0, settledAmount: 0, snapshot: { connectSplit: true }, update: jest.fn() };
  (PartnerBooking.findOne as jest.Mock).mockResolvedValue(booking);
  (PartnerAmendment.count as jest.Mock).mockResolvedValue(0);
  (PartnerPayment.findAll as jest.Mock).mockImplementation(async () => [{ id: 4, reference: 'initial', amount: 100, commission: 20, paymentIntentId: 'pi_55', transferId: booking.transferId, update: jest.fn() }]);
  (PartnerProfile.findByPk as jest.Mock).mockResolvedValue({ connectAccounts: { test: 'acct_test' } });
  stripe = { disputes: { list: jest.fn().mockResolvedValue({ data: [{ status: 'under_review' }] }) }, paymentIntents: { retrieve: jest.fn().mockResolvedValue({ status: 'succeeded', amount_received: 10000, currency: 'pln', metadata: { orderPublicId: 'order-55' }, latest_charge: { id: 'ch_55', paid: true, amount_refunded: 0, disputed: false } }) }, accounts: { retrieve: jest.fn().mockResolvedValue({ capabilities: { transfers: 'active' }, payouts_enabled: true }) }, transfers: { list: jest.fn().mockResolvedValue({ data: [] }), create: jest.fn().mockResolvedValue({ id: 'tr_55', amount: 2000, amount_reversed: 0 }), retrieve: jest.fn(), createReversal: jest.fn() } };
  (getStorefrontStripeClient as jest.Mock).mockReturnValue(stripe);
});
it('uses a verified charge and stable idempotency when splitting commission', async () => {
  await reconcilePartnerOrder(55);
  expect(stripe.transfers.create).toHaveBeenCalledWith(expect.objectContaining({ amount: 2000, destination: 'acct_test', source_transaction: 'ch_55' }), { idempotencyKey: 'partner-transfer-test-4-4' });
  expect(booking.update).toHaveBeenCalledWith(expect.objectContaining({ transferId: 'tr_55', status: 'confirmed' }), expect.anything());
});
it('never creates a payout for an unverified or mismatched payment', async () => {
  stripe.paymentIntents.retrieve.mockResolvedValue({ status: 'succeeded', amount_received: 9999, currency: 'pln', metadata: { orderPublicId: 'order-55' } });
  await expect(reconcilePartnerOrder(55)).rejects.toThrow(/does not match/);
  expect(stripe.transfers.create).not.toHaveBeenCalled();
  expect(PartnerBooking.update).toHaveBeenCalledWith(expect.objectContaining({ reconciliationError: expect.any(String) }), expect.anything());
});
it('does not use partner-reported collection as Stripe payment evidence', async () => {
  booking.paymentMode = 'partner';
  await reconcilePartnerOrder(55);
  expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
});
it('reverses only the unpaid refund adjustment and tolerates already-reversed retries', async () => {
  booking.transferId = 'tr_55';
  stripe.paymentIntents.retrieve.mockResolvedValue({ status: 'succeeded', amount_received: 10000, currency: 'pln', metadata: { orderPublicId: 'order-55' }, latest_charge: { id: 'ch_55', paid: true, amount_refunded: 5000 } });
  stripe.transfers.retrieve.mockResolvedValue({ id: 'tr_55', amount: 2000, amount_reversed: 400 });
  await reconcilePartnerOrder(55);
  expect(stripe.transfers.createReversal).toHaveBeenCalledWith('tr_55', expect.objectContaining({ amount: 600 }), { idempotencyKey: 'partner-reversal-4-1000' });
  stripe.transfers.createReversal.mockClear(); stripe.transfers.retrieve.mockResolvedValue({ id: 'tr_55', amount: 2000, amount_reversed: 1000 });
  await reconcilePartnerOrder(55);
  expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
});
it('freezes commission and reverses transfers when a charge is disputed', async () => {
  booking.transferId = 'tr_55';
  stripe.paymentIntents.retrieve.mockResolvedValue({ status: 'succeeded', amount_received: 10000, currency: 'pln', metadata: { orderPublicId: 'order-55' }, latest_charge: { id: 'ch_55', paid: true, amount_refunded: 0, disputed: true } });
  stripe.transfers.retrieve.mockResolvedValue({ id: 'tr_55', amount: 2000, amount_reversed: 0 });
  await reconcilePartnerOrder(55);
  expect(booking.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'disputed', reversedAmount: 2000 }), expect.anything());
});
it('reports net debt independently from customer payment and partial refunds', () => {
  const result = partnerStatement({ ...booking, status: 'confirmed', paymentMode: 'partner', refundedAmount: 50, settledAmount: 10 } as never);
  expect(result.partnerOwes).toBe(30);
  expect(result.commission).toBe(10);
  expect(result.transferred).toBe(0);
});
it('keeps verified customer refunds current when Stripe cannot reverse partner commission', async () => {
  booking.transferId = 'tr_55';
  stripe.paymentIntents.retrieve.mockResolvedValue({ status: 'succeeded', amount_received: 10000, currency: 'pln', metadata: { orderPublicId: 'order-55' }, latest_charge: { id: 'ch_55', paid: true, amount_refunded: 5000 } });
  stripe.transfers.retrieve.mockResolvedValue({ id: 'tr_55', amount: 2000, amount_reversed: 0 });
  stripe.transfers.createReversal.mockRejectedValue(new Error('Insufficient connected balance'));
  await reconcilePartnerOrder(55);
  expect(booking.update).toHaveBeenCalledWith(expect.objectContaining({ refundedAmount: 50, commissionEarned: 10, reversedAmount: 0, reconciliationError: expect.stringContaining('allocation failed') }), expect.anything());
});
it('accounts for a verified manual catch-up after a won dispute without paying twice', async () => {
  booking.transferId = 'tr_55'; booking.settledAmount = 20;
  stripe.transfers.retrieve.mockResolvedValue({ id: 'tr_55', amount: 2000, amount_reversed: 2000 });
  await reconcilePartnerOrder(55);
  expect(booking.update).toHaveBeenCalledWith(expect.objectContaining({ commissionEarned: 20, reconciliationError: null }), expect.anything());
  expect(partnerStatement({ ...booking, status: 'confirmed', reversedAmount: 2000 }).commissionOutstanding).toBe(0);
  expect(stripe.transfers.create).not.toHaveBeenCalled();
});
it('recognizes arrival payment only after every operational experience is recorded paid', async () => {
  booking.paymentMode = 'arrival'; booking.paymentReceived = false; booking.status = 'confirmed';
  const order = { publicId: 'order-55', orderSource: 'partner', update: jest.fn() };
  (StorefrontOrder.findByPk as jest.Mock).mockResolvedValue(order);
  (Booking.findAll as jest.Mock).mockResolvedValue([{ paymentStatus: 'paid' }, { paymentStatus: 'unpaid' }]);
  await reconcilePartnerOrder(55);
  expect(booking.update).not.toHaveBeenCalled();
  (Booking.findAll as jest.Mock).mockResolvedValue([{ paymentStatus: 'paid' }, { paymentStatus: 'paid' }]);
  await reconcilePartnerOrder(55);
  expect(booking.update).toHaveBeenCalledWith({ paymentReceived: true }, expect.anything());
  expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
});
