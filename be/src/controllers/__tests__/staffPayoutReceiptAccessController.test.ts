jest.mock('../../services/staffPayoutReceiptAccessService.js', () => ({
  assertStaffPayoutReceiptAccessState: jest.fn(),
  exchangeStaffPayoutReceiptCredentials: jest.fn(),
}));
jest.mock('../../services/staffPayoutReceiptService.js', () => ({
  confirmStaffPayoutReceipt: jest.fn(),
  getStaffPayoutReceiptActionPayload: jest.fn(),
}));

import type { Response } from 'express';
import { confirmStaffPayoutReceipt } from '../../services/staffPayoutReceiptService';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest';
import { confirmStaffPayoutReceiptAccess } from '../staffPayoutReceiptAccessController';

describe('staff payout receipt-only confirmation controller', () => {
  it('derives actor, receipt, and action ids from the scoped token context', async () => {
    (confirmStaffPayoutReceipt as jest.Mock).mockResolvedValue({ id: 91 });
    const photo = { originalname: 'receipt.jpg' } as Express.Multer.File;
    const req = {
      receiptAccess: {
        userId: 28,
        receiptId: 91,
        actionId: 101,
        tokenId: 'receipt-token',
        expiresAt: 1_800_000_000,
      },
      body: {
        actionId: 999,
        acknowledgedAmount: '1832.30',
        acknowledgedAt: '2026-08-30T12:00:00.000Z',
        signature: '{"dataUrl":"data:image/png;base64,abc"}',
      },
      file: photo,
      ip: '127.0.0.1',
      get: jest.fn(() => 'test-agent'),
    } as unknown as AuthenticatedRequest;
    const res = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    } as unknown as Response & {
      setHeader: jest.Mock;
      status: jest.Mock;
      json: jest.Mock;
    };

    await confirmStaffPayoutReceiptAccess(req, res);

    expect(confirmStaffPayoutReceipt).toHaveBeenCalledWith(expect.objectContaining({
      receiptId: 91,
      actionId: 101,
      actorId: 28,
      photo,
    }));
    expect(confirmStaffPayoutReceipt).not.toHaveBeenCalledWith(
      expect.objectContaining({ actionId: 999 }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
