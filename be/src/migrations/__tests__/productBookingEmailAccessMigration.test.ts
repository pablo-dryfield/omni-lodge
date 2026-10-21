import type { QueryInterface } from 'sequelize';
import { up, down, verify } from '../202610210003-product-booking-email-access';
it('adds nullable scopes without exposing existing templates or granting access to shared/guide roles', async () => {
  const transaction = {};
  const query = jest.fn();
  const context = { sequelize: { query, transaction: async (cb: any) => cb(transaction) } } as unknown as QueryInterface;
  await up({ context });
  const sql = query.mock.calls[0][0] as string;
  expect(sql).toContain('ADD COLUMN IF NOT EXISTS product_type_id');
  expect(sql).toContain('ADD COLUMN IF NOT EXISTS booking_id');
  expect(sql).toContain("r.slug = 'food-tour-owner'");
  expect(sql).toContain('COUNT(*) FROM user_type_product_types');
  expect(sql).not.toMatch(/UPDATE email_templates|UPDATE booking_emails|DROP |DELETE FROM/i);
  query.mockClear(); await down(); expect(query).not.toHaveBeenCalled();
});
it('verifies both data-isolation columns', async () => {
  const describeTable = jest.fn().mockResolvedValueOnce({ product_type_id: {} }).mockResolvedValueOnce({ booking_id: {} });
  expect((await verify({ context: { describeTable } as unknown as QueryInterface })).ok).toBe(true);
  describeTable.mockResolvedValue({});
  expect((await verify({ context: { describeTable } as unknown as QueryInterface })).ok).toBe(false);
});
