import {
  down,
  up,
} from '../202608300007-staff-payout-settlement-request-bindings.js';

const createContext = () => {
  const transaction = {
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
  };
  const query = jest.fn().mockResolvedValue(undefined);
  return {
    context: {
      sequelize: {
        transaction: jest.fn().mockResolvedValue(transaction),
        query,
      },
    } as never,
    query,
    transaction,
  };
};

describe('staff payout settlement request binding migration', () => {
  it('creates an immutable staff-scoped request binding with database validation', async () => {
    const { context, query, transaction } = createContext();

    await up({ context });

    const sql = query.mock.calls.map(([statement]) => String(statement)).join('\n');
    expect(sql).toContain('CREATE TABLE staff_payout_settlement_requests');
    expect(sql).toContain('UNIQUE (staff_user_id, request_id)');
    expect(sql).toContain("request_id ~ '^[A-Za-z0-9_-]{16,128}$'");
    expect(sql).toContain("payout_batch_key ~ '^[a-f0-9]{64}$'");
    expect(sql.match(/REFERENCES users\(id\) ON DELETE RESTRICT/g)).toHaveLength(2);
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).not.toHaveBeenCalled();
  });

  it('drops only the request binding table on rollback', async () => {
    const { context, query, transaction } = createContext();

    await down({ context });

    expect(String(query.mock.calls[0][0])).toContain(
      'DROP TABLE IF EXISTS staff_payout_settlement_requests',
    );
    expect(transaction.commit).toHaveBeenCalledTimes(1);
  });
});
