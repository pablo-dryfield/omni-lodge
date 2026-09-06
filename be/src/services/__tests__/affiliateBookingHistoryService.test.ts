jest.mock('../../models/Booking.js', () => ({
  __esModule: true,
  default: { sequelize: { query: jest.fn() } },
}));

import { QueryTypes, type Transaction } from 'sequelize';
import Booking from '../../models/Booking';
import { fetchAffiliateBookingsWithPriorPubCrawl } from '../affiliateBookingHistoryService';

const query = Booking.sequelize!.query as jest.Mock;

describe('fetchAffiliateBookingsWithPriorPubCrawl', () => {
  beforeEach(() => {
    query.mockReset();
    query.mockResolvedValue([]);
  });

  it('skips the query when there are no valid booking IDs', async () => {
    expect(await fetchAffiliateBookingsWithPriorPubCrawl([])).toEqual(new Set());
    expect(await fetchAffiliateBookingsWithPriorPubCrawl([0, -1, NaN, 1.5])).toEqual(new Set());
    expect(query).not.toHaveBeenCalled();
  });

  it('queries all candidates in one read, binds IDs, and preserves the transaction', async () => {
    const transaction = {} as Transaction;
    query.mockResolvedValue([{ id: '23' }, { id: 41 }]);
    expect(await fetchAffiliateBookingsWithPriorPubCrawl([23, 23, 41, 0], transaction))
      .toEqual(new Set([23, 41]));
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(expect.any(String), {
      bind: { bookingIds: [23, 41] },
      type: QueryTypes.SELECT,
      transaction,
    });
  });

  it('accepts the string BIGINT IDs returned by PostgreSQL', async () => {
    await fetchAffiliateBookingsWithPriorPubCrawl(['23', '23', '41', 'invalid'] as unknown as number[]);
    expect(query).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      bind: { bookingIds: [23, 41] },
    }));
  });
});

// Opt-in PostgreSQL verification executes the actual service query against
// VALUES-like CTE fixtures. It neither reads nor writes application tables.
const databaseDescribe = process.env.AFFILIATE_HISTORY_TEST_DATABASE === '1' ? describe : describe.skip;

databaseDescribe('affiliate history SQL against PostgreSQL fixtures', () => {
  let client: { connect: () => Promise<void>; end: () => Promise<void>; query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }> };

  beforeAll(async () => {
    const { Client } = await import('pg');
    client = new Client({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT ?? 5432),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    });
    await client.connect();
  });

  afterAll(async () => {
    await client?.end();
  });

  it('matches earlier pub crawls by either complete normalized contact and rejects unrelated history', async () => {
    const receivedAt = '2026-09-06T20:00:00Z';
    const earlierAt = '2026-08-01T18:00:00Z';
    const candidate = (id: number, overrides: Record<string, unknown> = {}) => ({
      id,
      source_received_at: receivedAt,
      guest_email: `guest${id}@example.com`,
      guest_phone: null,
      status: 'confirmed',
      product_id: 28,
      product_name: 'Pub Crawl',
      ...overrides,
    });
    const prior = (id: number, overrides: Record<string, unknown> = {}) =>
      candidate(id, { source_received_at: earlierAt, ...overrides });
    const fixtures = [
      candidate(101, { guest_email: '  Guest101@Example.com  ', guest_phone: '+48 600 100 001' }),
      prior(1, { guest_email: 'guest101@example.com', guest_phone: '+48 600 200 001' }),
      candidate(102, { guest_phone: '+48 (600) 123-456' }),
      prior(2, { guest_phone: '0048 600123456' }),
      candidate(103), // Only itself is present.
      candidate(104, { guest_email: null }),
      prior(4, { guest_email: null }),
      candidate(105, { guest_email: '-', guest_phone: '000000000' }),
      prior(5, { guest_email: '-', guest_phone: '000000000' }),
      candidate(106),
      prior(6, { guest_email: 'guest106@example.com', product_id: 29, product_name: 'Food Tour' }),
      candidate(107),
      prior(7, { guest_email: 'guest107@example.com', status: 'cancelled' }),
      candidate(108),
      prior(8, { guest_email: 'guest108@example.com', source_received_at: '2026-09-07T18:00:00Z' }),
      candidate(109),
      prior(9, { guest_email: 'guest109@example.com', source_received_at: receivedAt }),
      candidate(110),
      prior(10, { guest_email: 'guest110@example.com', product_id: 31, product_name: 'Food Tour' }),
      candidate(111),
      prior(11, { guest_email: 'guest111@example.com', product_id: 29, product_name: 'Pub Crawl' }),
      candidate(112),
      prior(12, { guest_email: 'guest112@example.com', product_id: null, product_name: 'NYE Pub Crawl' }),
      candidate(113, { guest_email: 'unknown', guest_phone: '12345' }),
      prior(13, { guest_email: 'unknown', guest_phone: '12345' }),
      candidate(114, { guest_email: 'repeat@example.com', source_received_at: earlierAt }),
      candidate(115, { guest_email: 'repeat@example.com' }),
      candidate(116, { source_received_at: null }),
      prior(16, { guest_email: 'guest116@example.com' }),
      candidate(117, { product_id: 29, product_name: 'Food Tour' }),
      prior(17, { guest_email: 'guest117@example.com' }),
      candidate(118, { guest_phone: '+48 600 123 457' }),
      prior(18, { guest_phone: '600123457' }), // No guessed country code.
      candidate(119, { guest_phone: '+48 600 123 458' }),
      prior(19, { guest_phone: '+44 600 123 458' }), // No suffix-only match.
      candidate(120, { guest_email: '', guest_phone: '111111111' }),
      prior(20, { guest_email: '', guest_phone: '111111111' }),
    ];
    const products = [
      { id: 28, name: 'Pub Crawl' },
      { id: 29, name: 'Food Tour' },
      { id: 31, name: 'Private Pub Crawl' },
    ];

    query.mockReset();
    query.mockImplementation(async (sql: string, options: { bind: { bookingIds: number[] } }) => {
      const fixtureQuery = `WITH bookings AS (
        SELECT * FROM jsonb_to_recordset($2::jsonb) AS fixture(
          id bigint, source_received_at timestamptz, guest_email text,
          guest_phone text, status text, product_id integer, product_name text
        )
      ), products AS (
        SELECT * FROM jsonb_to_recordset($3::jsonb) AS fixture(id integer, name text)
      ), ${sql.replace(/^\s*WITH\s+/i, '').replace(/\$bookingIds/g, '$1')}`;
      const result = await client.query(fixtureQuery, [
        options.bind.bookingIds,
        JSON.stringify(fixtures),
        JSON.stringify(products),
      ]);
      return result.rows;
    });

    expect(await fetchAffiliateBookingsWithPriorPubCrawl(fixtures.filter(({ id }) => id >= 100).map(({ id }) => id)))
      .toEqual(new Set([101, 102, 110, 112, 115]));
    expect(query).toHaveBeenCalledTimes(1);
  });
});
