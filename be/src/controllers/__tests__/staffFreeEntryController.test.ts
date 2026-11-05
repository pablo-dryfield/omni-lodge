import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest';
import { getStaffFreeAccount, checkInStaffFree, getStaffFreeOverview } from '../../services/staffFreeEntryService';
import { myStaffFreeAccount, addStaffFreeEntry } from '../staffFreeEntryController';

jest.mock('../../services/staffFreeEntryService.js', () => ({
  getStaffFreeAccount: jest.fn(), getStaffFreeHistory: jest.fn(), getStaffFreeOverview: jest.fn(),
  checkInStaffFree: jest.fn(), cancelStaffFreeEntry: jest.fn(),
}));
jest.mock('../../utils/logger.js', () => ({ __esModule: true, default: { error: jest.fn() } }));

const response = () => {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res as unknown as Response;
};

beforeEach(() => jest.resetAllMocks());

it('uses only the signed-in user, ignoring supplied target IDs for another staff member', async () => {
  (getStaffFreeAccount as jest.Mock).mockResolvedValue({ used: 1 });
  const res = response();
  await myStaffFreeAccount({ authContext: { id: 7 }, query: { userId: '99' }, params: { userId: '99' }, body: { userId: 99 } } as unknown as AuthenticatedRequest, res);
  expect(getStaffFreeAccount).toHaveBeenCalledWith(7);
  expect(res.json).toHaveBeenCalledWith({ used: 1 });
});

it('rejects requests without an authenticated account', async () => {
  const res = response();
  await myStaffFreeAccount({ query: { userId: '7' } } as unknown as AuthenticatedRequest, res);
  expect(res.status).toHaveBeenCalledWith(401);
  expect(getStaffFreeAccount).not.toHaveBeenCalled();
});

it('accepts management as an expected benefit and delegates eligibility to the service', async () => {
  (getStaffFreeOverview as jest.Mock).mockResolvedValue({ entries: [] });
  const res = response();
  await addStaffFreeEntry({ authContext: { id: 99 }, params: { id: '1' }, body: { userId: 7, expectedBenefit: 'management' } } as unknown as AuthenticatedRequest, res);
  expect(checkInStaffFree).toHaveBeenCalledWith(1, 7, 99, undefined, 'management');
  expect(res.json).toHaveBeenCalledWith({ entries: [] });
});
