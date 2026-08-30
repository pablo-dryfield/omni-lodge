jest.mock('../../__mocks__/sequelizeModelStub', () => ({
  __esModule: true,
  default: { findByPk: jest.fn() },
}));

jest.mock('../../models/StaffProfile.js', () => ({
  __esModule: true,
  default: {
    sequelize: {
      transaction: jest.fn(async (work: (value: unknown) => Promise<unknown>) => (
        work({ id: 'staff-profile-create-transaction' })
      )),
    },
    getAttributes: jest.fn(() => ({})),
    findByPk: jest.fn(),
    create: jest.fn(),
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
  StaffEligibilityHistoryError: class StaffEligibilityHistoryError extends Error {},
}));

import type { Response } from 'express';
import StaffProfile from '../../models/StaffProfile';
import { applyStaffProfileTypeChange } from '../../services/staffEligibilityHistoryService';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest';
import { createStaffProfile } from '../staffProfileController';

const userModel = jest.requireMock('../../__mocks__/sequelizeModelStub').default as {
  findByPk: jest.Mock;
};

const createResponse = () => {
  const response = {
    status: jest.fn(),
    json: jest.fn(),
  };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response as unknown as Response & {
    status: jest.Mock;
    json: jest.Mock;
  };
};

describe('createStaffProfile eligibility initialization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    userModel.findByPk.mockResolvedValue({ id: 28 });
    (StaffProfile.findByPk as jest.Mock).mockResolvedValue(null);
    (applyStaffProfileTypeChange as jest.Mock).mockResolvedValue({ changed: true, periodId: 91 });
  });

  it('creates the profile and its initial staff-type period in one transaction', async () => {
    const createdProfile = {
      userId: 28,
      staffType: 'long_term',
      livesInAccom: false,
      active: true,
      financeVendorId: null,
      financeClientId: null,
    };
    (StaffProfile.create as jest.Mock).mockResolvedValue(createdProfile);
    const request = {
      body: { userId: 28, staffType: 'long_term' },
      authContext: { id: 7 },
    } as unknown as AuthenticatedRequest;
    const response = createResponse();

    await createStaffProfile(request, response);

    expect(response.json).toHaveBeenCalledWith([createdProfile]);
    expect(StaffProfile.create).toHaveBeenCalledWith(createdProfile, {
      transaction: expect.any(Object),
    });
    const activeTransaction = (StaffProfile.create as jest.Mock).mock.calls[0][1].transaction;
    expect(applyStaffProfileTypeChange).toHaveBeenCalledWith({
      userId: 28,
      staffType: 'long_term',
      actorId: 7,
      source: 'staff_profile_creation',
      metadata: { initialization: true },
      transaction: activeTransaction,
    });
    expect(response.status).toHaveBeenCalledWith(201);
  });
});
