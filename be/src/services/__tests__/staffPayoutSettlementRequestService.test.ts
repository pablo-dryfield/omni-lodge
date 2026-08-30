jest.mock('../../models/StaffPayoutSettlementRequest.js', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), create: jest.fn() },
}));

import StaffPayoutSettlementRequest from '../../models/StaffPayoutSettlementRequest.js';
import {
  assertStaffPayoutSettlementRequestBinding,
  createStaffPayoutSettlementRequestBinding,
} from '../staffPayoutSettlementRequestService.js';

describe('staff payout settlement request binding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (StaffPayoutSettlementRequest.findOne as jest.Mock).mockResolvedValue(null);
  });

  it('allows a request id that has not been persisted yet', async () => {
    await expect(assertStaffPayoutSettlementRequestBinding({
      staffUserId: 28,
      requestId: 'settlement_request_1234',
      payoutBatchKey: 'batch-a',
    })).resolves.toBeNull();
  });

  it('returns the immutable binding for an exact retry', async () => {
    const binding = { payoutBatchKey: 'batch-a' };
    (StaffPayoutSettlementRequest.findOne as jest.Mock).mockResolvedValue(binding);

    await expect(assertStaffPayoutSettlementRequestBinding({
      staffUserId: 28,
      requestId: 'settlement_request_1234',
      payoutBatchKey: 'batch-a',
    })).resolves.toBe(binding);
  });

  it('rejects reuse of a request id with edited payout details', async () => {
    (StaffPayoutSettlementRequest.findOne as jest.Mock).mockResolvedValue({
      payoutBatchKey: 'batch-a',
    });

    await expect(assertStaffPayoutSettlementRequestBinding({
      staffUserId: 28,
      requestId: 'settlement_request_1234',
      payoutBatchKey: 'batch-b',
    })).rejects.toMatchObject({ status: 409 });
  });

  it('passes the caller transaction and row lock to the binding lookup', async () => {
    const transaction = { LOCK: { UPDATE: 'UPDATE' } } as never;

    await assertStaffPayoutSettlementRequestBinding({
      staffUserId: 28,
      requestId: 'settlement_request_1234',
      payoutBatchKey: 'batch-a',
      transaction,
    });

    expect(StaffPayoutSettlementRequest.findOne).toHaveBeenCalledWith(expect.objectContaining({
      transaction,
      lock: 'UPDATE',
    }));
  });

  it('creates the binding in the settlement transaction', async () => {
    const transaction = {} as never;
    const created = { id: 41 };
    (StaffPayoutSettlementRequest.create as jest.Mock).mockResolvedValue(created);

    await expect(createStaffPayoutSettlementRequestBinding({
      staffUserId: 28,
      requestId: 'settlement_request_1234',
      payoutBatchKey: 'a'.repeat(64),
      actorId: 1,
      transaction,
    })).resolves.toBe(created);

    expect(StaffPayoutSettlementRequest.create).toHaveBeenCalledWith({
      staffUserId: 28,
      requestId: 'settlement_request_1234',
      payoutBatchKey: 'a'.repeat(64),
      createdBy: 1,
    }, { transaction });
  });
});
