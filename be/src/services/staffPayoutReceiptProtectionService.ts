import { Op, type Transaction as SequelizeTransaction } from 'sequelize';
import StaffPayoutReceipt from '../models/StaffPayoutReceipt.js';
import StaffPayoutReceiptItem from '../models/StaffPayoutReceiptItem.js';
import StaffProfile from '../models/StaffProfile.js';
import User from '../models/User.js';

export const STAFF_PAYOUT_RECEIPT_TRANSACTION_PROTECTED_MESSAGE =
  'This finance transaction belongs to an active staff payout receipt. Adjust it from Pays so the confirmation request and audit evidence stay consistent.';

export const STAFF_PAYMENT_REQUIRES_PAYS_MESSAGE =
  'Staff payments must be recorded from Pays so the staff member receives the required photo and e-signature confirmation request.';

export async function assertFinanceTransactionIsNotReceiptProtected(
  financeTransactionId: number,
  transaction?: SequelizeTransaction,
): Promise<void> {
  if (!Number.isInteger(financeTransactionId) || financeTransactionId <= 0) {
    return;
  }

  const linkedItem = await StaffPayoutReceiptItem.findOne({
    attributes: ['id'],
    where: { financeTransactionId },
    include: [{
      model: StaffPayoutReceipt,
      as: 'receipt',
      attributes: ['id'],
      required: true,
      where: { status: { [Op.in]: ['pending', 'completed'] } },
    }],
    transaction,
  });

  if (linkedItem) {
    throw new Error(STAFF_PAYOUT_RECEIPT_TRANSACTION_PROTECTED_MESSAGE);
  }
}

export async function assertCounterpartyIsNotStaffPayment(params: {
  kind: unknown;
  status: unknown;
  counterpartyId: unknown;
  transaction?: SequelizeTransaction;
}): Promise<void> {
  const normalizedStatus = String(params.status ?? '').trim().toLowerCase();
  if (
    String(params.kind ?? '').trim().toLowerCase() !== 'expense'
    || !['paid', 'reimbursed'].includes(normalizedStatus)
  ) {
    return;
  }
  const vendorId = Number(params.counterpartyId);
  if (!Number.isInteger(vendorId) || vendorId <= 0) {
    return;
  }

  const linkedStaffProfile = await StaffProfile.findOne({
    attributes: ['userId'],
    where: { financeVendorId: vendorId },
    transaction: params.transaction,
  });
  const linkedAffiliateStaffProfile = linkedStaffProfile
    ? null
    : await StaffProfile.findOne({
        attributes: ['userId'],
        include: [{
          model: User,
          as: 'user',
          attributes: [],
          required: true,
          where: { financeVendorId: vendorId },
        }],
        transaction: params.transaction,
      });
  if (linkedStaffProfile || linkedAffiliateStaffProfile) {
    throw new Error(STAFF_PAYMENT_REQUIRES_PAYS_MESSAGE);
  }
}
