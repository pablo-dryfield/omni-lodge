jest.mock('../../config/database.js', () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));

import type { Transaction } from 'sequelize';
import sequelize from '../../config/database';
import { exchangeShiftAssignmentOwners } from '../shiftAssignmentMutationService';

describe('exchangeShiftAssignmentOwners', () => {
  it('updates both owners atomically using the canonical assignment timestamp column', async () => {
    const transaction = {} as Transaction;

    await exchangeShiftAssignmentOwners(
      { id: 41, userId: 7 },
      { id: 52, userId: 9 },
      transaction,
    );

    expect(sequelize.query).toHaveBeenCalledTimes(1);
    const [sql, options] = (sequelize.query as jest.Mock).mock.calls[0];
    expect(sql).toContain('"updatedAt" = NOW()');
    expect(sql).not.toContain('"updated_at"');
    expect(options).toEqual({
      replacements: {
        fromAssignmentId: 41,
        toAssignmentId: 52,
        fromUserId: 7,
        toUserId: 9,
      },
      transaction,
    });
  });
});
