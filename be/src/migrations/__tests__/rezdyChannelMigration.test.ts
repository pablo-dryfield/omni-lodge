import { up, down, verify } from '../202610200002-rezdy-channel.js';
import type { QueryInterface } from 'sequelize';

it('creates a missing channel without overwriting configured channels or queueing historical emails', async () => {
  const transaction = {};
  const query = jest.fn(async () => [[], {}]);
  const context = { sequelize: { query, transaction: jest.fn(async (fn) => fn(transaction)) } } as unknown as QueryInterface;
  await up({ context });
  expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO channels'), { transaction });
  const sql = query.mock.calls.map((args: unknown[]) => args[0]).join('\n');
  expect(sql).toContain("LOWER(name) = 'rezdy'");
  expect(sql).not.toMatch(/UPDATE channels|UPDATE booking_emails|DELETE|DROP/i);
  query.mockClear();
  await down();
  expect(query).not.toHaveBeenCalled();
});

it('exposes a migration verification check', async () => {
  const context = { sequelize: { query: jest.fn(async () => [[{ ready: true }], {}]) } } as unknown as QueryInterface;
  expect((await verify({ context })).ok).toBe(true);
});
