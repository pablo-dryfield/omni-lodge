jest.mock('../../models/FinanceAuditLog.js', () => ({
  __esModule: true,
  default: { create: jest.fn() },
}));

import FinanceAuditLog from '../../models/FinanceAuditLog';
import { recordFinanceAuditLog } from '../auditLogService';

describe('finance audit log transaction support', () => {
  it('writes through the caller transaction so finance mutations and audit rows stay atomic', async () => {
    const transaction = { id: 'payout-transaction' };
    const record = { id: 90 };
    (FinanceAuditLog.create as jest.Mock).mockResolvedValue(record);

    await expect(recordFinanceAuditLog({
      entity: 'finance_transaction',
      entityId: 601,
      action: 'create',
      performedBy: 1,
      transaction: transaction as never,
    })).resolves.toBe(record);

    expect(FinanceAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'finance_transaction',
        entityId: 601,
        action: 'create',
        performedBy: 1,
      }),
      { transaction },
    );
  });
});
