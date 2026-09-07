import { Op, type Transaction } from 'sequelize';
import HttpError from '../errors/HttpError.js';
import User from '../models/User.js';
import StaffPayoutLedger from '../models/StaffPayoutLedger.js';
import StaffPayoutCollectionLog from '../models/StaffPayoutCollectionLog.js';
import VolunteerFundEntry from '../finance/models/VolunteerFundEntry.js';
import { isStaffPayoutReimbursementCollection } from './staffPayoutCollectionClassificationService.js';

/** Serialize against Pays and never silently change a task that has already been settled. */
export async function prepareTaskCompletionPayrollMutation({ userId, taskDate, transaction }: {
  userId: number; taskDate: string; transaction: Transaction;
}): Promise<void> {
  const user = await User.findByPk(userId, { attributes: ['id'], transaction, lock: transaction.LOCK.UPDATE });
  if (!user) throw new HttpError(409, 'The task assignee no longer exists.');
  const paidLedger = await StaffPayoutLedger.findOne({
    where: { staffUserId: userId, paidAmountMinor: { [Op.ne]: 0 }, rangeEnd: { [Op.gte]: taskDate } },
    attributes: ['id'], transaction, lock: transaction.LOCK.UPDATE,
  });
  const collections = await StaffPayoutCollectionLog.findAll({
    where: { staffProfileId: userId, direction: 'payable', amountMinor: { [Op.ne]: 0 },
      rangeStart: { [Op.lte]: taskDate }, rangeEnd: { [Op.gte]: taskDate } },
    attributes: ['id', 'note'], transaction, lock: transaction.LOCK.UPDATE,
  });
  const allocations = await VolunteerFundEntry.findAll({
    where: { attributedStaffUserId: userId, entryType: 'allocation',
      periodStart: { [Op.lte]: taskDate }, periodEnd: { [Op.gte]: taskDate } },
    attributes: ['id', 'amountMinor'], transaction, lock: transaction.LOCK.UPDATE,
  });
  const reversals = allocations.length ? await VolunteerFundEntry.findAll({
    where: { entryType: 'reversal', reversalOfEntryId: { [Op.in]: allocations.map((entry) => entry.id) } },
    attributes: ['reversalOfEntryId', 'amountMinor'], transaction, lock: transaction.LOCK.UPDATE,
  }) : [];
  const hasSettledAllocation = allocations.some((allocation) => Number(allocation.amountMinor)
    + reversals.filter((entry) => String(entry.reversalOfEntryId) === String(allocation.id))
      .reduce((sum, entry) => sum + Number(entry.amountMinor), 0) > 0);
  if (paidLedger || collections.some((entry) => !isStaffPayoutReimbursementCollection(entry)) || hasSettledAllocation) {
    throw new HttpError(409, 'This task affects an already settled payout or carried balance. Reconcile the affected settlement in Staff Payments before changing its completion.');
  }
  await StaffPayoutLedger.update({ settlementSnapshot: null }, {
    where: { staffUserId: userId, paidAmountMinor: 0, rangeEnd: { [Op.gte]: taskDate } }, transaction,
  });
}
