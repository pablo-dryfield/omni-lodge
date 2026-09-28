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
    const assignmentSql = String(test.query.mock.calls[0][0]);
    const snapshotSql = String(test.query.mock.calls[1][0]);
    expect(assignmentSql).toContain('target.requester_id');
    expect(assignmentSql).toContain('target.partner_id');
    expect(assignmentSql).not.toContain('DO $correct$');
    expect(snapshotSql).toContain('operational_split');
    expect(snapshotSql).toContain('2026-09-24');
    expect(snapshotSql).toContain('2026-09-27');
    expect(snapshotSql).toContain("concat_ws(' '");
    expect(snapshotSql).not.toContain(">>'firstName'\n                   ||");
    expect(test.query).toHaveBeenNthCalledWith(1, expect.any(String), {
      transaction: test.transaction,
    });
    expect(test.query).toHaveBeenNthCalledWith(2, expect.any(String), {
      transaction: test.transaction,
    });
    expect(test.transaction.commit).toHaveBeenCalled();
  });

  it('restores the preceding migration state on rollback', async () => {
    const test = createContext();
    await down({ context: test.context });
    const assignmentSql = String(test.query.mock.calls[0][0]);
    const snapshotSql = String(test.query.mock.calls[1][0]);
    expect(assignmentSql.indexOf('target.partner_id')).toBeLessThan(
      assignmentSql.indexOf('target.requester_id'),
    );
    expect(snapshotSql).toContain('takeover_split');
  });
});
