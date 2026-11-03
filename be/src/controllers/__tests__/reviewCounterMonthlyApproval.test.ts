import { Op } from 'sequelize';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest';

jest.mock('../../models/ReviewCounter.js', () => ({ __esModule: true, default: { findAll: jest.fn(async () => []) } }));
jest.mock('../../models/ReviewCounterEntry.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/ReviewCounterMonthlyApproval.js', () => ({ __esModule: true, default: { findAll: jest.fn(), findOne: jest.fn(), create: jest.fn() } }));
jest.mock('../../models/ReviewArchive.js', () => ({ __esModule: true, default: { findAll: jest.fn(async () => []) } }));
jest.mock('../../models/ReviewAssignment.js', () => ({ __esModule: true, default: { findAll: jest.fn(async () => []) } }));
jest.mock('../../models/ReviewManualCredit.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../models/ReviewMonthLock.js', () => ({ __esModule: true, default: { findOne: jest.fn(async () => null) } }));
jest.mock('../../models/CompensationComponentAssignment.js', () => ({ __esModule: true, default: { findAll: jest.fn(async () => []) } }));
jest.mock('../../models/CompensationComponent.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/StaffProfile.js', () => ({ __esModule: true, default: { findAll: jest.fn(async () => []) } }));
jest.mock('../../__mocks__/sequelizeModelStub', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../models/UserShiftRole.js', () => ({ __esModule: true, default: { findAll: jest.fn(async () => []) } }));

import ReviewCounterMonthlyApproval from '../../models/ReviewCounterMonthlyApproval.js';
import ReviewManualCredit from '../../models/ReviewManualCredit.js';
import { updateReviewCounterMonthlyApproval } from '../reviewCounterController.js';
const userFindAll = jest.requireMock('../../__mocks__/sequelizeModelStub').default.findAll as jest.Mock;

describe('monthly extra-base-day approval', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('approves extra days with no-name, bad, and malformed manual credits in the month', async () => {
    (ReviewManualCredit.findAll as jest.Mock).mockResolvedValue([
      { category: 'staff', userId: 101, platform: 'google', credit: '1.0000' },
      { category: 'no_name', userId: null, platform: 'getyourguide', credit: '1.0000' },
      { category: 'bad', userId: null, platform: 'google', credit: '1.0000' },
      { category: 'bad', userId: 101, platform: 'google', credit: '5.0000' },
      { category: 'staff', userId: NaN, platform: 'google', credit: '2.0000' },
      { category: 'staff', userId: 0, platform: 'google', credit: '2.0000' },
    ]);
    userFindAll.mockImplementation(async ({ where }) => {
      expect(where.id[Op.in]).toEqual([101]);
      return [{ id: 101, firstName: 'Guide', lastName: 'Example', userTypeId: null }];
    });
    let approval: Record<string, unknown> | null = null;
    (ReviewCounterMonthlyApproval.findAll as jest.Mock).mockImplementation(async () => approval ? [approval] : []);
    (ReviewCounterMonthlyApproval.findOne as jest.Mock).mockResolvedValue(null);
    (ReviewCounterMonthlyApproval.create as jest.Mock).mockImplementation(async (values) => { approval = values; return values; });
    const req = { params: { userId: '101' }, body: { periodStart: '2026-10-01', baseOverrideApproved: true }, authContext: { id: 1 } } as unknown as AuthenticatedRequest;
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    await updateReviewCounterMonthlyApproval(req, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(ReviewManualCredit.findAll).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ category: 'staff', userId: { [Op.ne]: null } }),
    }));
    expect(ReviewCounterMonthlyApproval.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 101, baseOverrideApproved: true, baseOverrideApprovedBy: 1 }));
    const staff = res.json.mock.calls[0][0][0].data[0].staff[0];
    expect(staff.totalReviews).toBe(1);
    expect(staff.baseOverrideApproval.approved).toBe(true);
  });

  it.each(['NaN', '0', '-1', '1.5'])('rejects invalid subject id %s before any lookup', async userId => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await updateReviewCounterMonthlyApproval({ params: { userId } } as unknown as AuthenticatedRequest, res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(ReviewCounterMonthlyApproval.create).not.toHaveBeenCalled();
    expect(ReviewManualCredit.findAll).not.toHaveBeenCalled();
  });
});
