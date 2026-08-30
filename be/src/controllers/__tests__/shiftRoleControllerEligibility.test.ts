jest.mock('../../__mocks__/sequelizeModelStub', () => ({
  __esModule: true,
  default: { findByPk: jest.fn() },
}));
jest.mock('../../models/ShiftRole.js', () => ({
  __esModule: true,
  default: { count: jest.fn() },
}));
jest.mock('../../models/UserShiftRole.js', () => ({
  __esModule: true,
  default: {
    destroy: jest.fn(),
    bulkCreate: jest.fn(),
  },
}));
jest.mock('../../models/StaffProfile.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../services/staffEligibilityHistoryService.js', () => ({
  applyUserShiftRolesChange: jest.fn(),
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
import ShiftRole from '../../models/ShiftRole';
import UserShiftRole from '../../models/UserShiftRole';
import {
  applyUserShiftRolesChange,
  StaffEligibilityHistoryError,
} from '../../services/staffEligibilityHistoryService';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest';
import { updateUserShiftRoles } from '../shiftRoleController';

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

describe('updateUserShiftRoles effective-dated integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    userModel.findByPk.mockResolvedValue({ id: 24 });
    (ShiftRole.count as jest.Mock).mockResolvedValue(2);
  });

  it('delegates normalized roles and command metadata to the atomic history service', async () => {
    (applyUserShiftRolesChange as jest.Mock).mockResolvedValue({
      next: [3, 5],
      applied: [3, 5],
    });
    const request = {
      params: { userId: '24' },
      body: {
        roleIds: ['5', 3, 5, 'invalid'],
        effectiveDate: '2026-08-01',
        reason: 'Role eligibility correction',
      },
      authContext: { id: 9 },
    } as unknown as AuthenticatedRequest;
    const response = createResponse();

    await updateUserShiftRoles(request, response);

    expect(applyUserShiftRolesChange).toHaveBeenCalledWith({
      userId: 24,
      shiftRoleIds: [5, 3],
      effectiveDate: '2026-08-01',
      actorId: 9,
      reason: 'Role eligibility correction',
    });
    expect(UserShiftRole.destroy).not.toHaveBeenCalled();
    expect(UserShiftRole.bulkCreate).not.toHaveBeenCalled();
    expect(response.json).toHaveBeenCalledWith([{ userId: 24, roleIds: [3, 5] }]);
  });

  it('returns the history service validation status and code', async () => {
    (applyUserShiftRolesChange as jest.Mock).mockRejectedValue(
      new StaffEligibilityHistoryError(
        400,
        'FUTURE_EFFECTIVE_DATE_UNSUPPORTED',
        'Future-dated staff eligibility changes are not supported yet.',
      ),
    );
    const request = {
      params: { userId: '24' },
      body: { roleIds: [3, 5], effectiveDate: '2027-01-01' },
      authContext: { id: 9 },
    } as unknown as AuthenticatedRequest;
    const response = createResponse();

    await updateUserShiftRoles(request, response);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith([{
      message: 'Future-dated staff eligibility changes are not supported yet.',
      code: 'FUTURE_EFFECTIVE_DATE_UNSUPPORTED',
    }]);
  });
});
