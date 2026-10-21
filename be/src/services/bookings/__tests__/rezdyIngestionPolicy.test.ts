jest.mock('../../../config/database.js', () => ({ __esModule: true, default: { query: jest.fn() } }));
jest.mock('../../../models/Booking.js', () => ({ __esModule: true, default: { findAll: jest.fn(), findOne: jest.fn(), findByPk: jest.fn() } }));
jest.mock('../../../models/BookingEvent.js', () => ({ __esModule: true, default: { findOne: jest.fn(), findAll: jest.fn() } }));

import Booking from '../../../models/Booking.js';
import BookingEvent from '../../../models/BookingEvent.js';
import sequelize from '../../../config/database.js';
import type { Transaction } from 'sequelize';
import type { ParsedBookingEvent } from '../types.js';
import type { RezdySource } from '../parsers/rezdyBookingParser.js';
import { applyRezdyFinancials, calculateRezdyFinancials, prepareRezdyLinkedViatorEvent, resolveRezdyBookingIdentity } from '../rezdyIngestionPolicy.js';

const transaction = {} as Transaction;
const event = (source: Partial<RezdySource> = {}): ParsedBookingEvent => ({
  platform: 'rezdy', platformBookingId: 'RTEST01', platformOrderId: 'RTEST01', status: 'confirmed', eventType: 'created',
  bookingFields: { currency: 'PLN', productName: 'Krakow Food Tour', guestFirstName: 'Taylor', guestLastName: 'Example',
    experienceStartAt: new Date('2026-10-31T13:00:00Z') },
  rawPayload: { rezdy: { orderId: 'RTEST01', agent: null, viatorReference: null, productCode: 'PTEST01', ...source } },
});
const booking = (overrides: Partial<Booking> = {}): Booking => ({ id: 12, platform: 'rezdy', platformBookingId: 'RTEST01',
  platformOrderId: 'RTEST01', priceGross: '300.00', priceNet: '240.00', baseAmount: '240.00', commissionAmount: '60.00',
  currency: 'PLN', refundedAmount: '0.00', paymentStatus: 'paid', ...overrides } as Booking);
const source = (overrides: Partial<RezdySource> = {}): RezdySource => ({
  orderId: 'RTEST01', agent: null, viatorReference: null, productCode: 'PTEST01', ...overrides,
});

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(sequelize.query).mockResolvedValue([[], {}] as never);
  jest.mocked(Booking.findAll).mockResolvedValue([]);
  jest.mocked(Booking.findOne).mockResolvedValue(null);
  jest.mocked(Booking.findByPk).mockResolvedValue(null);
  jest.mocked(BookingEvent.findOne).mockResolvedValue(null);
  jest.mocked(BookingEvent.findAll).mockResolvedValue([]);
});

describe('Rezdy gross/net/refund accounting', () => {
  it('separates customer gross, supplier commission and net base without hardcoded commission rates', () => {
    const result = calculateRezdyFinancials(booking(), source({ grossTotal: 300, commission: 60, totalPaid: 300 }), 'PLN');
    expect(result).toEqual({ patch: { priceGross: 300, priceNet: 240, baseAmount: 240, commissionAmount: 60 },
      paymentStatus: 'paid', fullyRefunded: false });
  });

  it('subtracts a cumulative partial refund once, including repeated/reprocessed snapshots', () => {
    const s = source({ refundTotal: 100, refundCurrency: 'PLN' });
    const first = calculateRezdyFinancials(booking(), s, 'PLN');
    const second = calculateRezdyFinancials(booking({ refundedAmount: '100', baseAmount: '140' }), s, 'PLN');
    expect(first.patch.baseAmount).toBe(140);
    expect(second.patch.baseAmount).toBe(140);
    expect(second.patch.refundedAmount).toBe(100);
    expect(second.paymentStatus).toBe('partial');
  });

  it('handles additional partial refunds and never reduces a recorded cumulative refund', () => {
    const b = booking({ refundedAmount: '100', baseAmount: '140' });
    expect(calculateRezdyFinancials(b, source({ refundTotal: 150 }), 'PLN').patch.baseAmount).toBe(90);
    expect(calculateRezdyFinancials(b, source({ refundTotal: 50 }), 'PLN').patch.refundedAmount).toBe(100);
  });

  it('uses the updated explicit commission in a refund snapshot, without guessing returned fees', () => {
    const result = calculateRezdyFinancials(booking(), source({ refundTotal: 100, commission: 40 }), 'PLN');
    expect(result.patch).toEqual(expect.objectContaining({ priceNet: 260, baseAmount: 160, commissionAmount: 40 }));
  });

  it('derives commission only from an explicitly reported supplier net, including cancellations', () => {
    const result = calculateRezdyFinancials(booking({ commissionAmount: null }), source({ grossTotal: 300, netTotal: 240 }), 'PLN');
    expect(result.patch).toEqual(expect.objectContaining({ commissionAmount: 60, priceNet: 240, baseAmount: 240 }));
    const mismatch = calculateRezdyFinancials(booking(), source({ grossTotal: 300, netTotal: 240, commission: 10 }), 'PLN');
    expect(mismatch.patch.baseAmount).toBe(240);
    expect(mismatch.patch.commissionAmount).toBe(10);
    expect(mismatch.reportedCommissionMismatch).toBe(true);
  });

  it('keeps explicit supplier net authoritative across refunds when displayed commission has a different basis', () => {
    const b = booking({ priceGross: '300', priceNet: '240', commissionAmount: '10' });
    expect(calculateRezdyFinancials(b, source({ refundTotal: 50 }), 'PLN').patch.baseAmount).toBe(190);
    expect(() => calculateRezdyFinancials(b, source({ grossTotal: 300, commission: 10 }), 'PLN')).toThrow('omits the explicit supplier net');
  });

  it('recognizes a full refund across all participants', () => {
    const result = calculateRezdyFinancials(booking(), source({ refundTotal: 300, refundCurrency: 'PLN' }), 'PLN');
    expect(result.patch.baseAmount).toBe(0);
    expect(result.paymentStatus).toBe('refunded');
    expect(result.fullyRefunded).toBe(true);
  });

  it('keeps known payment status when an amendment has no financial information', () => {
    expect(calculateRezdyFinancials(booking(), source(), undefined)).toEqual({ patch: {}, paymentStatus: undefined, fullyRefunded: false });
  });

  it.each([[0, 'unpaid'], [50, 'partial'], [300, 'paid']] as const)('supports Total Paid %s (%s)', (totalPaid, expected) => {
    expect(calculateRezdyFinancials(booking(), source({ totalPaid }), 'PLN').paymentStatus).toBe(expected);
  });

  it('rejects currency mismatches, over-refunds and impossible commissions', () => {
    expect(() => calculateRezdyFinancials(booking(), source({ refundTotal: 10, refundCurrency: 'EUR' }), 'PLN')).toThrow('currency mismatch');
    expect(() => calculateRezdyFinancials(booking(), source(), 'EUR')).toThrow('currency changed');
    expect(() => calculateRezdyFinancials(booking(), source({ refundTotal: 301 }), 'PLN')).toThrow('exceeds order total');
    expect(() => calculateRezdyFinancials(booking(), source({ commission: 301 }), 'PLN')).toThrow('commission exceeds');
  });

  it('deduplicates individual refunds by their stable reference, not just email ID', async () => {
    const e = event({ refundAmount: 20, refundReference: 'refund_1', refundCurrency: 'PLN' });
    jest.mocked(BookingEvent.findOne).mockResolvedValue({ eventPayload: e.rawPayload } as BookingEvent);
    await applyRezdyFinancials(booking({ refundedAmount: '20', baseAmount: '220' }), e, transaction);
    expect(e.bookingFields?.refundedAmount).toBe(20);
    expect(e.bookingFields?.baseAmount).toBe(220);
    expect(e.paymentStatus).toBe('partial');
  });

  it('adds a genuinely new individual refund to the existing cumulative total', async () => {
    const e = event({ refundAmount: 20, refundReference: 'refund_2', refundCurrency: 'PLN' });
    await applyRezdyFinancials(booking({ refundedAmount: '20' }), e, transaction);
    expect(e.bookingFields?.refundedAmount).toBe(40);
    expect(e.bookingFields?.baseAmount).toBe(200);
  });

  it('rejects reused refund references whose amounts changed', async () => {
    jest.mocked(BookingEvent.findOne).mockResolvedValue({ eventPayload: { rezdy: source({ refundAmount: 10, refundCurrency: 'PLN' }) } } as BookingEvent);
    await expect(applyRezdyFinancials(booking(), event({ refundAmount: 20, refundReference: 'same', refundCurrency: 'PLN' }), transaction))
      .rejects.toThrow('reused');
  });

  it('promotes full refunds to cancelled only when the customer total has actually been refunded', async () => {
    const e = event({ refundTotal: 300, refundCurrency: 'PLN' });
    await applyRezdyFinancials(booking(), e, transaction);
    expect(e).toEqual(expect.objectContaining({ status: 'cancelled', eventType: 'cancelled', paymentStatus: 'refunded' }));
    const cancellation = { ...event(), status: 'cancelled', eventType: 'cancelled' } as ParsedBookingEvent;
    await applyRezdyFinancials(booking(), cancellation, transaction);
    expect(cancellation.paymentStatus).toBeUndefined();
    expect(cancellation.bookingFields?.refundedAmount).toBeUndefined();
  });
});

describe('Rezdy/Viator identity safety', () => {
  it('links an explicit Viator reference to the existing booking and retains the Rezdy order reference', async () => {
    const existing = booking({ platform: 'viator', platformBookingId: 'BR-1234567890', platformOrderId: 'BR-1234567890', channelId: 2 });
    jest.mocked(Booking.findOne).mockResolvedValue(existing);
    const e = event({ agent: 'viator', viatorReference: 'BR-1234567890' });
    expect(await resolveRezdyBookingIdentity(e, transaction)).toBe(existing);
    expect(e).toEqual(expect.objectContaining({ platform: 'viator', platformBookingId: 'BR-1234567890', platformOrderId: 'RTEST01' }));
    expect(e.bookingFields?.channelId).toBe(2);
  });

  it('uses an explicit agent reference as the canonical ID even if Rezdy arrives first', async () => {
    const e = event({ agent: 'viator', viatorReference: 'BR-1234567890' });
    expect(await resolveRezdyBookingIdentity(e, transaction)).toBeNull();
    expect(e.platformBookingId).toBe('BR-1234567890');
    expect(e.platform).toBe('viator');
  });

  it('matches later order-only cancellations/refunds to the saved R reference', async () => {
    const existing = booking({ platform: 'viator', platformBookingId: 'BR-1234567890' });
    jest.mocked(Booking.findAll).mockResolvedValueOnce([existing]);
    const e = event(); e.eventType = 'cancelled'; e.status = 'cancelled';
    expect(await resolveRezdyBookingIdentity(e, transaction)).toBe(existing);
    expect(e.platformBookingId).toBe('BR-1234567890');
  });

  it('does not create orphan refund/cancellation/amendment records', async () => {
    const e = event(); e.eventType = 'amended';
    await expect(resolveRezdyBookingIdentity(e, transaction)).rejects.toThrow('Original Rezdy booking not found');
  });

  it('rejects ambiguous linked orders and inconsistent explicit identities', async () => {
    jest.mocked(Booking.findAll).mockResolvedValueOnce([booking(), booking({ id: 13 })]);
    await expect(resolveRezdyBookingIdentity(event(), transaction)).rejects.toThrow('multiple bookings');
    jest.mocked(Booking.findAll).mockResolvedValueOnce([booking()]);
    jest.mocked(Booking.findOne).mockResolvedValueOnce(booking({ id: 13 }));
    await expect(resolveRezdyBookingIdentity(event({ viatorReference: 'BR-1234567890' }), transaction)).rejects.toThrow('different bookings');
  });

  it('flags a possible same-person/departure/product duplicate instead of merging by name', async () => {
    jest.mocked(Booking.findAll).mockResolvedValueOnce([]).mockResolvedValueOnce([booking({ productName: 'Food Tour Krakow' })]);
    await expect(resolveRezdyBookingIdentity(event({ agent: 'viator' }), transaction)).rejects.toThrow('Possible Rezdy/Viator duplicate');
  });

  it('blocks a matching direct Viator email without an explicit link to an already imported agent order', async () => {
    jest.mocked(Booking.findAll).mockResolvedValueOnce([booking({ productName: 'Food Tour Krakow' })]);
    jest.mocked(BookingEvent.findOne).mockResolvedValueOnce({} as BookingEvent);
    const e = event(); e.platform = 'viator'; e.rawPayload = null;
    await expect(resolveRezdyBookingIdentity(e, transaction)).rejects.toThrow('Possible Rezdy/Viator duplicate');
  });

  it('does not treat an unrelated product as a duplicate', async () => {
    jest.mocked(Booking.findAll).mockResolvedValueOnce([]).mockResolvedValueOnce([booking({ productName: 'Pub Crawl' })]);
    await expect(resolveRezdyBookingIdentity(event({ agent: 'viator' }), transaction)).resolves.toBeNull();
  });

  it('uses an explicit reference learned after an online Rezdy order arrived first', async () => {
    const existing = booking({ channelId: 16 });
    jest.mocked(BookingEvent.findAll).mockResolvedValue([{ bookingId: 12 }] as BookingEvent[]);
    jest.mocked(Booking.findByPk).mockResolvedValue(existing);
    const e = event(); e.platform = 'viator'; e.platformBookingId = 'BR-1234567890'; e.rawPayload = null;
    expect(await resolveRezdyBookingIdentity(e, transaction)).toBe(existing);
    expect(e.bookingFields?.channelId).toBe(16);
  });

  it('surfaces invalid operational emails as ingestion failures before any mutation', async () => {
    await expect(resolveRezdyBookingIdentity(event({ validationError: 'Missing departure' }), transaction)).rejects.toThrow('Missing departure');
    expect(sequelize.query).not.toHaveBeenCalled();
  });
});

describe('protecting a Rezdy-linked order from incompatible Viator money', () => {
  const viator = (): ParsedBookingEvent => ({ platform: 'viator', platformBookingId: 'BR-1234567890',
    eventType: 'created', status: 'confirmed', paymentStatus: 'paid', bookingFields: { priceNet: 240, priceGross: 240, baseAmount: 240 } });
  it('treats a second confirmation as an audited no-op, preserving refunds and attendance', () => {
    expect(prepareRezdyLinkedViatorEvent(booking(), viator())).toBe(true);
  });
  it('records a cancellation without falsely applying supplier-net refund money to a customer-gross ledger', () => {
    const e = viator(); e.eventType = 'cancelled'; e.status = 'cancelled';
    e.bookingFields!.refundedAmount = 240;
    expect(prepareRezdyLinkedViatorEvent(booking(), e)).toBe(false);
    expect(e.bookingFields).toEqual({});
    expect(e.paymentStatus).toBeUndefined();
    expect(e.notes).toContain('financial amounts await');
  });
  it('requires manual review for an incompatible financial amendment', () => {
    const e = viator(); e.eventType = 'amended';
    expect(() => prepareRezdyLinkedViatorEvent(booking(), e)).toThrow('supplier-net and customer-gross');
  });
});
