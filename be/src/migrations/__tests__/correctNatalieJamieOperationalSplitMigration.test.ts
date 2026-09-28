import { down, up } from '../202609280006-correct-natalie-jamie-operational-split.js';

const createContext = () => {
  const transaction = { commit: jest.fn(), rollback: jest.fn() };
  const query = jest.fn();
  return {
    context: { sequelize: { transaction: jest.fn().mockResolvedValue(transaction), query } } as never,
    query,
    transaction,
  };
};

describe('Natalie and Jamie operational salary split correction', () => {
  it('restores the actual Manager owners and records both split recipients', async () => {
    const test = createContext();
    await up({ context: test.context });
    const sql = String(test.query.mock.calls[0][0]);
    expect(sql).toContain('SET user_id = request_row.requester_id');
    expect(sql).toContain('SET user_id = request_row.partner_id');
    expect(sql).toContain('operational_split');
    expect(sql).toContain('2026-09-24');
    expect(sql).toContain('2026-09-27');
    expect(test.transaction.commit).toHaveBeenCalled();
  });

  it('restores the preceding migration state on rollback', async () => {
    const test = createContext();
    await down({ context: test.context });
    expect(String(test.query.mock.calls[0][0])).toContain('takeover_split');
  });
});
