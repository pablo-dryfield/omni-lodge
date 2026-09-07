jest.mock('../../__mocks__/sequelizeModelStub', () => ({
  __esModule: true,
  default: { findByPk: jest.fn(), findAll: jest.fn() },
}));
jest.mock('../../models/ShiftRole.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../models/StaffProfile.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/RequiredAction.js', () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock('../../models/RequiredActionCompletion.js', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), create: jest.fn(), findOrCreate: jest.fn(), findAll: jest.fn() },
}));
jest.mock('../../models/CerebroAcknowledgement.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/CerebroEntry.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/CerebroQuiz.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/CerebroQuizAttempt.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../finance/models/FinanceManagementRequest.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../finance/services/managementRequestService.js', () => ({ applyManagementRequest: jest.fn() }));
jest.mock('../../finance/services/auditLogService.js', () => ({ recordFinanceAuditLog: jest.fn() }));
jest.mock('../../services/scheduleService.js', () => ({
  decideShiftChangeRequest: jest.fn(),
  listShiftChangeRequests: jest.fn(),
  listShiftChangeRequestsForUser: jest.fn(),
  respondToShiftChangeRequest: jest.fn(),
}));
jest.mock('../../services/shiftRequestRulesService.js', () => ({ parseStrictBoolean: jest.fn() }));
jest.mock('../../routes/schedulingRoles.js', () => ({ isSchedulingManagerRole: jest.fn() }));
jest.mock('../../services/profilePhotoStorageService.js', () => ({
  deleteProfilePhoto: jest.fn(),
  storeProfilePhoto: jest.fn(),
}));
jest.mock('../../services/bookings/customerEmailActionRules.js', () => ({
  customerEmailActionTargetsUser: jest.fn(),
  shouldCloseCustomerEmailActionForAll: jest.fn(),
}));
jest.mock('../../services/staffPayoutReceiptService.js', () => ({
  confirmStaffPayoutReceipt: jest.fn(),
  getStaffPayoutReceiptActionPayload: jest.fn(),
}));
jest.mock('../../utils/logger.js', () => ({ __esModule: true, default: { error: jest.fn() } }));
jest.mock('../userController.js', () => ({
  recordUserAuditLog: jest.fn(),
  sendApprovedUserBadgeToPrint: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/volunteerStayService.js', () => ({
  ensureDefaultVolunteerStay: jest.fn(),
}));

import type { Response } from 'express';
import UserModelStub from '../../__mocks__/sequelizeModelStub.js';
import RequiredAction from '../../models/RequiredAction.js';
import RequiredActionCompletion from '../../models/RequiredActionCompletion.js';
import { ensureDefaultVolunteerStay } from '../../services/volunteerStayService.js';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest.js';
import { completeProfileFieldsAction } from '../requiredActionController.js';
import { approveUserRequest } from '../requestController.js';

const userAndTypeModel = UserModelStub as unknown as {
  findByPk: jest.Mock;
};

const response = () => {
  const value = { status: jest.fn(), json: jest.fn() };
  value.status.mockReturnValue(value);
  value.json.mockReturnValue(value);
  return value as unknown as Response & { status: jest.Mock; json: jest.Mock };
};

describe('automatic volunteer stay lifecycle hooks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (ensureDefaultVolunteerStay as jest.Mock).mockResolvedValue({ status: 'created', stayId: 74 });
  });

  it('attempts creation immediately after a manager approves the volunteer account', async () => {
    const user = {
      id: 42,
      userTypeId: 4,
      approved: false,
      status: true,
      save: jest.fn(),
      toJSON: jest.fn(() => ({ id: 42, approved: true, status: true, userTypeId: 4 })),
    };
    userAndTypeModel.findByPk
      .mockResolvedValueOnce(user)
      .mockResolvedValueOnce({ id: 4, name: 'Guide', slug: 'pub-crawl-guide' });
    const res = response();

    await approveUserRequest({
      params: { id: '42' },
      body: { userTypeId: 4 },
      authContext: { id: 7 },
    } as unknown as AuthenticatedRequest, res);

    expect(user.save).toHaveBeenCalledTimes(1);
    expect(ensureDefaultVolunteerStay).toHaveBeenCalledWith({
      userId: 42,
      actorId: 7,
      source: 'user_approval_request',
    });
    expect(user.save.mock.invocationCallOrder[0]).toBeLessThan(
      (ensureDefaultVolunteerStay as jest.Mock).mock.invocationCallOrder[0],
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('attempts creation before completing a request that supplies missing stay dates', async () => {
    const action = {
      id: 18,
      status: true,
      type: 'profile_fields',
      payload: { fields: ['arrivalDate', 'departureDate'] },
      requiresSignature: false,
    };
    const user = {
      id: 42,
      arrivalDate: null,
      departureDate: null,
      profilePhotoPath: null,
      profilePhotoUrl: null,
      update: jest.fn(),
    };
    (RequiredAction.findByPk as jest.Mock).mockResolvedValue(action);
    userAndTypeModel.findByPk.mockResolvedValue(user);
    (RequiredActionCompletion.findOne as jest.Mock).mockResolvedValue(null);
    (RequiredActionCompletion.create as jest.Mock).mockResolvedValue({ id: 91 });
    const res = response();

    await completeProfileFieldsAction({
      params: { id: '18' },
      body: { values: { arrivalDate: '2026-10-01', departureDate: '2026-11-01' } },
      authContext: { id: 42 },
    } as unknown as AuthenticatedRequest, res);

    expect(user.update).toHaveBeenCalledWith({
      arrivalDate: '2026-10-01',
      departureDate: '2026-11-01',
    });
    expect(ensureDefaultVolunteerStay).toHaveBeenCalledWith({
      userId: 42,
      actorId: 42,
      source: 'required_profile_fields',
    });
    expect(user.update.mock.invocationCallOrder[0]).toBeLessThan(
      (ensureDefaultVolunteerStay as jest.Mock).mock.invocationCallOrder[0],
    );
    expect((ensureDefaultVolunteerStay as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      (RequiredActionCompletion.create as jest.Mock).mock.invocationCallOrder[0],
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
