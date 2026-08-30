jest.mock('../../__mocks__/sequelizeModelStub', () => ({
  __esModule: true,
  default: { findByPk: jest.fn() },
}));

const activeTransaction = { id: 'staff-profile-delete-transaction' };

jest.mock('../../models/StaffProfile.js', () => ({
  __esModule: true,
  default: {
    sequelize: {
      transaction: jest.fn(async (work: (value: unknown) => Promise<unknown>) => (
        work(activeTransaction)
      )),
    },
    getAttributes: jest.fn(() => ({})),
    destroy: jest.fn(),
  },
}));
jest.mock('../../finance/models/FinanceVendor.js', () => ({
  __esModule: true,
  default: { count: jest.fn(), create: jest.fn() },
}));
jest.mock('../../finance/models/FinanceClient.js', () => ({
  __esModule: true,
  default: { count: jest.fn(), create: jest.fn() },
}));
jest.mock('../../services/staffEligibilityHistoryService.js', () => ({
  applyStaffProfileTypeChange: jest.fn(),
  closeStaffProfileTypeHistoryForDeletion: jest.fn(),
  StaffEligibilityHistoryError: class StaffEligibilityHistoryError extends Error {
    status: number;
    code: string;

    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));

import type { Response } from 'express';
import StaffProfile from '../../models/StaffProfile';
import {
  closeStaffProfileTypeHistoryForDeletion,
  StaffEligibilityHistoryError,
} from '../../services/staffEligibilityHistoryService';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest';
import { deleteStaffProfile } from '../staffProfileController';

const createResponse = () => {
  const response = {
    status: jest.fn(),
    json: jest.fn(),
    send: jest.fn(),
  };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  response.send.mockReturnValue(response);
  return response as unknown as Response & {
    status: jest.Mock;
    json: jest.Mock;
    send: jest.Mock;
  };
};

describe('deleteStaffProfile eligibility lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (closeStaffProfileTypeHistoryForDeletion as jest.Mock).mockResolvedValue({
      changed: true,
      periodAction: 'closed',
    });
    (StaffProfile.destroy as jest.Mock).mockResolvedValue(1);
  });

  it('closes the current staff-type period before deleting the profile in one transaction', async () => {
    const request = {
      params: { userId: '28' },
      body: { reason: 'Staff member offboarded' },
      authContext: { id: 7 },
    } as unknown as AuthenticatedRequest;
    const response = createResponse();

    await deleteStaffProfile(request, response);

    expect(closeStaffProfileTypeHistoryForDeletion).toHaveBeenCalledWith({
      userId: 28,
      actorId: 7,
      reason: 'Staff member offboarded',
      source: 'staff_profile_deletion',
      metadata: { profileDeleted: true },
      transaction: activeTransaction,
    });
    expect(StaffProfile.destroy).toHaveBeenCalledWith({
      where: { userId: 28 },
      transaction: activeTransaction,
    });
    expect(
      (closeStaffProfileTypeHistoryForDeletion as jest.Mock).mock.invocationCallOrder[0],
    ).toBeLessThan((StaffProfile.destroy as jest.Mock).mock.invocationCallOrder[0]);
    expect(response.status).toHaveBeenCalledWith(204);
    expect(response.send).toHaveBeenCalledTimes(1);
  });

  it('does not delete the profile when history cannot be closed', async () => {
    (closeStaffProfileTypeHistoryForDeletion as jest.Mock).mockRejectedValue(
      new StaffEligibilityHistoryError(
        409,
        'HISTORICAL_CHANGE_CONFLICT',
        'A later history change already exists.',
      ),
    );
    const request = {
      params: { userId: '28' },
      body: {},
      authContext: { id: 7 },
    } as unknown as AuthenticatedRequest;
    const response = createResponse();

    await deleteStaffProfile(request, response);

    expect(StaffProfile.destroy).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith([{
      message: 'A later history change already exists.',
      code: 'HISTORICAL_CHANGE_CONFLICT',
    }]);
  });
});
