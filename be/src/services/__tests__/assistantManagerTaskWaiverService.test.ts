jest.mock('../../models/AssistantManagerTaskLog.js', () => ({ __esModule: true, default: { findAll: jest.fn(), sequelize: { transaction: jest.fn() } } }));
jest.mock('../../models/AssistantManagerTaskTemplate.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../models/Counter.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/Product.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/NightReport.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../volunteerAttendanceCheckService.js', () => ({ assertAttendanceEvidencePreserved: jest.fn() }));
jest.mock('../cleaningSubmissionService.js', () => ({ assertCleaningEvidencePreserved: jest.fn(), assertCleaningTaskLogMutable: jest.fn(),
  isCleaningTaskCompletionManaged: (config: Record<string, unknown>, meta: Record<string, unknown>) => config?.cleaningPhotoApprovalEnabled === true || Boolean(meta?.cleaningPhotoWorkflow) }));

import dayjs from 'dayjs';
import AssistantManagerTaskLog from '../../models/AssistantManagerTaskLog.js';
import AssistantManagerTaskTemplate from '../../models/AssistantManagerTaskTemplate.js';
import NightReport from '../../models/NightReport.js';
import HttpError from '../../errors/HttpError.js';
import { assertAttendanceEvidencePreserved } from '../volunteerAttendanceCheckService.js';
import { assertCleaningEvidencePreserved, assertCleaningTaskLogMutable } from '../cleaningSubmissionService.js';
import { reconcileNightReportTaskWaiversForReport, reconcileNightReportTaskWaiversForRange } from '../assistantManagerTaskWaiverService.js';

const transaction = { LOCK: { UPDATE: 'UPDATE' } };
const report = { id: 4, activityDate: '2026-09-06', status: 'submitted', notes: 'Did not run', counterId: 3,
  counter: { productId: 1, product: { name: 'Pub Crawl' } } };
const template = { id: 11, scheduleConfig: { nightReportRules: [{ noteEquals: 'Did not run', productIds: [1], taskDateOffsetDays: 1 }] } };
const photo = { id: 'photo-1', type: 'image', driveFileId: 'drive-file', ruleKey: 'meeting' };
const makeLog = (fields: Record<string, unknown> = {}) => {
  const log = { id: 20, templateId: 11, taskDate: '2026-09-07', status: 'pending', meta: { evidenceItems: [photo] }, ...fields, update: jest.fn() };
  log.update.mockImplementation(async (values) => Object.assign(log, values));
  return log;
};
let log: ReturnType<typeof makeLog>;
const reconcile = (options?: Parameters<typeof reconcileNightReportTaskWaiversForReport>[1]) => reconcileNightReportTaskWaiversForReport(report as never, options);

describe('evidence-safe night-report task waivers', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    log = makeLog();
    (AssistantManagerTaskLog.sequelize!.transaction as jest.Mock).mockImplementation(async (callback) => callback(transaction));
    (AssistantManagerTaskTemplate.findAll as jest.Mock).mockResolvedValue([template]);
    (AssistantManagerTaskLog.findAll as jest.Mock).mockResolvedValue([log]);
  });
  it('starts a transaction and locks log rows before using their current evidence', async () => {
    expect(await reconcile()).toEqual({ waivedCount: 1, restoredCount: 0, unchangedCount: 0 });
    expect(AssistantManagerTaskLog.sequelize!.transaction).toHaveBeenCalledTimes(1);
    expect(AssistantManagerTaskLog.findAll).toHaveBeenCalledWith(expect.objectContaining({ transaction, lock: 'UPDATE', order: [['id', 'ASC']], where: expect.objectContaining({ taskDate: '2026-09-07' }) }));
    expect(log.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'waived', meta: expect.objectContaining({ evidenceItems: [photo] }) }), { transaction });
    expect(assertAttendanceEvidencePreserved).toHaveBeenCalledWith(20, expect.objectContaining({ evidenceItems: [photo] }), expect.objectContaining({ evidenceItems: [photo] }), transaction);
    expect(assertCleaningEvidencePreserved).toHaveBeenCalledTimes(1);
  });
  it('reuses a supplied transaction without nesting or committing it', async () => {
    await reconcile({ transaction: transaction as never });
    expect(AssistantManagerTaskLog.sequelize!.transaction).not.toHaveBeenCalled();
    expect(AssistantManagerTaskTemplate.findAll).toHaveBeenCalledWith(expect.objectContaining({ transaction }));
  });
  it('builds payloads from the row read after waiting for the lock, not an earlier metadata snapshot', async () => {
    const uploadedPhoto = { ...photo, id: 'photo-2' };
    (AssistantManagerTaskLog.findAll as jest.Mock).mockImplementation(async (options) => {
      expect(options.lock).toBe('UPDATE');
      log.meta = { evidenceItems: [photo, uploadedPhoto] };
      return [log];
    });
    await reconcile();
    expect(log.update).toHaveBeenCalledWith(expect.objectContaining({ meta: expect.objectContaining({ evidenceItems: [photo, uploadedPhoto] }) }), { transaction });
  });
  it.each(['template', 'snapshot', 'submissions'])('leaves cleaning workflows unchanged when identified through %s', async (source) => {
    if (source === 'template') (AssistantManagerTaskTemplate.findAll as jest.Mock).mockResolvedValue([{ ...template, scheduleConfig: { ...template.scheduleConfig, cleaningPhotoApprovalEnabled: true } }]);
    if (source === 'snapshot') log = makeLog({ meta: { cleaningPhotoWorkflow: { managed: true } } });
    if (source === 'submissions') (assertCleaningTaskLogMutable as jest.Mock).mockRejectedValue(new HttpError(409, 'Has submissions'));
    (AssistantManagerTaskLog.findAll as jest.Mock).mockResolvedValue([log]);
    expect(await reconcile()).toEqual({ waivedCount: 0, restoredCount: 0, unchangedCount: 1 });
    expect(log.update).not.toHaveBeenCalled();
  });
  it('does not restore an auto-waived task once a cleaning workflow owns it', async () => {
    log = makeLog({ status: 'waived', meta: { autoWaived: true, waiverSource: { kind: 'night_report', reportId: 4 }, cleaningPhotoWorkflow: { managed: true } } });
    (AssistantManagerTaskLog.findAll as jest.Mock).mockResolvedValue([log]);
    expect(await reconcile({ mode: 'restore' })).toMatchObject({ restoredCount: 0, unchangedCount: 1 });
    expect(log.update).not.toHaveBeenCalled();
  });
  it('restores the previous normal status while retaining every photo and unrelated metadata', async () => {
    log = makeLog({ status: 'waived', meta: { evidenceItems: [photo], comment: 'Keep this', autoWaived: true, waiverPreviousStatus: 'missed', waiverAppliedAt: 'yesterday', waiverSource: { kind: 'night_report', reportId: 4 } } });
    (AssistantManagerTaskLog.findAll as jest.Mock).mockResolvedValue([log]);
    expect(await reconcile({ mode: 'restore' })).toMatchObject({ restoredCount: 1 });
    expect(log.update).toHaveBeenCalledWith({ status: 'missed', completedAt: null, meta: { evidenceItems: [photo], comment: 'Keep this' } }, { transaction });
  });
  it('propagates evidence conflicts and unexpected errors rather than applying a partial waiver', async () => {
    (assertAttendanceEvidencePreserved as jest.Mock).mockRejectedValue(new HttpError(409, 'Photo is protected'));
    await expect(reconcile()).rejects.toMatchObject({ status: 409 });
    expect(log.update).not.toHaveBeenCalled();
    (assertAttendanceEvidencePreserved as jest.Mock).mockResolvedValue(undefined);
    (assertCleaningTaskLogMutable as jest.Mock).mockRejectedValue(new Error('Database unavailable'));
    await expect(reconcile()).rejects.toThrow('Database unavailable');
    expect(log.update).not.toHaveBeenCalled();
  });
  it('skips manually assigned, completed and already-waived tasks', async () => {
    for (const candidate of [makeLog({ meta: { manual: true } }), makeLog({ status: 'completed' }), makeLog({ status: 'waived' })]) {
      (AssistantManagerTaskLog.findAll as jest.Mock).mockResolvedValue([candidate]);
      expect(await reconcile()).toMatchObject({ unchangedCount: 1, waivedCount: 0 });
      expect(candidate.update).not.toHaveBeenCalled();
    }
  });
  it('uses the same transaction-aware path for range reconciliation', async () => {
    (NightReport.findAll as jest.Mock).mockResolvedValue([report]);
    expect(await reconcileNightReportTaskWaiversForRange(dayjs('2026-09-07'), dayjs('2026-09-07'), { transaction: transaction as never })).toMatchObject({ waivedCount: 1 });
    expect(NightReport.findAll).toHaveBeenCalledWith(expect.objectContaining({ transaction }));
    expect(AssistantManagerTaskLog.sequelize!.transaction).not.toHaveBeenCalled();
  });
});
