import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest.js';
import HttpError from '../../errors/HttpError.js';

jest.mock('../../models/AssistantManagerTaskLog.js', () => ({ __esModule: true, default: { findByPk: jest.fn(), sequelize: { transaction: jest.fn() } } }));
jest.mock('../../models/AssistantManagerTaskTemplate.js', () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock('../../models/AssistantManagerTaskAssignment.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/SocialMediaContent.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/StaffProfile.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/User.js', () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock('../../models/UserType.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/ShiftAssignment.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../models/ShiftInstance.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/ShiftTemplate.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/ShiftRole.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/UserShiftRole.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/CerebroEntry.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/CerebroQuiz.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../__mocks__/sequelizeModelStub', () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock('../../services/volunteerAttendanceCheckService.js', () => ({ assertAttendanceEvidencePreserved: jest.fn(), ensureTaskAttendanceCheckSatisfied: jest.fn(), validateAttendanceCheckConfig: jest.fn(), validateAttendanceCheckShiftTypes: jest.fn() }));
jest.mock('../../services/cleaningSubmissionService.js', () => ({ assertCleaningEvidencePreserved: jest.fn(), assertCleaningTaskLogMutable: jest.fn(), isCleaningTaskCompletionManaged: jest.fn(() => true), prepareCleaningTaskLogDeletion: jest.fn() }));
jest.mock('../../services/assistantManagerTaskEvidenceStorageService.js', () => ({ deleteAssistantManagerTaskEvidenceImage: jest.fn(), ensureAssistantManagerTaskEvidenceStorage: jest.fn(), openAssistantManagerTaskEvidenceImageStream: jest.fn(), storeAssistantManagerTaskEvidenceImage: jest.fn() }));
jest.mock('../../services/configService.js', () => ({ getConfigValue: jest.fn(() => 'Europe/Warsaw') }));
jest.mock('../../services/assistantManagerTaskWaiverService.js', () => ({ reconcileNightReportTaskWaiversForRange: jest.fn() }));
jest.mock('../../services/scheduleService.js', () => ({ listShiftTemplates: jest.fn(), listShiftTypes: jest.fn() }));
jest.mock('../../services/amTaskPushService.js', () => ({ getAmTaskPushPublicKey: jest.fn(), isAmTaskPushEnabled: jest.fn() }));
jest.mock('../../middleware/authorizationMiddleware.js', () => ({ hasModuleActionPermission: jest.fn() }));
jest.mock('../../utils/logger.js', () => ({ __esModule: true, default: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }));

import AssistantManagerTaskLog from '../../models/AssistantManagerTaskLog.js';
import AssistantManagerTaskTemplate from '../../models/AssistantManagerTaskTemplate.js';
import ShiftAssignment from '../../models/ShiftAssignment.js';
import User from '../../__mocks__/sequelizeModelStub';
import { assertAttendanceEvidencePreserved, ensureTaskAttendanceCheckSatisfied } from '../../services/volunteerAttendanceCheckService.js';
import {
  assertCleaningEvidencePreserved,
  assertCleaningTaskLogMutable,
  isCleaningTaskCompletionManaged,
  prepareCleaningTaskLogDeletion,
} from '../../services/cleaningSubmissionService.js';
import { deleteAssistantManagerTaskEvidenceImage } from '../../services/assistantManagerTaskEvidenceStorageService.js';
import { deleteTaskLog, updateTaskLogMeta, updateTaskLogStatus } from '../assistantManagerTaskController.js';

describe('Cleaning task metadata preserves approved multi-photo evidence', () => {
  beforeEach(() => jest.clearAllMocks());

  it('accepts an ordinary comment after completion without normalizing or deleting either approved photo', async () => {
    const transaction = { LOCK: { UPDATE: 'UPDATE' }, commit: jest.fn().mockResolvedValue(undefined), rollback: jest.fn().mockResolvedValue(undefined) };
    const evidenceItems = [101, 102].map((id) => ({
      id: `cleaning-photo-${id}`, ruleKey: 'cleaning', type: 'image', subjectUserId: 7,
      fileName: `${id}.jpg`, mimeType: 'image/jpeg', fileSize: 1024,
      storagePath: `drive:${id}`, driveFileId: String(id), uploadedBy: 7,
      uploadedAt: '2026-09-07T10:00:00Z', valid: true, cleaningSubmissionId: 1, cleaningPhotoId: id,
    }));
    const meta = { evidenceItems, cleaningPhotoWorkflow: { managed: true, submissionIds: [1] } };
    const log = { id: 91, templateId: 4, userId: 8, taskDate: '2026-09-07', status: 'completed', meta, update: jest.fn() };
    (AssistantManagerTaskLog.sequelize!.transaction as jest.Mock).mockResolvedValue(transaction);
    (AssistantManagerTaskLog.findByPk as jest.Mock).mockResolvedValueOnce(log).mockResolvedValueOnce(null);
    (AssistantManagerTaskTemplate.findByPk as jest.Mock).mockResolvedValue({ id: 4, scheduleConfig: {
      cleaningPhotoApprovalEnabled: true,
      evidenceRules: [{ key: 'cleaning', label: 'Cleaning photos', type: 'image', required: true, multiple: true, minItems: 2 }],
      shiftEvidenceSources: [{ key: 'clean', evidenceRuleKey: 'cleaning', shiftTypeIds: [7] }],
    } });
    (ShiftAssignment.findAll as jest.Mock).mockResolvedValue([]);
    (User as { findByPk: jest.Mock }).findByPk.mockResolvedValue({ id: 8, firstName: 'Task', lastName: 'Manager' });
    const req = { params: { id: '91' }, body: { comment: 'All photos look good.' }, authContext: { id: 8, roleSlug: 'assistant-manager' } } as unknown as AuthenticatedRequest;
    const res = {} as Response;
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);

    await updateTaskLogMeta(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(log.update).toHaveBeenCalledWith({ meta: {
      ...meta, comments: [expect.objectContaining({ body: 'All photos look good.', authorId: 8 })],
    }, updatedBy: 8 }, { transaction });
    expect(log.update.mock.calls[0][0].meta.evidenceItems).toBe(evidenceItems);
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).not.toHaveBeenCalled();
    expect(AssistantManagerTaskLog.findByPk).toHaveBeenNthCalledWith(1, 91, { transaction, lock: 'UPDATE' });
  });
});

describe('privileged cleaning task deletion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (isCleaningTaskCompletionManaged as jest.Mock).mockReturnValue(true);
    (assertAttendanceEvidencePreserved as jest.Mock).mockResolvedValue(undefined);
    (assertCleaningEvidencePreserved as jest.Mock).mockResolvedValue(undefined);
    (assertCleaningTaskLogMutable as jest.Mock).mockResolvedValue(undefined);
    (ensureTaskAttendanceCheckSatisfied as jest.Mock).mockResolvedValue(undefined);
    (deleteAssistantManagerTaskEvidenceImage as jest.Mock).mockResolvedValue(undefined);
  });

  const response = () => {
    const res = {} as Response;
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    res.send = jest.fn().mockReturnValue(res);
    return res;
  };

  it('rejects non-management users before opening a destructive transaction', async () => {
    const req = {
      params: { id: '91' },
      authContext: { id: 9, roleSlug: 'assistant-manager' },
    } as unknown as AuthenticatedRequest;
    const res = response();

    await deleteTaskLog(req, res);

    expect(AssistantManagerTaskLog.sequelize!.transaction).not.toHaveBeenCalled();
    expect(prepareCleaningTaskLogDeletion).not.toHaveBeenCalled();
    expect(deleteAssistantManagerTaskEvidenceImage).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('deletes the task in the transaction and removes unique generic and cleaning files after commit', async () => {
    const transaction = { LOCK: { UPDATE: 'UPDATE' } };
    const log = { id: 91, templateId: 4, userId: 8, taskDate: '2026-09-07', status: 'completed',
      meta: { evidenceItems: [{ id: 'generic-1', ruleKey: 'cleaning', type: 'image', storagePath: 'drive:generic-file', driveFileId: 'generic-file' }] },
      destroy: jest.fn().mockResolvedValue(undefined) };
    (AssistantManagerTaskLog.sequelize!.transaction as jest.Mock).mockImplementation(async (callback) => callback(transaction));
    (AssistantManagerTaskLog.findByPk as jest.Mock).mockResolvedValue(log);
    (prepareCleaningTaskLogDeletion as jest.Mock).mockResolvedValue({ managed: true, images: [
      { storagePath: 'drive:cleaning-file', driveFileId: 'cleaning-file' },
      { storagePath: 'drive:generic-file', driveFileId: 'generic-file' },
    ] });
    (deleteAssistantManagerTaskEvidenceImage as jest.Mock).mockResolvedValue(undefined);
    const req = { params: { id: '91' }, authContext: { id: 99, roleSlug: 'owner' } } as unknown as AuthenticatedRequest;
    const res = response();

    await deleteTaskLog(req, res);

    expect(prepareCleaningTaskLogDeletion).toHaveBeenCalledWith({ log, actorId: 99, transaction });
    expect(assertAttendanceEvidencePreserved).not.toHaveBeenCalled();
    expect(assertCleaningTaskLogMutable).not.toHaveBeenCalled();
    expect(log.destroy).toHaveBeenCalledWith({ transaction });
    expect(deleteAssistantManagerTaskEvidenceImage).toHaveBeenCalledTimes(2);
    expect(deleteAssistantManagerTaskEvidenceImage).toHaveBeenCalledWith({ storagePath: 'drive:generic-file', driveFileId: 'generic-file' });
    expect(deleteAssistantManagerTaskEvidenceImage).toHaveBeenCalledWith({ storagePath: 'drive:cleaning-file', driveFileId: 'cleaning-file' });
    expect(log.destroy.mock.invocationCallOrder[0])
      .toBeLessThan((deleteAssistantManagerTaskEvidenceImage as jest.Mock).mock.invocationCallOrder[0]);
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
  });

  it('retains the ordinary attendance and cleaning guards for non-cleaning task deletion', async () => {
    const transaction = { LOCK: { UPDATE: 'UPDATE' } };
    const log = { id: 92, templateId: 5, userId: 8, taskDate: '2026-09-07', status: 'pending', meta: {},
      destroy: jest.fn().mockResolvedValue(undefined) };
    (AssistantManagerTaskLog.sequelize!.transaction as jest.Mock).mockImplementation(async (callback) => callback(transaction));
    (AssistantManagerTaskLog.findByPk as jest.Mock).mockResolvedValue(log);
    (prepareCleaningTaskLogDeletion as jest.Mock).mockResolvedValue({ managed: false, images: [] });
    (assertAttendanceEvidencePreserved as jest.Mock).mockRejectedValue(new HttpError(409, 'Attendance evidence is retained.'));
    const req = { params: { id: '92' }, authContext: { id: 99, roleSlug: 'owner' } } as unknown as AuthenticatedRequest;
    const res = response();

    await deleteTaskLog(req, res);

    expect(assertAttendanceEvidencePreserved).toHaveBeenCalledWith(92, {}, null, transaction);
    expect(assertCleaningTaskLogMutable).not.toHaveBeenCalled();
    expect(log.destroy).not.toHaveBeenCalled();
    expect(deleteAssistantManagerTaskEvidenceImage).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('force deletes a non-cleaning task without the evidence-retention guards', async () => {
    const transaction = { LOCK: { UPDATE: 'UPDATE' } };
    const log = { id: 93, templateId: 5, userId: 8, taskDate: '2026-09-07', status: 'missed',
      meta: { evidenceItems: [{ id: 'attendance-1', ruleKey: 'promo', type: 'image', storagePath: 'drive:attendance-file', driveFileId: 'attendance-file' }] },
      destroy: jest.fn().mockResolvedValue(undefined) };
    (AssistantManagerTaskLog.sequelize!.transaction as jest.Mock).mockImplementation(async (callback) => callback(transaction));
    (AssistantManagerTaskLog.findByPk as jest.Mock).mockResolvedValue(log);
    (prepareCleaningTaskLogDeletion as jest.Mock).mockResolvedValue({ managed: false, images: [] });
    (assertAttendanceEvidencePreserved as jest.Mock).mockRejectedValue(new HttpError(409, 'Attendance evidence is retained.'));
    (deleteAssistantManagerTaskEvidenceImage as jest.Mock).mockResolvedValue(undefined);
    const req = {
      params: { id: '93' },
      query: { force: 'true' },
      authContext: { id: 99, roleSlug: 'manager' },
    } as unknown as AuthenticatedRequest;
    const res = response();

    await deleteTaskLog(req, res);

    expect(assertAttendanceEvidencePreserved).not.toHaveBeenCalled();
    expect(assertCleaningTaskLogMutable).not.toHaveBeenCalled();
    expect(log.destroy).toHaveBeenCalledWith({ transaction });
    expect(deleteAssistantManagerTaskEvidenceImage).toHaveBeenCalledWith({ storagePath: 'drive:attendance-file', driveFileId: 'attendance-file' });
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it('rejects an assistant manager before opening the privileged deletion transaction', async () => {
    const req = { params: { id: '91' }, authContext: { id: 8, roleSlug: 'assistant-manager' } } as unknown as AuthenticatedRequest;
    const res = response();

    await deleteTaskLog(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(AssistantManagerTaskLog.sequelize!.transaction).not.toHaveBeenCalled();
    expect(prepareCleaningTaskLogDeletion).not.toHaveBeenCalled();
    expect(deleteAssistantManagerTaskEvidenceImage).not.toHaveBeenCalled();
  });
});

describe('privileged task status override', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (isCleaningTaskCompletionManaged as jest.Mock).mockReturnValue(false);
    (assertAttendanceEvidencePreserved as jest.Mock).mockResolvedValue(undefined);
    (assertCleaningEvidencePreserved as jest.Mock).mockResolvedValue(undefined);
    (assertCleaningTaskLogMutable as jest.Mock).mockResolvedValue(undefined);
    (ensureTaskAttendanceCheckSatisfied as jest.Mock).mockResolvedValue(undefined);
    (deleteAssistantManagerTaskEvidenceImage as jest.Mock).mockResolvedValue(undefined);
  });

  const response = () => {
    const res = {} as Response;
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  };

  it('force completes a missed task without attendance, evidence, or deadline checks', async () => {
    const transaction = { LOCK: { UPDATE: 'UPDATE' } };
    const log = {
      id: 94,
      templateId: 6,
      userId: 8,
      taskDate: '2026-09-12',
      status: 'missed',
      meta: {},
      update: jest.fn().mockResolvedValue(undefined),
    };
    (AssistantManagerTaskLog.sequelize!.transaction as jest.Mock).mockImplementation(async (callback) => callback(transaction));
    (AssistantManagerTaskLog.findByPk as jest.Mock).mockResolvedValueOnce(log).mockResolvedValueOnce(null);
    (AssistantManagerTaskTemplate.findByPk as jest.Mock).mockResolvedValue({
      id: 6,
      name: 'Daily - Arrive at 20:45 and check late staff',
      description: null,
      scheduleConfig: { time: '20:45', durationHours: 0.1, completionWindowMode: 'strict' },
    });
    const req = {
      params: { id: '94' },
      body: { status: 'completed', force: true },
      authContext: { id: 99, roleSlug: 'owner' },
    } as unknown as AuthenticatedRequest;
    const res = response();

    await updateTaskLogStatus(req, res);

    expect(ensureTaskAttendanceCheckSatisfied).not.toHaveBeenCalled();
    expect(assertAttendanceEvidencePreserved).toHaveBeenCalledWith(94, {}, {}, transaction);
    expect(assertCleaningEvidencePreserved).toHaveBeenCalledWith(94, {}, {}, transaction);
    expect(log.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'completed',
        completedAt: expect.any(Date),
        updatedBy: 99,
      }),
      { transaction },
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('rejects force completion from an assistant manager before opening a transaction', async () => {
    const req = {
      params: { id: '94' },
      body: { status: 'completed', force: true },
      authContext: { id: 8, roleSlug: 'assistant-manager' },
    } as unknown as AuthenticatedRequest;
    const res = response();

    await updateTaskLogStatus(req, res);

    expect(AssistantManagerTaskLog.sequelize!.transaction).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
