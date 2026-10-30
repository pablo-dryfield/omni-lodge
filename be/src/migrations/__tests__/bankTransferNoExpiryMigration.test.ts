import { up, down, verify } from '../202610300001-bank-transfer-no-expiry.js';

const setup = () => {
  const transaction = {};
  const query = jest.fn().mockResolvedValue([[], {}]);
  const context = { sequelize: { query, transaction: jest.fn(async callback => callback(transaction)) } };
  return { context, query, transaction };
};
it('removes active transfer deadlines and extends only live holds, with audit records in one transaction', async () => {
  const { context, query, transaction } = setup();
  await up({ context: context as never });
  expect(query).toHaveBeenCalledTimes(4);
  for (const [, options] of query.mock.calls) expect(options.transaction).toBe(transaction);
  const sql = query.mock.calls.map(([statement]) => String(statement));
  expect(sql[0]).toContain('ALTER COLUMN expires_at DROP NOT NULL');
  expect(sql[1]).toContain('FOR UPDATE');
  for (const statement of sql.slice(1)) {
    expect(statement).toContain("order_source = 'backoffice'");
    expect(statement).toContain("payment_method = 'bank_transfer'");
    expect(statement).toContain("status = 'pending_payment'");
    expect(statement).toContain("payment_status = 'unpaid'");
  }
  expect(sql[2]).toContain("r.status = 'held' AND r.expires_at > NOW()");
  expect(sql[2]).toContain('SET expires_at = NULL');
  expect(sql[2]).toContain('storefront.bank_transfer_hold_expiry_removed');
  expect(sql[3]).toContain('payment_due_at IS NOT NULL');
  expect(sql[3]).toContain('SET payment_due_at = NULL');
  expect(sql[3]).toContain('previousPaymentDueAt');
  expect(sql.join('\n')).not.toMatch(/SET status|SET payment_status|UPDATE bookings/i);
  await down(); // Rollback must not restore deadlines or cancelled reservations.
  expect(query).toHaveBeenCalledTimes(4);
});
it.each([['YES', 0, true], ['NO', 0, false], ['YES', 1, false]] as const)(
  'verifies nullable=%s remaining deadlines=%s', async (nullable, remaining, ok) => {
    const { context, query } = setup();
    query.mockResolvedValueOnce([[{ is_nullable: nullable }], {}]).mockResolvedValueOnce([[{ remaining }], {}]);
    expect(await verify({ context: context as never })).toMatchObject({ ok });
  },
);
