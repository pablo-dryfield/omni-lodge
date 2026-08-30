jest.mock('../../__mocks__/sequelizeModelStub.ts', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), findByPk: jest.fn() },
}));
jest.mock('../../models/StaffPayoutReceipt.js', () => ({
  __esModule: true,
  default: { findByPk: jest.fn() },
}));
jest.mock('../../models/RequiredAction.js', () => ({
  __esModule: true,
  default: { findByPk: jest.fn() },
}));

import bcrypt from 'bcryptjs';
import RequiredAction from '../../models/RequiredAction';
import StaffPayoutReceipt from '../../models/StaffPayoutReceipt';
import User from '../../__mocks__/sequelizeModelStub';
import { verifyStaffPayoutReceiptAccessToken } from '../staffPayoutReceiptAccessTokenService';
import { exchangeStaffPayoutReceiptCredentials } from '../staffPayoutReceiptAccessService';

const NOW = new Date('2026-08-30T12:00:00.000Z');
const passwordHash = bcrypt.hashSync('correct-password', 4);

const inactiveUser = {
  id: 28,
  email: 'aimee@example.com',
  username: 'Aimee',
  password: passwordHash,
  status: false,
  approved: true,
  userTypeId: 3,
};
const receipt = {
  id: 91,
  staffUserId: 28,
  requiredActionId: 101,
  status: 'pending',
};
const action = {
  id: 101,
  type: 'staff_payout_receipt',
  payload: { receiptId: 91 },
  targetUserIds: [28],
  requiresCompletion: true,
  requiresSignature: true,
  startsAt: new Date('2026-08-30T11:00:00.000Z'),
  expiresAt: null,
  status: true,
};

describe('staff payout receipt credential exchange', () => {
  const originalSecret = process.env.STAFF_PAYOUT_RECEIPT_ACCESS_SECRET;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STAFF_PAYOUT_RECEIPT_ACCESS_SECRET = 'receipt-access-test-secret';
    (User.findOne as jest.Mock).mockResolvedValue({ ...inactiveUser });
    (User.findByPk as jest.Mock).mockResolvedValue({ ...inactiveUser });
    (StaffPayoutReceipt.findByPk as jest.Mock).mockResolvedValue({ ...receipt });
    (RequiredAction.findByPk as jest.Mock).mockResolvedValue({ ...action });
  });

  afterAll(() => {
    if (originalSecret === undefined) {
      delete process.env.STAFF_PAYOUT_RECEIPT_ACCESS_SECRET;
    } else {
      process.env.STAFF_PAYOUT_RECEIPT_ACCESS_SECRET = originalSecret;
    }
  });

  it('allows an inactive approved owner to exchange valid credentials for only the pending receipt', async () => {
    const result = await exchangeStaffPayoutReceiptCredentials({
      identity: 'aimee@example.com',
      password: 'correct-password',
      receiptId: 91,
      now: NOW,
    });

    expect(result).toMatchObject({ receiptId: 91, actionId: 101 });
    expect(verifyStaffPayoutReceiptAccessToken(result.token, { now: NOW })).toMatchObject({
      userId: 28,
      receiptId: 91,
      actionId: 101,
    });
    expect((User.findByPk as jest.Mock).mock.calls[0][1].attributes).toContain('status');
  });

  it('returns the same generic denial for a wrong password or a receipt owned by someone else', async () => {
    await expect(exchangeStaffPayoutReceiptCredentials({
      identity: 'aimee@example.com',
      password: 'wrong-password',
      receiptId: 91,
      now: NOW,
    })).rejects.toThrow('Unable to access this payout receipt.');

    (StaffPayoutReceipt.findByPk as jest.Mock).mockResolvedValue({
      ...receipt,
      staffUserId: 29,
    });
    await expect(exchangeStaffPayoutReceiptCredentials({
      identity: 'aimee@example.com',
      password: 'correct-password',
      receiptId: 91,
      now: NOW,
    })).rejects.toThrow('Unable to access this payout receipt.');
  });

  it('does not bypass approval, user type, action expiry, or receipt cancellation', async () => {
    (User.findOne as jest.Mock).mockResolvedValue({ ...inactiveUser, approved: false });
    await expect(exchangeStaffPayoutReceiptCredentials({
      identity: 'aimee@example.com', password: 'correct-password', receiptId: 91, now: NOW,
    })).rejects.toThrow('Unable to access this payout receipt.');

    (User.findOne as jest.Mock).mockResolvedValue({ ...inactiveUser });
    (RequiredAction.findByPk as jest.Mock).mockResolvedValue({
      ...action,
      expiresAt: new Date('2026-08-30T11:59:59.000Z'),
    });
    await expect(exchangeStaffPayoutReceiptCredentials({
      identity: 'aimee@example.com', password: 'correct-password', receiptId: 91, now: NOW,
    })).rejects.toThrow('Unable to access this payout receipt.');

    (RequiredAction.findByPk as jest.Mock).mockResolvedValue({ ...action });
    (StaffPayoutReceipt.findByPk as jest.Mock).mockResolvedValue({
      ...receipt,
      status: 'cancelled',
    });
    await expect(exchangeStaffPayoutReceiptCredentials({
      identity: 'aimee@example.com', password: 'correct-password', receiptId: 91, now: NOW,
    })).rejects.toThrow('Unable to access this payout receipt.');
  });
});
