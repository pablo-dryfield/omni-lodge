jest.mock('../../../config/database.js', () => ({ __esModule: true, default: { transaction: jest.fn(), query: jest.fn() } }));
jest.mock('../../configService.js', () => ({ getConfigValue: jest.fn(() => null) }));
jest.mock('../../../models/Booking.js', () => ({ __esModule: true, default: { findOne: jest.fn(), findAll: jest.fn(), build: jest.fn() } }));
jest.mock('../../../models/BookingEvent.js', () => ({ __esModule: true, default: { findOne: jest.fn(), findAll: jest.fn(), build: jest.fn(), create: jest.fn() } }));
jest.mock('../../../models/BookingAddon.js', () => ({ __esModule: true, default: { destroy: jest.fn(), build: jest.fn() } }));
jest.mock('../bookingReassignmentRulesService.js', () => ({ applyAutomaticBookingReassignmentRules: jest.fn(async (_booking, patch) => ({ patch })) }));
jest.mock('../parsers/index.js', () => ({ getBookingParsers: jest.fn(() => []) }));

import sequelize from '../../../config/database.js';
import Booking from '../../../models/Booking.js';
import BookingEmail from '../../../models/BookingEmail.js';
import BookingEvent from '../../../models/BookingEvent.js';
import BookingAddon from '../../../models/BookingAddon.js';
import Product from '../../../models/Product.js';
import AuditLog from '../../../models/AuditLog.js';
import { getBookingParsers } from '../parsers/index.js';
import { applyAutomaticBookingReassignmentRules } from '../bookingReassignmentRulesService.js';
import { applyParsedEvent, reprocessProductBookingEmail } from '../bookingIngestionService.js';
import type { ParsedBookingEvent } from '../types.js';
import type { RezdySource } from '../parsers/rezdyBookingParser.js';

const email = { id: 5, messageId: 'rezdy-ingestion-test', receivedAt: new Date('2026-10-20T12:00:00Z') } as BookingEmail;
const incoming = (overrides: Partial<RezdySource> = {}): ParsedBookingEvent => ({
  platform: 'rezdy', platformBookingId: 'RTEST01', platformOrderId: 'RTEST01',
  status: 'amended', eventType: 'amended', occurredAt: new Date('2026-10-20T12:00:00Z'),
  bookingFields: { productId: 48, currency: 'PLN' }, rawPayload: { rezdy: {
    orderId: 'RTEST01', agent: null, viatorReference: null, productCode: 'PTEST01', ...overrides,
  } },
});
let record: Booking;
let events: BookingEvent[];

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(applyAutomaticBookingReassignmentRules).mockReset().mockImplementation(async (_booking, patch) => ({ patch }) as any);
  events = [];
  record = {
    id: 12, platform: 'rezdy', platformBookingId: 'RTEST01', platformOrderId: 'RTEST01',
    productId: 48, productName: 'Food Tour Krakow', channelId: 16, status: 'confirmed', paymentStatus: 'paid',
    statusChangedAt: new Date('2026-10-19T10:00:00Z'), createdAt: new Date('2026-10-18T10:00:00Z'),
    priceGross: '300.00', priceNet: '240.00', commissionAmount: '60.00', baseAmount: '240.00',
    refundedAmount: '0.00', currency: 'PLN', attendedTotal: 2, addonsSnapshot: null,
    set: jest.fn((patch) => Object.assign(record, patch)), save: jest.fn(async () => record),
    getDataValue: jest.fn((key) => record[key as keyof Booking]),
    setDataValue: jest.fn((key, value) => { (record as unknown as Record<string, unknown>)[key] = value; }),
  } as unknown as Booking;
  jest.mocked(sequelize.transaction).mockImplementation(async (callback: any) => callback({}) as any);
  jest.mocked(sequelize.query).mockResolvedValue([[], {}] as never);
  jest.mocked(Booking.findAll).mockImplementation(async () => [record]);
  jest.mocked(Booking.findOne).mockImplementation(async () => record);
  jest.mocked(BookingEvent.findAll).mockImplementation(async () => events);
  jest.mocked(BookingEvent.findOne).mockImplementation(async (options: any) => {
    const w = options.where;
    return events.find((entry) => w.emailMessageId ? entry.emailMessageId === w.emailMessageId
      : w['eventPayload.rezdy.refundReference'] ? (entry.eventPayload?.rezdy as RezdySource)?.refundReference === w['eventPayload.rezdy.refundReference'] : false) ?? null;
  });
  const createEvent = (values: any) => {
    const entry = { id: events.length + 1, ...values,
      save: jest.fn(async () => { if (!events.includes(entry)) events.push(entry); return entry; }),
      destroy: jest.fn(async () => { events = events.filter((x) => x !== entry); }),
    } as BookingEvent;
    return entry;
  };
  jest.mocked(BookingEvent.build).mockImplementation(createEvent as any);
  jest.mocked(BookingEvent.create).mockImplementation(async (values: any) => {
    const entry = createEvent(values); await entry.save(); return entry;
  });
  jest.mocked(BookingAddon.destroy).mockResolvedValue(0);
  jest.mocked(BookingAddon.build).mockImplementation((values: any) => ({ ...values, save: jest.fn(async () => undefined) }) as any);
});

describe('Rezdy events through the booking ingestion transaction', () => {
  it('reuses the caller transaction and rejects a cross-product reassignment before saving', async () => {
    const tx = { LOCK: { SHARE: 'share' } } as any;
    const product = jest.spyOn(Product, 'findByPk').mockImplementation(async (id) => ({ productTypeId: id === 48 ? 3 : 1 }) as Product);
    jest.mocked(applyAutomaticBookingReassignmentRules).mockResolvedValueOnce({ patch: { productId: 1 } } as any);
    try {
      await expect(applyParsedEvent(email, incoming(), { isReprocess: true, transaction: tx, productAccess: { bookingIds: [12], productTypeIds: [3] } })).rejects.toMatchObject({ status: 403 });
      expect(record.save).not.toHaveBeenCalled();
      expect(sequelize.transaction).not.toHaveBeenCalled();
    } finally { product.mockRestore(); }
  });

  it('replays all parsed events in a single transaction and records the actor', async () => {
    const tx = { LOCK: { UPDATE: 'update', SHARE: 'share' } } as any;
    jest.mocked(sequelize.transaction).mockImplementation(async (cb: any) => cb(tx));
    const saved = { ...email, rawPayload: JSON.stringify({ payload: { mimeType: 'text/plain', body: { data: Buffer.from('saved original').toString('base64url') } } }), headers: {}, update: jest.fn() } as unknown as BookingEmail;
    const emailFind = jest.spyOn(BookingEmail, 'findOne').mockResolvedValue(saved);
    const product = jest.spyOn(Product, 'findByPk').mockResolvedValue({ productTypeId: 3 } as Product);
    const audit = jest.spyOn(AuditLog, 'create').mockResolvedValue({} as AuditLog);
    const parsed = incoming(); parsed.spawnedEvents = [incoming()];
    jest.mocked(getBookingParsers).mockReturnValue([{ name: 'test', canParse: () => true, parse: async () => parsed }]);
    try {
      await expect(reprocessProductBookingEmail(email.messageId, [3], 215)).resolves.toBe('processed');
      expect(sequelize.transaction).toHaveBeenCalledTimes(1);
      expect(record.save).toHaveBeenCalledTimes(2);
      for (const call of jest.mocked(record.save).mock.calls) expect(call[0]).toMatchObject({ transaction: tx });
      expect(audit).toHaveBeenCalledWith(expect.objectContaining({ actorId: 215, action: 'product_scope.booking_email_reprocessed' }), { transaction: tx });
    } finally { emailFind.mockRestore(); product.mockRestore(); audit.mockRestore(); }
  });

  it('does not delete bookings or mark success when the saved email no longer parses', async () => {
    const saved = { ...email, rawPayload: '{}', update: jest.fn() } as unknown as BookingEmail;
    const emailFind = jest.spyOn(BookingEmail, 'findOne').mockResolvedValue(saved);
    const product = jest.spyOn(Product, 'findByPk').mockResolvedValue({ productTypeId: 3 } as Product);
    jest.mocked(sequelize.transaction).mockImplementation(async (cb: any) => cb({ LOCK: { UPDATE: 'update', SHARE: 'share' } }));
    jest.mocked(getBookingParsers).mockReturnValue([]);
    try {
      await expect(reprocessProductBookingEmail(email.messageId, [3], 215)).rejects.toMatchObject({ status: 409 });
      expect(record.save).not.toHaveBeenCalled();
      expect(BookingAddon.destroy).not.toHaveBeenCalled();
      expect(saved.update).not.toHaveBeenCalled();
    } finally { emailFind.mockRestore(); product.mockRestore(); }
  });
  it('retains one cumulative refund, one event and the correct net amount when the same email is reprocessed', async () => {
    await applyParsedEvent(email, incoming({ refundTotal: 100, refundCurrency: 'PLN' }));
    expect(record.baseAmount).toBe('140.00');
    expect(record.refundedAmount).toBe('100.00');
    expect(record.status).toBe('amended');
    expect(record.paymentStatus).toBe('partial');
    await applyParsedEvent(email, incoming({ refundTotal: 100, refundCurrency: 'PLN' }), { isReprocess: true });
    expect(record.baseAmount).toBe('140.00');
    expect(record.refundedAmount).toBe('100.00');
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('replayed');
    expect(record.attendedTotal).toBe(2);
  });

  it('does not double a delta refund when a different email repeats the same refund reference', async () => {
    await applyParsedEvent(email, incoming({ refundAmount: 20, refundReference: 'refund_1', refundCurrency: 'PLN' }));
    await applyParsedEvent({ ...email, messageId: 'second-delivery' } as BookingEmail,
      incoming({ refundAmount: 20, refundReference: 'refund_1', refundCurrency: 'PLN' }));
    expect(record.refundedAmount).toBe('20.00');
    expect(record.baseAmount).toBe('220.00');
  });

  it('fully refunds/cancels the booking without deleting its attendee history', async () => {
    await applyParsedEvent(email, incoming({ refundTotal: 300, refundCurrency: 'PLN' }));
    expect(record.status).toBe('cancelled');
    expect(record.paymentStatus).toBe('refunded');
    expect(record.baseAmount).toBe('0.00');
    expect(record.attendedTotal).toBe(2);
  });

  it('cancels without treating a retained Total Paid as proof of refund', async () => {
    const e = incoming({ grossTotal: 300, totalPaid: 300 }); e.status = 'cancelled'; e.eventType = 'cancelled';
    await applyParsedEvent(email, e);
    expect(record.status).toBe('cancelled');
    expect(record.refundedAmount).toBe('0.00');
    expect(record.paymentStatus).toBe('paid');
  });

  it('keeps a paid status for date/participant amendments with no payment fields', async () => {
    const e = incoming(); e.bookingFields!.partySizeTotal = 4;
    e.bookingFields!.experienceDate = '2026-11-01';
    await applyParsedEvent(email, e);
    expect(record.partySizeTotal).toBe(4);
    expect(record.experienceDate).toBe('2026-11-01');
    expect(record.paymentStatus).toBe('paid');
  });

  it('retains manager notes when adding Rezdy ingestion notes', async () => {
    record.notes = 'Manager correction retained';
    const e = incoming(); e.notes = 'Parsed from Rezdy order RTEST01.';
    await applyParsedEvent(email, e);
    expect(record.notes).toContain('Manager correction retained');
    expect(record.notes).toContain('Parsed from Rezdy');
  });

  it('does not let an older confirmation revive a cancelled/refunded booking or erase attendance', async () => {
    record.status = 'cancelled'; record.paymentStatus = 'refunded'; record.refundedAmount = '300.00'; record.baseAmount = '0.00';
    const e = incoming({ grossTotal: 300, totalPaid: 300 });
    e.eventType = 'created'; e.status = 'confirmed'; e.occurredAt = new Date('2026-10-18T11:00:00Z');
    await applyParsedEvent(email, e);
    expect(record.save).not.toHaveBeenCalled();
    expect(record.status).toBe('cancelled');
    expect(record.attendedTotal).toBe(2);
    expect(events[0].eventPayload?.rezdySnapshotSkipped).toBe('older_than_current_booking');
  });

  it('retains the R order ID when a linked direct Viator confirmation is reprocessed', async () => {
    record.platform = 'viator'; record.platformBookingId = 'BR-1234567890';
    const e: ParsedBookingEvent = { platform: 'viator', platformBookingId: 'BR-1234567890', platformOrderId: 'BR-1234567890',
      status: 'confirmed', eventType: 'created', paymentStatus: 'paid', occurredAt: email.receivedAt };
    events.push({ id: 99, bookingId: 12, emailMessageId: email.messageId } as BookingEvent);
    await applyParsedEvent(email, e, { isReprocess: true });
    expect(record.platformOrderId).toBe('RTEST01');
    expect(record.save).not.toHaveBeenCalled();
    expect(Booking.build).not.toHaveBeenCalled();
  });

  it('does not silently drop an unrecorded refund delivered after a newer booking amendment', async () => {
    const e = incoming({ refundTotal: 50, refundCurrency: 'PLN' });
    e.occurredAt = new Date('2026-10-18T12:00:00Z');
    await expect(applyParsedEvent(email, e)).rejects.toThrow('Use refund-only reprocessing');
    expect(record.save).not.toHaveBeenCalled();
    await applyParsedEvent(email, e, { scopedHints: ['refund'] });
    expect(record.refundedAmount).toBe('50.00');
    expect(record.baseAmount).toBe('190.00');
    expect(record.status).toBe('confirmed');
  });

  it('retains an explicit R/BR link from an older snapshot without overwriting money or attendance', async () => {
    record.platform = 'viator'; record.platformBookingId = record.platformOrderId = 'BR-1234567890';
    const e = incoming({ agent: 'viator', viatorReference: 'BR-1234567890', grossTotal: 300, totalPaid: 300 });
    e.eventType = 'created'; e.occurredAt = new Date('2026-10-18T12:00:00Z');
    await applyParsedEvent(email, e);
    expect(record.platformOrderId).toBe('RTEST01');
    expect(record.save).toHaveBeenCalledWith(expect.objectContaining({ fields: ['platformOrderId'] }));
    expect(record.baseAmount).toBe('240.00');
    expect(record.attendedTotal).toBe(2);
  });

  it('applies only refund data in scoped replay, not the old gross or commission', async () => {
    record.priceGross = '500.00'; record.commissionAmount = '100.00'; record.priceNet = '400.00';
    await applyParsedEvent(email, incoming({ grossTotal: 300, commission: 60, totalPaid: 300, refundTotal: 50, refundCurrency: 'PLN' }), { scopedHints: ['refund'] });
    expect(record.priceGross).toBe('500.00');
    expect(record.baseAmount).toBe('350.00');
    expect(record.commissionAmount).toBe('100.00');
  });

  it('replaces removed add-ons with an explicit zero snapshot, without changing people', async () => {
    record.partySizeTotal = 3;
    record.addonsSnapshot = { extras: { cocktails: 3, photos: 0, tshirts: 0 } };
    const e = incoming(); e.bookingFields!.addonsSnapshot = { extras: { cocktails: 0, photos: 0, tshirts: 0 } };
    await applyParsedEvent(email, e);
    expect(record.partySizeTotal).toBe(3);
    expect(record.addonsSnapshot).toEqual({ extras: { cocktails: 0, photos: 0, tshirts: 0 } });
    expect(BookingAddon.destroy).toHaveBeenCalled();
  });

  it('does not interpret an unspecified partial refund as evidence that all pending add-ons were refunded', async () => {
    record.platform = 'viator'; record.platformBookingId = 'BR-1234567890';
    record.addonsSnapshot = { extras: { cocktails: 1, photos: 0, tshirts: 0 } };
    record.addonRefundActions = [{ id: 'pending_1', status: 'pending', addonKey: 'cocktails', quantity: 1 }] as any;
    await applyParsedEvent(email, incoming({ refundTotal: 50, refundCurrency: 'PLN' }));
    expect(record.addonsSnapshot).toEqual({ extras: { cocktails: 1, photos: 0, tshirts: 0 } });
    expect((record.addonRefundActions as any)[0].status).toBe('pending');
  });
});
