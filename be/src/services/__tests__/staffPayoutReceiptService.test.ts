const mockTransaction = { LOCK: { UPDATE: 'UPDATE' } };

jest.mock('../../config/database.js', () => ({
  __esModule: true,
  default: {
    transaction: jest.fn(async (callback: (value: unknown) => unknown) => callback(mockTransaction)),
  },
}));
jest.mock('../../finance/models/FinanceFile.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/RequiredAction.js', () => ({
  __esModule: true,
  default: { create: jest.fn(), update: jest.fn() },
}));
jest.mock('../../models/RequiredActionCompletion.js', () => ({
  __esModule: true,
  default: { findOrCreate: jest.fn() },
}));
jest.mock('../../models/StaffPayoutReceipt.js', () => ({
  __esModule: true,
  default: { findByPk: jest.fn(), findOne: jest.fn(), create: jest.fn() },
}));
jest.mock('../../models/StaffPayoutReceiptItem.js', () => ({
  __esModule: true,
  default: { bulkCreate: jest.fn() },
}));
jest.mock('../../models/User.js', () => ({
  __esModule: true,
  default: { findByPk: jest.fn() },
}));
jest.mock('../staffPayoutReceiptStorageService.js', () => ({
  storeStaffPayoutReceiptFile: jest.fn(),
  deleteStoredStaffPayoutReceiptFile: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../staffPayoutReceiptValidation.js', () => ({
  assertStaffPayoutAcknowledgedAmount: jest.fn(),
  assertStaffPayoutReceiptActor: jest.fn(),
  decodeStaffPayoutSignatureDataUrl: jest.fn(() => Buffer.from('signature')),
  validateStaffPayoutReceiptPhoto: jest.fn((photo) => photo),
}));

import RequiredAction from '../../models/RequiredAction.js';
import RequiredActionCompletion from '../../models/RequiredActionCompletion.js';
import StaffPayoutReceipt from '../../models/StaffPayoutReceipt.js';
import {
  deleteStoredStaffPayoutReceiptFile,
  storeStaffPayoutReceiptFile,
} from '../staffPayoutReceiptStorageService.js';
import { confirmStaffPayoutReceipt } from '../staffPayoutReceiptService.js';

const buildReceipt = (status: 'pending' | 'completed' | 'cancelled', update = jest.fn()) => ({
  id: 91,
  staffUserId: 184,
  requiredActionId: 47,
  status,
  rangeStart: '2026-08-01',
  rangeEnd: '2026-08-31',
  paidDate: '2026-09-01',
  paidByName: 'Pablo Cabrera',
  acceptanceVersion: 'v1',
  acceptanceText: 'I confirm this payment.',
  items: [{
    id: 1,
    label: 'Reviews',
    amountMinor: 33_333,
    currencyCode: 'PLN',
  }],
  update,
});

const confirmationParams = {
  receiptId: 91,
  actionId: 47,
  actorId: 184,
  photo: {
    originalname: 'receipt.jpg',
    mimetype: 'image/jpeg',
    buffer: Buffer.from('photo'),
  } as Express.Multer.File,
  signature: { strokes: [[{ x: 1, y: 1 }]] },
  acknowledgedAmount: '333.33',
  acknowledgedAt: '2026-09-01T18:30:00.000Z',
  confirmationIp: '127.0.0.1',
  confirmationUserAgent: 'test-agent',
};

describe('staff payout receipt confirmation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (storeStaffPayoutReceiptFile as jest.Mock)
      .mockResolvedValueOnce({ id: 501 })
      .mockResolvedValueOnce({ id: 502 });
    (deleteStoredStaffPayoutReceiptFile as jest.Mock).mockResolvedValue(undefined);
  });

  it('treats a concurrent replay as success and removes only its duplicate uploads', async () => {
    const pendingReceipt = buildReceipt('pending');
    const completedReceipt = buildReceipt('completed');
    (StaffPayoutReceipt.findByPk as jest.Mock)
      .mockResolvedValueOnce(pendingReceipt)
      .mockResolvedValueOnce(completedReceipt);

    await expect(confirmStaffPayoutReceipt(confirmationParams)).resolves.toMatchObject({
      id: 91,
      amountMinor: 33_333,
      currency: 'PLN',
    });

    expect(storeStaffPayoutReceiptFile).toHaveBeenCalledTimes(2);
    expect(deleteStoredStaffPayoutReceiptFile).toHaveBeenCalledTimes(2);
    expect(pendingReceipt.update).not.toHaveBeenCalled();
    expect(RequiredActionCompletion.findOrCreate).not.toHaveBeenCalled();
    expect(RequiredAction.update).not.toHaveBeenCalled();
  });

  it('atomically reuses the prompted workflow completion row when confirmation succeeds', async () => {
    const pendingReceipt = buildReceipt('pending');
    const lockedUpdate = jest.fn().mockResolvedValue(undefined);
    const lockedReceipt = buildReceipt('pending', lockedUpdate);
    const completionUpdate = jest.fn().mockResolvedValue(undefined);
    (StaffPayoutReceipt.findByPk as jest.Mock)
      .mockResolvedValueOnce(pendingReceipt)
      .mockResolvedValueOnce(lockedReceipt);
    (RequiredActionCompletion.findOrCreate as jest.Mock).mockResolvedValue([
      { update: completionUpdate },
      false,
    ]);
    (RequiredAction.update as jest.Mock).mockResolvedValue([1]);

    await expect(confirmStaffPayoutReceipt(confirmationParams)).resolves.toMatchObject({
      id: 91,
      amountMinor: 33_333,
    });

    expect(RequiredActionCompletion.findOrCreate).toHaveBeenCalledWith(expect.objectContaining({
      where: { requiredActionId: 47, userId: 184 },
      transaction: mockTransaction,
    }));
    expect(completionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed', responseJson: expect.any(Object) }),
      { transaction: mockTransaction },
    );
    expect(lockedUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'completed',
        photoFileId: 501,
        signatureFileId: 502,
      }),
      { transaction: mockTransaction },
    );
    expect(deleteStoredStaffPayoutReceiptFile).not.toHaveBeenCalled();
  });

  it('returns an already completed receipt without uploading the photo again', async () => {
    (StaffPayoutReceipt.findByPk as jest.Mock).mockResolvedValue(buildReceipt('completed'));

    await expect(confirmStaffPayoutReceipt(confirmationParams)).resolves.toMatchObject({ id: 91 });

    expect(storeStaffPayoutReceiptFile).not.toHaveBeenCalled();
  });
});
