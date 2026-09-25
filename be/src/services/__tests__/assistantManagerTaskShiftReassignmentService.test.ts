jest.mock('../../models/AuditLog.js', () => ({ __esModule: true, default: { create: jest.fn() } }));
jest.mock('../../models/AssistantManagerTaskLog.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));

import AuditLog from '../../models/AuditLog';
import AssistantManagerTaskLog from '../../models/AssistantManagerTaskLog';
import {
  reassignAssistantManagerTasksForManagerShiftOwnerChange,
} from '../assistantManagerTaskShiftReassignmentService';

const transaction = { LOCK: { UPDATE: 'UPDATE' } } as never;

const makeTaskLog = (overrides: Record<string, unknown> = {}) => ({
  id: 100,
  templateId: 10,
  userId: 7,
  taskDate: '2026-09-14',
  status: 'pending',
  meta: { shiftAssignmentId: 51, shiftInstanceId: 501 },
  update: jest.fn().mockResolvedValue(undefined),
  ...overrides,
});

describe('assistant-manager task shift reassignment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (AuditLog.create as jest.Mock).mockResolvedValue({});
  });

  it('reassigns pending manager-shift task logs to the approved swap recipient', async () => {
    const managerTask = makeTaskLog();
    const unrelatedTask = makeTaskLog({
      id: 101,
      templateId: 11,
      meta: { shiftAssignmentId: 999, shiftInstanceId: 501 },
    });
    (AssistantManagerTaskLog.findAll as jest.Mock)
      .mockResolvedValueOnce([managerTask, unrelatedTask])
      .mockResolvedValueOnce([]);

    const result = await reassignAssistantManagerTasksForManagerShiftOwnerChange({
      assignment: {
        id: 51,
        userId: 7,
        shiftInstanceId: 501,
        roleInShift: 'Manager',
        shiftRole: { slug: 'manager', name: 'Manager' },
        shiftInstance: { date: '2026-09-14' },
      },
      fromUserId: 7,
      toUserId: 9,
      actorId: 99,
      requestId: 3001,
    }, transaction);

    expect(result).toEqual({ scannedCount: 2, reassignedCount: 1, skippedDuplicateCount: 0 });
    expect(managerTask.update).toHaveBeenCalledWith(expect.objectContaining({
      userId: 9,
      updatedBy: 99,
      meta: expect.objectContaining({
        shiftAssignmentId: 51,
        shiftInstanceId: 501,
        managerOverride: expect.objectContaining({
          originalGenerationSourceKey: '10:7:2026-09-14',
          updatedBy: 99,
        }),
        scheduleSwapReassignment: expect.objectContaining({
          requestId: 3001,
          taskDate: '2026-09-14',
          fromUserId: 7,
          toUserId: 9,
          shiftAssignmentId: 51,
          shiftInstanceId: 501,
          reason: 'manager_shift_owner_changed',
        }),
      }),
    }), { transaction });
    expect(unrelatedTask.update).not.toHaveBeenCalled();
    expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      actorId: 99,
      action: 'assistant-manager-task.shift-swap-reassigned',
      entity: 'am_task_log',
      entityId: '100',
    }), { transaction });
  });

  it('ignores non-manager shift assignments', async () => {
    const result = await reassignAssistantManagerTasksForManagerShiftOwnerChange({
      assignment: {
        id: 51,
        userId: 7,
        shiftInstanceId: 501,
        roleInShift: 'Guide',
        shiftRole: { slug: 'guide', name: 'Guide' },
        shiftInstance: { date: '2026-09-14' },
      },
      fromUserId: 7,
      toUserId: 9,
      actorId: 99,
      requestId: 3001,
    }, transaction);

    expect(result).toEqual({ scannedCount: 0, reassignedCount: 0, skippedDuplicateCount: 0 });
    expect(AssistantManagerTaskLog.findAll).not.toHaveBeenCalled();
  });

  it('skips a manager-shift task when the recipient already has that template/date task', async () => {
    const managerTask = makeTaskLog();
    (AssistantManagerTaskLog.findAll as jest.Mock)
      .mockResolvedValueOnce([managerTask])
      .mockResolvedValueOnce([{ id: 200, templateId: 10 }]);

    const result = await reassignAssistantManagerTasksForManagerShiftOwnerChange({
      assignment: {
        id: 51,
        userId: 7,
        shiftInstanceId: 501,
        roleInShift: 'Manager',
        shiftRole: { slug: 'manager', name: 'Manager' },
        shiftInstance: { date: '2026-09-14' },
      },
      fromUserId: 7,
      toUserId: 9,
      actorId: 99,
      requestId: 3001,
    }, transaction);

    expect(result).toEqual({ scannedCount: 1, reassignedCount: 0, skippedDuplicateCount: 1 });
    expect(managerTask.update).not.toHaveBeenCalled();
    expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      action: 'assistant-manager-task.shift-swap-reassignment-skipped',
      entityId: '100',
      meta: expect.objectContaining({ reason: 'target_task_already_exists' }),
    }), { transaction });
  });
});
