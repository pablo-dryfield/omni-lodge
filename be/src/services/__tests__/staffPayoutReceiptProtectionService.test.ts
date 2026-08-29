jest.mock('../../models/StaffPayoutReceipt.js', () => ({
  __esModule: true,
  default: {},
}));
jest.mock('../../models/StaffPayoutReceiptItem.js', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));
jest.mock('../../models/StaffProfile.js', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));

import StaffPayoutReceiptItem from '../../models/StaffPayoutReceiptItem';
import StaffProfile from '../../models/StaffProfile';
import {
  assertCounterpartyIsNotStaffPayment,
  assertFinanceTransactionIsNotReceiptProtected,
  STAFF_PAYMENT_REQUIRES_PAYS_MESSAGE,
  STAFF_PAYOUT_RECEIPT_TRANSACTION_PROTECTED_MESSAGE,
} from '../staffPayoutReceiptProtectionService';

describe('staff payout receipt finance protection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (StaffProfile.findOne as jest.Mock).mockResolvedValue(null);
  });

  it('blocks mutation of a transaction linked to an active receipt', async () => {
    (StaffPayoutReceiptItem.findOne as jest.Mock).mockResolvedValue({ id: 9 });

    await expect(assertFinanceTransactionIsNotReceiptProtected(601)).rejects.toThrow(
      STAFF_PAYOUT_RECEIPT_TRANSACTION_PROTECTED_MESSAGE,
    );
  });

  it('allows a transaction with no active receipt link', async () => {
    (StaffPayoutReceiptItem.findOne as jest.Mock).mockResolvedValue(null);

    await expect(assertFinanceTransactionIsNotReceiptProtected(602)).resolves.toBeUndefined();
  });

  it('routes expense payments to staff-linked vendors through Pays', async () => {
    (StaffProfile.findOne as jest.Mock).mockResolvedValue({ userId: 24 });

    await expect(assertCounterpartyIsNotStaffPayment({
      kind: 'expense',
      status: 'paid',
      counterpartyId: 72,
    })).rejects.toThrow(STAFF_PAYMENT_REQUIRES_PAYS_MESSAGE);
  });

  it('also blocks a staff affiliate vendor stored on the user record', async () => {
    (StaffProfile.findOne as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ userId: 24 });

    await expect(assertCounterpartyIsNotStaffPayment({
      kind: 'expense',
      status: 'paid',
      counterpartyId: 74,
    })).rejects.toThrow(STAFF_PAYMENT_REQUIRES_PAYS_MESSAGE);
  });

  it('also routes reimbursed expenses for staff-linked vendors through Pays', async () => {
    (StaffProfile.findOne as jest.Mock).mockResolvedValue({ userId: 24 });

    await expect(assertCounterpartyIsNotStaffPayment({
      kind: 'expense',
      status: 'reimbursed',
      counterpartyId: 72,
    })).rejects.toThrow(STAFF_PAYMENT_REQUIRES_PAYS_MESSAGE);
  });

  it('does not treat ordinary vendors or non-expenses as staff payments', async () => {
    (StaffProfile.findOne as jest.Mock).mockResolvedValue(null);
    await expect(assertCounterpartyIsNotStaffPayment({
      kind: 'expense',
      status: 'paid',
      counterpartyId: 73,
    })).resolves.toBeUndefined();
    await expect(assertCounterpartyIsNotStaffPayment({
      kind: 'income',
      status: 'paid',
      counterpartyId: 72,
    })).resolves.toBeUndefined();

    await expect(assertCounterpartyIsNotStaffPayment({
      kind: 'expense',
      status: 'planned',
      counterpartyId: 72,
    })).resolves.toBeUndefined();

    expect(StaffProfile.findOne).toHaveBeenCalledTimes(2);
  });
});
