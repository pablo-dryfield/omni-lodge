jest.mock('../../config/database.js', () => ({ __esModule: true, default: { query: jest.fn(), transaction: jest.fn() } }));
jest.mock('../../models/StorefrontOngoingCart.js', () => ({ __esModule: true, default: {} }));
import sequelize from '../../config/database';
import { listOngoingCartPage, ongoingCartListQuery } from '../storefrontOngoingCartListService';

describe('ongoing cart pagination and filters', () => {
  it('defaults to a bounded page with stable ordering', () => {
    expect(ongoingCartListQuery({})).toMatchObject({ page: 1, pageSize: 25, sort: 'activity_desc', order: 'c.last_activity_at DESC, c.id DESC' });
  });
  it('binds search and other values separately and treats wildcard characters literally', () => {
    const value = "O'Hara_50%\\guest";
    const parsed = ongoingCartListQuery({ search: value, country: 'gb', currency: 'eur', status: 'active' });
    expect(parsed.where).not.toContain(value);
    expect(parsed.replacements).toEqual({ search: "%O'Hara\\_50\\%\\\\guest%", country: 'GB', currency: 'EUR', status: 'active' });
  });
  it('combines product and experience dates inside the same item match', () => {
    const parsed = ongoingCartListQuery({ productId: '28', experienceFrom: '2026-11-01', experienceTo: '2026-11-30', recovery: 'opened', minAmount: '0', maxAmount: '200', currency: 'PLN' });
    expect(parsed.where).toContain("item->>'productId' = :productId AND item->>'experienceDate' >= :experienceFrom AND item->>'experienceDate' <= :experienceTo");
    expect(parsed.where).toContain('c.recovery_opened_at IS NOT NULL');
    expect(parsed.replacements).toMatchObject({ productId: '28', minAmount: 0, maxAmount: 200 });
  });
  it('uses an exclusive next-day boundary in Warsaw for last-activity dates', () => {
    const parsed = ongoingCartListQuery({ activityFrom: '2026-10-25', activityTo: '2026-10-25' });
    expect(parsed.where).toContain("c.last_activity_at >= (CAST(:activityFrom AS date)::timestamp AT TIME ZONE 'Europe/Warsaw')");
    expect(parsed.where).toContain("c.last_activity_at < ((CAST(:activityTo AS date) + 1)::timestamp AT TIME ZONE 'Europe/Warsaw')");
  });
  it('keeps amount ordering separate by currency and uses a stable tie-breaker', () => {
    expect(ongoingCartListQuery({ sort: 'amount_desc' }).order).toBe('c.currency ASC, c.total DESC, c.id DESC');
  });
  it.each([
    { pageSize: '101' }, { page: '0' }, { page: '1.5' }, { page: '-1' }, { page: ['1', '2'] },
    { sort: 'toString' }, { sort: 'id; DROP TABLE users' }, { status: 'converted' }, { recovery: '__proto__' },
    { productId: 'not-a-number' }, { country: "G'" }, { currency: 'PLNN' },
    { activityFrom: '2026-02-30' }, { experienceFrom: '2026-11-30', experienceTo: '2026-11-01' },
    { minAmount: '20' }, { currency: 'PLN', minAmount: '-1' }, { currency: 'PLN', minAmount: '200', maxAmount: '100' },
  ])('rejects invalid query %j', input => expect(() => ongoingCartListQuery(input)).toThrow());
});

describe('ongoing cart page retrieval', () => {
  const transaction = { id: 'read-snapshot' };
  beforeEach(() => {
    jest.clearAllMocks();
    (sequelize.transaction as jest.Mock).mockImplementation((_options, callback) => callback(transaction));
  });
  it('exposes older records beyond 250 and counts the full filtered result, not the current page', async () => {
    (sequelize.query as jest.Mock)
      .mockResolvedValueOnce([{ total: '501', checkoutStarted: '400', recoverySent: '300', recoveryOpened: '50' }])
      .mockResolvedValueOnce([{ publicId: 'oldest-cart' }])
      .mockResolvedValueOnce([{ kind: 'country', value: 'GB', label: 'GB' }, { kind: 'currency', value: 'PLN', label: 'PLN' }, { kind: 'product', value: '28', label: 'Pub Crawl' }]);
    const page = await listOngoingCartPage({ page: '21', pageSize: '25', search: 'Guest' });
    expect(page.pagination).toEqual({ page: 21, pageSize: 25, total: 501, totalPages: 21 });
    expect(page.summary).toEqual({ total: 501, checkoutStarted: 400, recoverySent: 300, recoveryOpened: 50 });
    expect(page.rows).toHaveLength(1);
    expect(page.filters).toEqual({ products: [{ value: '28', label: 'Pub Crawl' }], countries: ['GB'], currencies: ['PLN'] });
    const calls = (sequelize.query as jest.Mock).mock.calls;
    expect(calls[0][0]).not.toContain('LIMIT');
    expect(calls[1][0]).toContain('LIMIT :limit OFFSET :offset');
    expect(calls[1][1]).toMatchObject({ replacements: { limit: 25, offset: 500, search: '%Guest%' }, transaction, mapToModel: true });
    expect(calls.every(call => call[1].transaction === transaction)).toBe(true);
    expect(sequelize.transaction).toHaveBeenCalledWith(expect.objectContaining({ readOnly: true, isolationLevel: 'REPEATABLE READ' }), expect.any(Function));
  });
  it('clamps the last page after a cart is removed and returns valid empty pagination', async () => {
    (sequelize.query as jest.Mock).mockResolvedValueOnce([{ total: '25' }]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    expect((await listOngoingCartPage({ page: '2' })).pagination).toEqual({ page: 1, pageSize: 25, total: 25, totalPages: 1 });
    (sequelize.query as jest.Mock).mockResolvedValueOnce([{ total: '0' }]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    expect((await listOngoingCartPage({ page: '99' })).pagination).toEqual({ page: 1, pageSize: 25, total: 0, totalPages: 1 });
  });
});
