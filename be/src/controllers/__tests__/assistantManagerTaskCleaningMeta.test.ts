import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest.js';

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
jest.mock('../../services/cleaningSubmissionService.js', () => ({ assertCleaningEvidencePreserved: jest.fn(), assertCleaningTaskLogMutable: jest.fn(), isCleaningTaskCompletionManaged: jest.fn(() => true) }));
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
import { updateTaskLogMeta } from '../assistantManagerTaskController.js';

describe('Cleaning task metadata preserves approved multi-photo evidence', () => {
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
