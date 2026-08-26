jest.mock('../../config/database.js', () => ({
  __esModule: true,
  default: { transaction: jest.fn(), query: jest.fn() },
}));
jest.mock('../../models/AuditLog.js', () => ({ __esModule: true, default: { create: jest.fn() } }));
jest.mock('../../models/RequiredAction.js', () => ({ __esModule: true, default: { create: jest.fn() } }));
jest.mock('../../models/ShiftAssignment.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn(), findByPk: jest.fn() },
}));
jest.mock('../../models/ShiftInstance.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/ShiftRole.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/ShiftType.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/StaffProfile.js', () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock('../../models/SwapRequest.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn(), findByPk: jest.fn(), create: jest.fn() },
}));
jest.mock('../../models/User.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn(), findByPk: jest.fn() },
}));
jest.mock('../../models/UserShiftRole.js', () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock('../../utils/logger.js', () => ({
  __esModule: true,
  default: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));
jest.mock('../configService.js', () => ({ getConfigValue: jest.fn() }));
jest.mock('../notificationService.js', () => ({ sendSchedulingNotification: jest.fn() }));

import ShiftAssignment from '../../models/ShiftAssignment';
import ShiftInstance from '../../models/ShiftInstance';
import SwapRequest from '../../models/SwapRequest';
import {
  listShiftChangeRequests,
  listShiftChangeRequestsForUser,
} from '../shiftRequestService';

type IncludeNode = {
  model?: unknown;
  as?: string;
  include?: IncludeNode[];
};

const getRequestIncludes = (callIndex: number): IncludeNode[] => {
  const options = (SwapRequest.findAll as jest.Mock).mock.calls[callIndex][0] as {
    include: IncludeNode[];
  };
  return options.include;
};

describe('shift-request Sequelize include construction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (SwapRequest.findAll as jest.Mock).mockResolvedValue([]);
  });

  it('uses reference-independent nested include trees for both assignment aliases', async () => {
    await listShiftChangeRequestsForUser(17);

    const includes = getRequestIncludes(0);
    const fromAssignment = includes.find((include) => include.as === 'fromAssignment');
    const toAssignment = includes.find((include) => include.as === 'toAssignment');

    expect(fromAssignment).toEqual(expect.objectContaining({
      model: ShiftAssignment,
      as: 'fromAssignment',
    }));
    expect(toAssignment).toEqual(expect.objectContaining({
      model: ShiftAssignment,
      as: 'toAssignment',
    }));
    expect(fromAssignment?.include).toBeDefined();
    expect(toAssignment?.include).toBeDefined();
    expect(fromAssignment?.include).not.toBe(toAssignment?.include);

    fromAssignment?.include?.forEach((fromChild, index) => {
      expect(fromChild).not.toBe(toAssignment?.include?.[index]);
    });

    const fromShiftInstance = fromAssignment?.include?.find((include) => include.as === 'shiftInstance');
    const toShiftInstance = toAssignment?.include?.find((include) => include.as === 'shiftInstance');
    expect(fromShiftInstance).toEqual(expect.objectContaining({ model: ShiftInstance }));
    expect(fromShiftInstance?.include).not.toBe(toShiftInstance?.include);
    expect(fromShiftInstance?.include?.[0]).not.toBe(toShiftInstance?.include?.[0]);
  });

  it('creates a fresh include graph for concurrent user and manager queries', async () => {
    await Promise.all([
      listShiftChangeRequestsForUser(17),
      listShiftChangeRequests({ status: 'pending_manager' }),
    ]);

    const userIncludes = getRequestIncludes(0);
    const managerIncludes = getRequestIncludes(1);

    expect(userIncludes).not.toBe(managerIncludes);
    userIncludes.forEach((userInclude, index) => {
      expect(userInclude).not.toBe(managerIncludes[index]);
      userInclude.include?.forEach((userChild, childIndex) => {
        expect(userChild).not.toBe(managerIncludes[index]?.include?.[childIndex]);
      });
    });
  });
});
