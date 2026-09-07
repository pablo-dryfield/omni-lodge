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
jest.mock('../../services/volunteerStayService.js', () => ({
  ensureDefaultVolunteerStay: jest.fn(),
}));

import type { Response } from 'express';
import StaffProfile from '../../models/StaffProfile';
import { applyStaffProfileTypeChange } from '../../services/staffEligibilityHistoryService';
import { ensureDefaultVolunteerStay } from '../../services/volunteerStayService';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest';
import { createStaffProfile, updateStaffProfile } from '../staffProfileController';

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
    (ensureDefaultVolunteerStay as jest.Mock).mockResolvedValue({ status: 'skipped', stayId: null });
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
    expect(ensureDefaultVolunteerStay).not.toHaveBeenCalled();
  });

  it('attempts default stay creation for an active Volunteer in the same transaction', async () => {
    const createdProfile = {
      userId: 28,
      staffType: 'volunteer',
      livesInAccom: false,
      active: true,
      financeVendorId: null,
      financeClientId: null,
    };
    (StaffProfile.create as jest.Mock).mockResolvedValue(createdProfile);
    (ensureDefaultVolunteerStay as jest.Mock).mockResolvedValue({ status: 'created', stayId: 72 });
    const request = {
      body: { userId: 28, staffType: 'volunteer' },
      authContext: { id: 7 },
    } as unknown as AuthenticatedRequest;
    const response = createResponse();

    await createStaffProfile(request, response);

    const activeTransaction = (StaffProfile.create as jest.Mock).mock.calls[0][1].transaction;
    expect(ensureDefaultVolunteerStay).toHaveBeenCalledWith({
      userId: 28,
      actorId: 7,
      source: 'staff_profile_creation',
      transaction: activeTransaction,
      allowUnapproved: true,
    });
    expect(response.status).toHaveBeenCalledWith(201);
  });

  it('retries default stay creation when an existing profile is updated', async () => {
    const existingProfile = {
      userId: 28,
      staffType: 'volunteer',
      active: false,
      update: jest.fn(),
    };
    const refreshedProfile = {
      get: jest.fn(() => ({
        userId: 28,
        staffType: 'volunteer',
        livesInAccom: false,
        active: true,
        financeVendorId: null,
        financeClientId: null,
        user: { firstName: 'Future', lastName: 'Guide', email: 'future@example.test', status: true },
      })),
    };
    (StaffProfile.findByPk as jest.Mock)
      .mockResolvedValueOnce(existingProfile)
      .mockResolvedValueOnce(refreshedProfile);
    const request = {
      params: { userId: '28' },
      body: { active: true },
      authContext: { id: 7 },
    } as unknown as AuthenticatedRequest;
    const response = createResponse();

    await updateStaffProfile(request, response);

    const activeTransaction = existingProfile.update.mock.calls[0][1].transaction;
    expect(existingProfile.update).toHaveBeenCalledWith({ active: true }, { transaction: activeTransaction });
    expect(ensureDefaultVolunteerStay).toHaveBeenCalledWith({
      userId: 28,
      actorId: 7,
      source: 'staff_profile_update',
      transaction: activeTransaction,
      allowUnapproved: true,
    });
    expect(response.status).toHaveBeenCalledWith(200);
  });
});
