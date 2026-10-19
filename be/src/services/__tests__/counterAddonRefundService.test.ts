jest.mock('../../models/Booking.js', () => ({ __esModule: true, default: {
  findByPk: jest.fn(), findAll: jest.fn(), sequelize: { transaction: jest.fn(), query: jest.fn() },
} }));
jest.mock('../../models/BookingEvent.js', () => ({ __esModule: true, default: { findAll: jest.fn(), build: jest.fn() } }));

import type Stripe from 'stripe';
import Booking from '../../models/Booking.js';
import BookingEvent from '../../models/BookingEvent.js';
import { parseCounterRefundExtras, runCounterAddonRefund, type CounterRefundPayment } from '../counterAddonRefundService.js';

const stripeRefund = (id: string, amount: number, status = 'succeeded', metadata: Record<string, string> = {}) => ({
  id, amount, status, currency: 'pln', created: 1800000000, metadata, payment_intent: 'pi_booking',
}) as Stripe.Refund;
const extras = { cocktails: 2, photos: 0, tshirts: 0 };
const expectedExtras = { cocktails: 3, photos: 0, tshirts: 0 };
const transaction = { LOCK: { UPDATE: 'UPDATE' } };
let booking: Booking;
let addon: { id: number; quantity: number; totalPrice: string; save: jest.Mock };
let refunds: Stripe.Refund[];
let ledger: Array<{ bookingId?: number; eventPayload: Record<string, unknown> | null }>;
let client: { refunds: { list: jest.Mock; create: jest.Mock } };
let resolvePayment: jest.Mock<Promise<CounterRefundPayment>, [Booking]>;

beforeEach(() => {
  jest.clearAllMocks();
  addon = { id: 71, quantity: 3, totalPrice: '120.00', save: jest.fn().mockResolvedValue(undefined) };
  booking = {
    id: 21, platform: 'omnilodge', platformOrderId: 'order-21', platformBookingId: 'order-21-1', status: 'confirmed',
    partySizeTotal: 3, attendedTotal: 3, attendedAddonsSnapshot: { cocktails: 1 },
    addonsSnapshot: { extras: { ...expectedExtras } }, addonsAmount: '120.00',
    priceNet: '300.00', baseAmount: '300.00', refundedAmount: '0.00', save: jest.fn().mockResolvedValue(undefined),
  } as unknown as Booking;
  refunds = [];
  ledger = [];
  client = { refunds: { list: jest.fn().mockImplementation(async () => ({ data: refunds, has_more: false })), create: jest.fn() } };
  client.refunds.create.mockImplementation(async (request) => {
    const refund = stripeRefund('re_new', request.amount, 'succeeded', request.metadata);
    refunds.push(refund);
    return refund;
  });
  resolvePayment = jest.fn(async () => ({
    stripeClient: client as unknown as Stripe, transactionId: 'pi_booking', transactionType: 'payment_intent',
    currency: 'pln', paidAmount: 30000, bookingAmount: 30000,
    lines: [{ addon: addon as never, key: 'cocktails', name: 'Cocktails', quantity: addon.quantity, unitAmount: 4000, currency: 'PLN' }],
  }));
  (Booking.findByPk as jest.Mock).mockImplementation(async () => booking);
  (Booking.findAll as jest.Mock).mockImplementation(async () => [booking]);
  (Booking.sequelize!.transaction as jest.Mock).mockImplementation(async (callback) => callback(transaction));
  (BookingEvent.findAll as jest.Mock).mockImplementation(async () => ledger);
  (BookingEvent.build as jest.Mock).mockImplementation(() => {
    const event = { eventPayload: null, save: jest.fn(async () => { ledger.push(event); }) };
    return event;
  });
});

const run = (operation: 'verify' | 'refund' | 'rectify', selectionKey?: string) => runCounterAddonRefund({
  bookingId: 21, actorId: 6, operation, extras, expectedExtras, selectionKey, resolvePayment,
});

describe('Stripe add-on verification', () => {
  it('reads Stripe without issuing money or changing attendance/bookings', async () => {
    const result = await run('verify');
    expect(result.verification.status).toBe('clear');
    expect(client.refunds.list).toHaveBeenCalledWith({ payment_intent: 'pi_booking', limit: 100 });
    expect(client.refunds.create).not.toHaveBeenCalled();
    expect(booking.save).not.toHaveBeenCalled();
    expect(addon.save).not.toHaveBeenCalled();
  });

  it.each([[8000, 'verified'], [10000, 'verified'], [7999, 'insufficient'], [30000, 'full_refund']])(
    'classifies a %i minor-unit refund as %s for 80 PLN add-ons and a 300 PLN booking', async (amount, status) => {
      refunds = [stripeRefund('re_existing', Number(amount))];
      const result = await run('verify');
      expect(result.verification.status).toBe(status);
      expect(result.verification.amount).toBe(8000);
    },
  );

  it.each(['failed', 'canceled'])('does not treat a %s refund as paid', async (status) => {
    refunds = [stripeRefund('re_failed', 8000, status)];
    expect((await run('verify')).verification.status).toBe('clear');
  });

  it.each(['pending', 'requires_action', null])('blocks refunds already submitted with status %s', async (status) => {
    refunds = [stripeRefund('re_pending', 8000, status as string)];
    expect((await run('verify')).verification.status).toBe('pending');
  });

  it('paginates beyond the first 100 Stripe refunds instead of assuming no match', async () => {
    client.refunds.list.mockResolvedValueOnce({ data: [stripeRefund('re_old', 100, 'failed')], has_more: true })
      .mockResolvedValueOnce({ data: [stripeRefund('re_existing', 8000)], has_more: false });
    expect((await run('verify')).verification.status).toBe('verified');
    expect(client.refunds.list.mock.calls[1][0].starting_after).toBe('re_old');
  });

  it('blocks an incomplete refund history instead of displaying a clear verification', async () => {
    client.refunds.list.mockResolvedValue({ data: [], has_more: true });
    await expect(run('verify')).rejects.toMatchObject({ status: 502 });
    expect(client.refunds.create).not.toHaveBeenCalled();
  });

  it('does not reuse refunds already applied to people or other add-ons', async () => {
    refunds = [stripeRefund('re_people', 8000)];
    ledger = [{ eventPayload: { stripeRefundId: 're_people', action: 'partial-refund', peopleQuantity: 1 } }];
    expect((await run('verify')).verification.status).toBe('clear');
  });

  it('does not allocate the same refund credit twice', async () => {
    refunds = [stripeRefund('re_existing', 10000)];
    ledger = [{ eventPayload: { stripeRefundAllocations: [{ refundId: 're_existing', amount: 8000 }] } }];
    const result = await run('verify');
    expect(result.verification.availableRefundAmount).toBe(2000);
    expect(result.verification.status).toBe('insufficient');
  });

  it('recognizes an amount-only manual refund whose money was recorded but add-ons were not removed', async () => {
    refunds = [stripeRefund('re_manual', 8000)];
    ledger = [{ eventPayload: { stripeRefundId: 're_manual', peopleQuantity: 0, addons: [], manualAmount: 80 } }];
    booking.refundedAmount = '80.00';
    const verification = (await run('verify')).verification;
    expect(verification.status).toBe('verified');
    await run('rectify', verification.selectionKey);
    expect(booking.refundedAmount).toBe('80.00');
    expect(addon.quantity).toBe(1);
  });

  it('subtracts itemised add-on refunds already applied by the manifest', async () => {
    refunds = [stripeRefund('re_itemised', 10000)];
    ledger = [{ eventPayload: { stripeRefundId: 're_itemised', peopleQuantity: 0,
      addons: [{ refundedQty: 2, amount: 80 }] } }];
    const verification = (await run('verify')).verification;
    expect(verification.availableRefundAmount).toBe(2000);
    expect(verification.status).toBe('insufficient');
  });

  it('combines successful partial refunds without counting duplicated pagination entries twice', async () => {
    client.refunds.list.mockResolvedValueOnce({ data: [stripeRefund('re_a', 5000)], has_more: true })
      .mockResolvedValueOnce({ data: [stripeRefund('re_a', 5000), stripeRefund('re_b', 3000)], has_more: false });
    const result = await run('verify');
    expect(result.verification.status).toBe('verified');
    expect(result.verification.availableRefundAmount).toBe(8000);
  });

  it('requires manual review for an unassigned refund on a multi-booking payment', async () => {
    refunds = [stripeRefund('re_ambiguous', 8000)];
    (Booking.findAll as jest.Mock).mockResolvedValue([booking, { id: 22 }]);
    expect((await run('verify')).verification.status).toBe('manual_review');
  });

  it('ignores a refund explicitly belonging to another booking on the payment', async () => {
    refunds = [stripeRefund('re_other', 8000, 'succeeded', { bookingId: '22' })];
    (Booking.findAll as jest.Mock).mockResolvedValue([booking, { id: 22 }]);
    expect((await run('verify')).verification.status).toBe('clear');
  });

  it('keeps another booking\'s recorded refund out of this booking\'s money totals on a shared payment', async () => {
    refunds = [stripeRefund('re_other_recorded', 8000)];
    ledger = [{ bookingId: 22, eventPayload: { stripeRefundId: 're_other_recorded', peopleQuantity: 1 } }];
    (Booking.findAll as jest.Mock).mockResolvedValue([booking, { id: 22 }]);
    const verification = (await run('verify')).verification;
    expect(verification.status).toBe('clear');
    expect(verification.refundedAmount).toBe(0);
    await run('refund', verification.selectionKey);
    expect(booking.refundedAmount).toBe('80.00');
  });
});

describe('refund and booking rectification safeguards', () => {
  it('rectifies only add-ons, records Stripe allocations and preserves all people/attendance', async () => {
    refunds = [stripeRefund('re_existing', 10000)];
    booking.refundedAmount = '100.00'; // Already imported from Stripe: must not double count it.
    booking.addonRefundActions = [{ id: 'task-1', addonKey: 'cocktails', quantity: 2, status: 'pending' }];
    const verification = (await run('verify')).verification;
    const result = await run('rectify', verification.selectionKey);
    expect(result.applied).toBe(true);
    expect(client.refunds.create).not.toHaveBeenCalled();
    expect(addon.quantity).toBe(1);
    expect(booking.addonsSnapshot).toEqual({ extras: { cocktails: 1, photos: 0, tshirts: 0 } });
    expect(booking.partySizeTotal).toBe(3);
    expect(booking.attendedTotal).toBe(3);
    expect(booking.attendedAddonsSnapshot).toEqual({ cocktails: 1 });
    expect(booking.refundedAmount).toBe('100.00');
    expect(booking.baseAmount).toBe('200.00');
    expect(booking.addonRefundActions?.[0]).toMatchObject({ status: 'completed', completedSource: 'stripe_verified' });
    expect(ledger[0].eventPayload).toMatchObject({ actorId: 6, action: 'counter-addon-refund-rectified', stripeRefundAllocations: [{ refundId: 're_existing', amount: 8000 }] });
  });

  it('rejects repeated/stale rectification instead of removing add-ons twice', async () => {
    refunds = [stripeRefund('re_existing', 8000)];
    const verification = (await run('verify')).verification;
    await run('rectify', verification.selectionKey);
    await expect(run('rectify', verification.selectionKey)).rejects.toMatchObject({ status: 409 });
    expect(addon.save).toHaveBeenCalledTimes(1);
    expect(client.refunds.create).not.toHaveBeenCalled();
  });

  it('rechecks Stripe when issuing money even if the preview previously said clear', async () => {
    const verification = (await run('verify')).verification;
    refunds = [stripeRefund('re_arrived_after_preview', 8000)];
    await expect(run('refund', verification.selectionKey)).rejects.toMatchObject({ status: 409, details: { verification: { status: 'verified' } } });
    expect(client.refunds.create).not.toHaveBeenCalled();
    expect(booking.save).not.toHaveBeenCalled();
  });

  it('uses the server-calculated amount, stable Stripe idempotency and a serialized order lock', async () => {
    const verification = (await run('verify')).verification;
    const result = await run('refund', verification.selectionKey);
    expect(result.applied).toBe(true);
    expect(client.refunds.create).toHaveBeenCalledWith(expect.objectContaining({ payment_intent: 'pi_booking', amount: 8000 }),
      { idempotencyKey: expect.stringMatching(/^counter-addons-21-[a-f0-9]{64}$/) });
    expect(Booking.sequelize!.query).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_xact_lock'), expect.objectContaining({ transaction }));
    expect(Booking.findByPk).toHaveBeenCalledWith(21, { transaction, lock: 'UPDATE' });
    expect(booking.refundedAmount).toBe('80.00');
  });

  it('does not rectify or send email-worthy success while a newly submitted refund is pending', async () => {
    client.refunds.create.mockResolvedValue(stripeRefund('re_pending', 8000, 'pending', { bookingId: '21' }));
    const verification = (await run('verify')).verification;
    const result = await run('refund', verification.selectionKey);
    expect(result).toMatchObject({ applied: false, verification: { status: 'pending' } });
    expect(booking.save).not.toHaveBeenCalled();
    expect(addon.save).not.toHaveBeenCalled();
    expect(ledger[0].eventPayload?.action).toBe('counter-addon-refund-submitted');
  });

  it('rectifies a previously submitted pending refund once Stripe reports success', async () => {
    client.refunds.create.mockResolvedValue(stripeRefund('re_pending', 8000, 'pending', { bookingId: '21' }));
    const verification = (await run('verify')).verification;
    await run('refund', verification.selectionKey);
    refunds = [stripeRefund('re_pending', 8000, 'succeeded', { bookingId: '21' })];
    const confirmed = (await run('verify')).verification;
    expect(confirmed.status).toBe('verified');
    await expect(run('rectify', confirmed.selectionKey)).resolves.toMatchObject({ applied: true });
    expect(client.refunds.create).toHaveBeenCalledTimes(1);
    expect(addon.quantity).toBe(1);
  });

  it('fails closed when Stripe is unavailable', async () => {
    const verification = (await run('verify')).verification;
    client.refunds.list.mockRejectedValue(new Error('Stripe unavailable'));
    await expect(run('refund', verification.selectionKey)).rejects.toThrow('Stripe unavailable');
    expect(client.refunds.create).not.toHaveBeenCalled();
    expect(booking.save).not.toHaveBeenCalled();
  });

  it('recovers a Stripe success followed by a database failure through rectification, without refunding twice', async () => {
    const verification = (await run('verify')).verification;
    (booking.save as jest.Mock).mockRejectedValueOnce(new Error('Database commit failed'));
    await expect(run('refund', verification.selectionKey)).rejects.toThrow('Database commit failed');
    // Simulate the database transaction rollback while the external Stripe refund remains real.
    addon.quantity = 3;
    addon.totalPrice = '120.00';
    booking.addonsSnapshot = { extras: { ...expectedExtras } };
    booking.refundedAmount = '0.00';
    booking.baseAmount = '300.00';
    booking.addonsAmount = '120.00';
    await expect(run('refund', verification.selectionKey)).rejects.toMatchObject({ status: 409 });
    expect(client.refunds.create).toHaveBeenCalledTimes(1);
    await expect(run('rectify', verification.selectionKey)).resolves.toMatchObject({ applied: true });
    expect(client.refunds.create).toHaveBeenCalledTimes(1);
    expect(addon.quantity).toBe(1);
  });

  it('rejects changed quantities and mismatched selection keys', async () => {
    const verification = (await run('verify')).verification;
    await expect(run('refund', 'forged-key')).rejects.toMatchObject({ status: 409 });
    (booking.addonsSnapshot as { extras: typeof expectedExtras }).extras.cocktails = 2;
    await expect(run('refund', verification.selectionKey)).rejects.toMatchObject({ status: 409 });
    expect(client.refunds.create).not.toHaveBeenCalled();
  });

  it('blocks inconsistent historical add-on rows instead of deducting the wrong quantity', async () => {
    addon.quantity = 4;
    await expect(run('verify')).rejects.toMatchObject({ status: 409 });
    expect(client.refunds.create).not.toHaveBeenCalled();
    expect(addon.save).not.toHaveBeenCalled();
  });

  it('rejects people, custom keys, fractional counts and empty requests', () => {
    for (const input of [{ people: 1 }, { cocktails: -1 }, { photos: 1.5 }, {}]) {
      expect(() => parseCounterRefundExtras(input)).toThrow();
    }
  });

  it('rejects mixed-currency evidence before any financial mutation', async () => {
    refunds = [{ ...stripeRefund('re_bad_currency', 8000), currency: 'eur' }];
    await expect(run('verify')).rejects.toMatchObject({ status: 502 });
    expect(client.refunds.create).not.toHaveBeenCalled();
  });
});
