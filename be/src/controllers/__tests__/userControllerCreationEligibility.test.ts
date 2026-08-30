jest.mock('../../__mocks__/sequelizeModelStub', () => ({
  __esModule: true,
  default: {
    sequelize: {
      transaction: jest.fn(async (work: (value: unknown) => Promise<unknown>) => (
        work({ id: 'user-signup-transaction' })
      )),
    },
    findOne: jest.fn(),
    create: jest.fn(),
    destroy: jest.fn(),
    getAttributes: jest.fn(() => ({})),
  },
}));
jest.mock('../../models/AuditLog.js', () => ({
  __esModule: true,
  default: { create: jest.fn() },
}));
jest.mock('../../models/StaffProfile.js', () => ({
  __esModule: true,
  default: { create: jest.fn() },
}));
jest.mock('../../models/ShiftRole.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/UserTypeMembershipPeriod.js', () => ({
  __esModule: true,
  default: { count: jest.fn() },
}));
jest.mock('../../models/UserShiftRoleMembershipPeriod.js', () => ({
  __esModule: true,
  default: { count: jest.fn() },
}));
jest.mock('../../models/StaffProfileTypePeriod.js', () => ({
  __esModule: true,
  default: { count: jest.fn() },
}));
jest.mock('../../services/profilePhotoStorageService.js', () => ({
  deleteProfilePhoto: jest.fn(),
  storeProfilePhoto: jest.fn(),
  openProfilePhotoStream: jest.fn(),
}));
jest.mock('../../services/badgePrintService.js', () => ({
  buildBadgeCampaignSourceName: jest.fn(),
  resolveBadgeTemplateVariant: jest.fn(),
  sendBadgeToPrint: jest.fn(),
}));
jest.mock('../../services/affiliateService.js', () => ({
  upsertBadgeAffiliateAssignment: jest.fn(),
}));
jest.mock('../../services/staffEligibilityHistoryService.js', () => ({
  applyStaffProfileTypeChange: jest.fn(),
  applyUserShiftRolesChange: jest.fn(),
  applyUserTypeChange: jest.fn(),
  StaffEligibilityHistoryError: class StaffEligibilityHistoryError extends Error {},
}));
jest.mock('../../utils/logger.js', () => ({
  __esModule: true,
  default: { warn: jest.fn(), error: jest.fn() },
}));
jest.mock('bcryptjs', () => ({
  genSalt: jest.fn().mockResolvedValue('salt'),
  hash: jest.fn().mockResolvedValue('hashed-password'),
}));

import type { Response } from 'express';
import ShiftRole from '../../models/ShiftRole';
import StaffProfile from '../../models/StaffProfile';
import StaffProfileTypePeriod from '../../models/StaffProfileTypePeriod';
import UserShiftRoleMembershipPeriod from '../../models/UserShiftRoleMembershipPeriod';
import UserTypeMembershipPeriod from '../../models/UserTypeMembershipPeriod';
import {
  applyStaffProfileTypeChange,
  applyUserShiftRolesChange,
  applyUserTypeChange,
} from '../../services/staffEligibilityHistoryService';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest';
import { deleteUser, registerUser } from '../userController';

const userAndTypeModel = jest.requireMock('../../__mocks__/sequelizeModelStub').default as {
  findOne: jest.Mock;
  create: jest.Mock;
  destroy: jest.Mock;
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

describe('registerUser eligibility initialization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    userAndTypeModel.findOne
      .mockResolvedValueOnce({ id: 4, slug: 'guide' })
      .mockResolvedValueOnce(null);
    (applyUserTypeChange as jest.Mock).mockResolvedValue({ changed: true, periodId: 101 });
    (applyStaffProfileTypeChange as jest.Mock).mockResolvedValue({ changed: true, periodId: 102 });
    (applyUserShiftRolesChange as jest.Mock).mockResolvedValue({ changed: true, next: [3, 5] });
    (ShiftRole.findAll as jest.Mock).mockResolvedValue([
      { id: 3, slug: 'guide' },
      { id: 5, slug: 'host' },
    ]);
  });

  it('initializes user-type and staff-type periods inside the signup transaction', async () => {
    const createdUser = {
      id: 28,
      username: 'aimee',
      email: 'aimee@example.test',
      userTypeId: 4,
    };
    userAndTypeModel.create.mockResolvedValue(createdUser);
    (StaffProfile.create as jest.Mock).mockResolvedValue({
      userId: 28,
      staffType: 'long_term',
    });
    const request = {
      body: {
        username: 'aimee',
        email: 'aimee@example.test',
        password: 'secret',
        firstName: 'Aimee',
        lastName: 'Kelly',
        staffType: 'long_term',
        shiftRoleIds: [5, 3],
      },
    } as unknown as AuthenticatedRequest;
    const response = createResponse();

    await registerUser(request, response);

    expect(response.json).toHaveBeenCalledWith([createdUser]);
    const activeTransaction = (applyUserTypeChange as jest.Mock).mock.calls[0][0].transaction;
    expect(applyUserTypeChange).toHaveBeenCalledWith({
      userId: 28,
      userTypeId: 4,
      actorId: null,
      source: 'user_signup',
      metadata: { initialization: true },
      transaction: activeTransaction,
    });
    expect(StaffProfile.create).toHaveBeenCalledWith({
      userId: 28,
      staffType: 'long_term',
      livesInAccom: false,
      active: true,
    }, { transaction: activeTransaction });
    expect(applyStaffProfileTypeChange).toHaveBeenCalledWith({
      userId: 28,
      staffType: 'long_term',
      actorId: null,
      source: 'user_signup',
      metadata: { initialization: true },
      transaction: activeTransaction,
    });
    expect(applyUserShiftRolesChange).toHaveBeenCalledWith({
      userId: 28,
      shiftRoleIds: [5, 3],
      actorId: null,
      source: 'user_signup',
      metadata: { initialization: true },
      transaction: activeTransaction,
    });
    expect(response.status).toHaveBeenCalledWith(201);
  });
});

describe('deleteUser payroll history protection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (UserTypeMembershipPeriod.count as jest.Mock).mockResolvedValue(0);
    (UserShiftRoleMembershipPeriod.count as jest.Mock).mockResolvedValue(0);
    (StaffProfileTypePeriod.count as jest.Mock).mockResolvedValue(0);
    userAndTypeModel.destroy.mockResolvedValue(1);
  });

  it('requires deactivation when immutable payroll eligibility history exists', async () => {
    (UserTypeMembershipPeriod.count as jest.Mock).mockResolvedValue(1);
    const request = { params: { id: '28' } } as unknown as AuthenticatedRequest;
    const response = createResponse();

    await deleteUser(request, response);

    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith([{
      message: 'This user has payroll eligibility history and cannot be deleted. Deactivate the user instead.',
    }]);
    expect(userAndTypeModel.destroy).not.toHaveBeenCalled();
  });
});
