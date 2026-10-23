import type { Response } from 'express';
import { Transaction } from 'sequelize';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest';

jest.mock('../../config/database.js', () => ({ __esModule: true, default: { transaction: jest.fn(), query: jest.fn() } }));
jest.mock('../../models/Booking.js', () => ({ __esModule: true, default: { findOne: jest.fn(), build: jest.fn() } }));
jest.mock('../../models/BookingEvent.js', () => ({ __esModule: true, default: { create: jest.fn() } }));
jest.mock('../../models/Product.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/ProductAlias.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/Channel.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../services/bookings/gmailClient.js', () => ({ sendMessage: jest.fn() }));
jest.mock('../../services/configService.js', () => ({ getConfigValue: jest.fn(() => null) }));
jest.mock('../../utils/logger.js', () => ({ __esModule: true, default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../../finance/services/stripeClient.js', () => ({
  normalizeDirectStripeMerchant: (value: unknown) => value ?? null,
  resolveDirectStripeMerchantAssignment: (persisted: boolean, current: unknown, incoming: unknown) => persisted ? current : incoming,
}));

import database from '../../config/database';
import Booking from '../../models/Booking';
import BookingEvent from '../../models/BookingEvent';
import { sendMessage } from '../../services/bookings/gmailClient';
import { ingestDirectBooking } from '../directBookingIntegrationController';

type Row = Record<string, unknown> & { get: (key: string) => unknown; set: (key: string, value: unknown) => void; save: jest.Mock };
type TestTransaction = { pending: Row[]; events: Array<Record<string, unknown>>; releases: Array<() => void>; locked: boolean };
let committed: Row[];
let committedEvents: Array<Record<string, unknown>>;
let lockTails: Map<string, Promise<void>>;
let nextId: number;
let failSave: boolean;
const databaseMock = database as unknown as { transaction: jest.Mock; query: jest.Mock };
const bookingMock = Booking as unknown as { findOne: jest.Mock; build: jest.Mock };
const eventMock = BookingEvent as unknown as { create: jest.Mock };
const request = (fields: Record<string, unknown> = {}) => ({
  headers: {}, ip: '127.0.0.1', body: {
    platform: 'direct', platformBookingId: 'ftk_concurrency_test', platformOrderId: 'pi_test',
    productId: 48, channelId: 1, productName: 'Food Tour', experienceDate: '2027-01-10',
    experienceStartAt: '2027-01-10T14:00:00+01:00', partySizeTotal: 2,
    guestFirstName: 'Test', guestLastName: 'Guest', guestEmail: 'guest@example.test',
    priceGross: 600, baseAmount: 600, currency: 'PLN', paymentStatus: 'paid', stripeMerchant: 'food-tour',
    ...fields,
  },
} as unknown as AuthenticatedRequest);
const response = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });
const ingest = async (fields: Record<string, unknown> = {}) => {
  const res = response();
  await ingestDirectBooking(request(fields), res as unknown as Response);
  return { status: res.status.mock.calls[0][0] as number, body: res.json.mock.calls[0][0] as Record<string, unknown> };
};

beforeEach(() => {
  jest.clearAllMocks();
  committed = []; committedEvents = []; lockTails = new Map(); nextId = 1; failSave = false;
  databaseMock.transaction.mockImplementation(async (_options, callback: (tx: TestTransaction) => Promise<unknown>) => {
    const tx: TestTransaction = { pending: [], events: [], releases: [], locked: false };
    try {
      const result = await callback(tx);
      for (const row of tx.pending) {
        const index = committed.findIndex(existing => existing.id === row.id);
        if (index < 0) committed.push(row); else committed[index] = row;
      }
      committedEvents.push(...tx.events);
      return result;
    } finally {
      tx.releases.forEach(release => release());
    }
  });
  databaseMock.query.mockImplementation(async (sql: string, options: { replacements: { identity: string }; transaction: TestTransaction }) => {
    expect(sql).toContain('pg_advisory_xact_lock(hashtextextended(:identity, 0))');
    const key = options.replacements.identity;
    const previous = lockTails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>(resolve => { release = resolve; });
    lockTails.set(key, next);
    await previous;
    options.transaction.locked = true;
    options.transaction.releases.push(release);
  });
  const row = (data: Record<string, unknown>): Row => ({
    ...data,
    get(key) { return this[key]; },
    set(key, value) { this[key] = value; },
    save: jest.fn().mockImplementation(async function (this: Row, { transaction }: { transaction: TestTransaction }) {
      if (failSave) { failSave = false; throw new Error('Simulated insert failure'); }
      await Promise.resolve();
      this.id ??= nextId++;
      transaction.pending.push(this);
    }),
  });
  bookingMock.build.mockImplementation(row);
  bookingMock.findOne.mockImplementation(async ({ where, transaction }: {
    where: { platform: string; platformBookingId: string }; transaction: TestTransaction;
  }) => {
    expect(transaction.locked).toBe(true); // Must lock before the existence check, not only before INSERT.
    const existing = committed.find(item => item.platform === where.platform && item.platformBookingId === where.platformBookingId);
    await Promise.resolve(); // Expose overlap if the ingestion lock is removed.
    return existing ? row(existing) : null;
  });
  eventMock.create.mockImplementation(async (event, { transaction }: { transaction: TestTransaction }) => {
    transaction.events.push(event);
  });
  jest.mocked(sendMessage).mockResolvedValue({ id: 'mail_test', to: 'guest@example.test' } as never);
});

it('creates one booking and sends one confirmation for simultaneous identical checkout submissions', async () => {
  const results = await Promise.all(Array.from({ length: 5 }, () => ingest()));
  expect(results.map(result => result.status).sort()).toEqual([200, 200, 200, 200, 201]);
  expect(new Set(results.map(result => result.body.bookingId)).size).toBe(1);
  expect(committed).toHaveLength(1);
  expect(committed[0]).toMatchObject({ partySizeTotal: 2, priceGross: '600.00' });
  expect(committedEvents.filter(event => event.eventType === 'created')).toHaveLength(1);
  expect(committedEvents).toHaveLength(5);
  expect(sendMessage).toHaveBeenCalledTimes(1);
  expect(databaseMock.transaction).toHaveBeenCalledWith({ isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED }, expect.any(Function));
});

it('uses separate lock identities for different booking references and platforms', async () => {
  await Promise.all([ingest(), ingest({ platformBookingId: 'ftk_second' }), ingest({ platform: 'other' })]);
  expect(committed).toHaveLength(3);
  const keys = databaseMock.query.mock.calls.map(call => call[1].replacements.identity);
  expect(new Set(keys).size).toBe(3);
  expect(JSON.parse(keys[0])).toEqual(['direct-booking-ingestion', 'direct', 'ftk_concurrency_test']);
});

it('rolls back a failed insert and releases the transaction lock so a retry can create the booking', async () => {
  failSave = true;
  expect((await ingest()).status).toBe(400);
  expect(committed).toHaveLength(0);
  expect(committedEvents).toHaveLength(0);
  expect(sendMessage).not.toHaveBeenCalled();
  expect((await ingest()).status).toBe(201);
  expect(committed).toHaveLength(1);
});

it('retains amendment behavior without inserting another booking or resending confirmation', async () => {
  const original = await ingest();
  const amended = await ingest({ partySizeTotal: 3, baseAmount: 900, experienceDate: '2027-01-11' });
  expect(amended.body.bookingId).toBe(original.body.bookingId);
  expect(amended.body.eventType).toBe('amended');
  expect(committed).toHaveLength(1);
  expect(committed[0]).toMatchObject({ partySizeTotal: 3, baseAmount: '900.00', experienceDate: '2027-01-11' });
  expect(sendMessage).toHaveBeenCalledTimes(1);
});
