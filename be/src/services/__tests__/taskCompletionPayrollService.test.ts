jest.mock('../../models/StaffPayoutLedger.js', () => ({ __esModule: true, default: { findOne: jest.fn(), update: jest.fn() } }));
jest.mock('../../models/StaffPayoutCollectionLog.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../finance/models/VolunteerFundEntry.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../staffPayoutCollectionClassificationService.js', () => ({ isStaffPayoutReimbursementCollection: (entry: { note?: string }) => entry.note === 'reimbursement' }));
import { Op, type Transaction } from 'sequelize';
import User from '../../__mocks__/sequelizeModelStub';
import StaffPayoutLedger from '../../models/StaffPayoutLedger.js';
import StaffPayoutCollectionLog from '../../models/StaffPayoutCollectionLog.js';
import VolunteerFundEntry from '../../finance/models/VolunteerFundEntry.js';
import { prepareTaskCompletionPayrollMutation } from '../taskCompletionPayrollService.js';

const tx = { LOCK: { UPDATE: 'UPDATE' } } as unknown as Transaction;
const mockUser = User as { findByPk: jest.Mock };
const run = () => prepareTaskCompletionPayrollMutation({ userId: 12, taskDate: '2026-09-07', transaction: tx });
beforeEach(() => {
  jest.clearAllMocks();
  mockUser.findByPk = jest.fn().mockResolvedValue({ id: 12 });
  (StaffPayoutLedger.findOne as jest.Mock).mockResolvedValue(null);
  (StaffPayoutCollectionLog.findAll as jest.Mock).mockResolvedValue([]);
  (VolunteerFundEntry.findAll as jest.Mock).mockResolvedValue([]);
});
it('locks the payout owner and invalidates only unsettled affected carry snapshots', async () => {
  await run();
  expect(mockUser.findByPk).toHaveBeenCalledWith(12, { attributes: ['id'], transaction: tx, lock: 'UPDATE' });
  expect(StaffPayoutLedger.update).toHaveBeenCalledWith({ settlementSnapshot: null }, {
    where: { staffUserId: 12, paidAmountMinor: 0, rangeEnd: { [Op.gte]: '2026-09-07' } }, transaction: tx,
  });
});
it('rejects paid ledgers, including downstream months that consumed carry', async () => {
  (StaffPayoutLedger.findOne as jest.Mock).mockResolvedValue({ id: 2 });
  await expect(run()).rejects.toMatchObject({ status: 409 });
  expect(StaffPayoutLedger.update).not.toHaveBeenCalled();
});
it('does not treat reimbursement-only collections as task compensation', async () => {
  (StaffPayoutCollectionLog.findAll as jest.Mock).mockResolvedValue([{ note: 'reimbursement' }]);
  await expect(run()).resolves.toBeUndefined();
  (StaffPayoutCollectionLog.findAll as jest.Mock).mockResolvedValue([{ note: 'salary' }]);
  await expect(run()).rejects.toMatchObject({ status: 409 });
});
it('blocks an active volunteer allocation but allows a fully reversed allocation', async () => {
  (VolunteerFundEntry.findAll as jest.Mock).mockResolvedValueOnce([{ id: 4, amountMinor: 200 }]).mockResolvedValueOnce([]);
  await expect(run()).rejects.toMatchObject({ status: 409 });
  (VolunteerFundEntry.findAll as jest.Mock).mockResolvedValueOnce([{ id: 4, amountMinor: 200 }])
    .mockResolvedValueOnce([{ reversalOfEntryId: 4, amountMinor: -200 }]);
  await expect(run()).resolves.toBeUndefined();
});
