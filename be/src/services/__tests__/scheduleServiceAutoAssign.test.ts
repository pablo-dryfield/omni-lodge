jest.mock('../../config/database.js', () => ({
  __esModule: true,
  default: { transaction: jest.fn() },
}));
jest.mock('../../models/ScheduleWeek.js', () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock('../../models/ShiftTemplate.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/ShiftType.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/ShiftTypeProduct.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/ShiftInstance.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../models/ShiftAssignment.js', () => ({
  __esModule: true,
  default: { create: jest.fn(), destroy: jest.fn(), update: jest.fn() },
}));
jest.mock('../../models/Availability.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../models/StaffProfile.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../models/User.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/Export.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/SwapRequest.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/AuditLog.js', () => ({ __esModule: true, default: { create: jest.fn() } }));
jest.mock('../../models/ShiftRole.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/UserShiftRole.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../models/Product.js', () => ({ __esModule: true, default: {} }));
jest.mock('../renderSchedule.js', () => ({ renderScheduleHTML: jest.fn() }));
jest.mock('../googleDrive.js', () => ({ ensureFolderPath: jest.fn(), uploadBuffer: jest.fn() }));
jest.mock('../notificationService.js', () => ({ sendSchedulingNotification: jest.fn() }));
jest.mock('../configService.js', () => ({ getConfigValue: jest.fn(() => undefined) }));
jest.mock('../shiftRequestService.js', () => ({
  cancelShiftChangeRequest: jest.fn(),
  cancelSwapRequest: jest.fn(),
  createShiftChangeRequest: jest.fn(),
  createSwapRequest: jest.fn(),
  decideShiftChangeRequest: jest.fn(),
  listShiftChangeRequests: jest.fn(),
  listShiftChangeRequestsForUser: jest.fn(),
  listSwapsByStatus: jest.fn(),
  listSwapsForUser: jest.fn(),
  respondToShiftChangeRequest: jest.fn(),
  swapManagerDecision: jest.fn(),
  swapPartnerResponse: jest.fn(),
}));
jest.mock('puppeteer', () => ({ __esModule: true, default: { launch: jest.fn() } }));

import { Op } from 'sequelize';
import sequelize from '../../config/database.js';
import AuditLog from '../../models/AuditLog.js';
import Availability from '../../models/Availability.js';
import ScheduleWeek from '../../models/ScheduleWeek.js';
import ShiftAssignment from '../../models/ShiftAssignment.js';
import ShiftInstance from '../../models/ShiftInstance.js';
import StaffProfile from '../../models/StaffProfile.js';
import UserShiftRole from '../../models/UserShiftRole.js';
import { autoAssignWeek } from '../scheduleService.js';

const transaction = { id: 'auto-assign-transaction' };
const volunteer = {
  userId: 17,
  staffType: 'volunteer',
  livesInAccom: true,
  active: true,
  user: {
    id: 17,
    firstName: 'Natalie',
    lastName: 'Looper',
    status: true,
    arrivalDate: '2026-09-01',
    departureDate: '2026-10-31',
  },
};

const buildShift = (assignment: Record<string, unknown>) => ({
  id: 88,
  scheduleWeekId: 9,
  shiftTypeId: 7,
  shiftTemplateId: 4,
  date: '2026-09-14',
  timeStart: '12:00',
  timeEnd: '14:00',
  capacity: 1,
  requiredRoles: [{ shiftRoleId: 3, role: 'Guide', required: 1 }],
  assignments: [assignment],
  template: { managerCoversTeam: false, defaultRoles: [] },
});

describe('schedule auto-assignment reconciliation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (sequelize.transaction as jest.Mock).mockImplementation(async (callback) => callback(transaction));
    (ScheduleWeek.findByPk as jest.Mock).mockResolvedValue({ id: 9, state: 'collecting' });
    (StaffProfile.findAll as jest.Mock).mockResolvedValue([volunteer]);
    (UserShiftRole.findAll as jest.Mock).mockResolvedValue([{ userId: 17, shiftRoleId: 3 }]);
    (Availability.findAll as jest.Mock).mockResolvedValue([]);
    (ShiftAssignment.create as jest.Mock).mockImplementation(async (values) => ({ id: 999, ...values }));
    (ShiftAssignment.destroy as jest.Mock).mockResolvedValue(1);
    (ShiftAssignment.update as jest.Mock).mockResolvedValue([1]);
    (AuditLog.create as jest.Mock).mockResolvedValue({});
  });

  it('retains the assignment ID and its attendance dependency when a rerun produces the same assignment', async () => {
    const attendance = { id: 702, shiftAssignmentId: 411, status: 'attended' };
    const existing = {
      id: 411,
      shiftInstanceId: 88,
      userId: 17,
      shiftRoleId: 3,
      roleInShift: '  GUIDE ',
      volunteerAttendance: attendance,
    };
    (ShiftInstance.findAll as jest.Mock).mockResolvedValue([buildShift(existing)]);

    const summary = await autoAssignWeek(9, 50);

    expect(ShiftAssignment.destroy).not.toHaveBeenCalled();
    expect(ShiftAssignment.create).not.toHaveBeenCalled();
    expect(existing.id).toBe(411);
    expect(existing.volunteerAttendance).toBe(attendance);
    expect(summary).toMatchObject({ created: 0, removed: 0 });
    expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      metaJson: expect.objectContaining({ preserved: 1 }),
    }));
  });

  it('deletes only obsolete assignment IDs and creates only newly planned identities', async () => {
    const obsolete = {
      id: 412,
      shiftInstanceId: 88,
      userId: 17,
      shiftRoleId: 4,
      roleInShift: 'Social Media',
    };
    (ShiftInstance.findAll as jest.Mock).mockResolvedValue([buildShift(obsolete)]);

    const summary = await autoAssignWeek(9, 50);

    expect(ShiftAssignment.destroy).toHaveBeenCalledWith({
      where: { id: { [Op.in]: [412] } },
      transaction,
    });
    expect(ShiftAssignment.create).toHaveBeenCalledWith({
      shiftInstanceId: 88,
      userId: 17,
      roleInShift: 'Guide',
      shiftRoleId: 3,
    }, { transaction });
    expect(summary).toMatchObject({ created: 1, removed: 1 });
  });

  it('preserves the assignment ID when only the display label for a stable role ID changed', async () => {
    const existing = {
      id: 414,
      shiftInstanceId: 88,
      userId: 17,
      shiftRoleId: 3,
      roleInShift: 'Pub Crawl Guide',
    };
    (ShiftInstance.findAll as jest.Mock).mockResolvedValue([buildShift(existing)]);

    const summary = await autoAssignWeek(9, 50);

    expect(ShiftAssignment.destroy).not.toHaveBeenCalled();
    expect(ShiftAssignment.create).not.toHaveBeenCalled();
    expect(ShiftAssignment.update).toHaveBeenCalledWith(
      { roleInShift: 'Guide' },
      { where: { id: 414 }, transaction },
    );
    expect(summary).toMatchObject({ created: 0, removed: 0 });
  });

  it('removes an ineligible volunteer without counting that obsolete row as slot coverage', async () => {
    const obsolete = {
      id: 413,
      shiftInstanceId: 88,
      userId: 17,
      shiftRoleId: 3,
      roleInShift: 'Guide',
    };
    (UserShiftRole.findAll as jest.Mock).mockResolvedValue([]);
    (ShiftInstance.findAll as jest.Mock).mockResolvedValue([buildShift(obsolete)]);

    const summary = await autoAssignWeek(9, 50);

    expect(ShiftAssignment.destroy).toHaveBeenCalledWith({
      where: { id: { [Op.in]: [413] } },
      transaction,
    });
    expect(ShiftAssignment.create).not.toHaveBeenCalled();
    expect(summary).toMatchObject({
      created: 0,
      removed: 1,
      volunteerCount: 0,
      unfilled: [{ shiftInstanceId: 88, role: 'Guide', date: '2026-09-14', timeStart: '12:00' }],
    });
  });
});
