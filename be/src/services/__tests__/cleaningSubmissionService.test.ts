jest.mock('../../config/database.js', () => ({ __esModule: true, default: { transaction: jest.fn() } }));
jest.mock('../../models/AssistantManagerTaskLog.js', () => ({ __esModule: true, default: { findByPk: jest.fn(), findAll: jest.fn() } }));
jest.mock('../../models/AssistantManagerTaskTemplate.js', () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock('../../models/CleaningSubmission.js', () => ({ __esModule: true, default: { findByPk: jest.fn(), findAll: jest.fn(), findOne: jest.fn(), create: jest.fn() } }));
jest.mock('../../models/CleaningPhotoVersion.js', () => ({ __esModule: true, default: { findByPk: jest.fn(), findAll: jest.fn(), findOne: jest.fn(), create: jest.fn() } }));
jest.mock('../../models/RequiredAction.js', () => ({ __esModule: true, default: { findByPk: jest.fn(), findAll: jest.fn(), create: jest.fn(), update: jest.fn() } }));
jest.mock('../../models/AuditLog.js', () => ({ __esModule: true, default: { create: jest.fn() } }));
jest.mock('../../models/ScheduleWeek.js', () => ({ __esModule: true, default: { findByPk: jest.fn(), findAll: jest.fn() } }));
jest.mock('../../models/ShiftAssignment.js', () => ({ __esModule: true, default: { findByPk: jest.fn(), findAll: jest.fn() } }));
jest.mock('../../models/ShiftInstance.js', () => ({ __esModule: true, default: { findByPk: jest.fn(), findAll: jest.fn() } }));
jest.mock('../../models/ShiftRole.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/ShiftType.js', () => ({ __esModule: true, default: {} }));
jest.mock('../taskCompletionPayrollService.js', () => ({ prepareTaskCompletionPayrollMutation: jest.fn() }));
jest.mock('../cleaningPhotoValidationService.js', () => ({ normalizeCleaningPhoto: jest.fn() }));
jest.mock('../assistantManagerTaskEvidenceStorageService.js', () => ({ storeAssistantManagerTaskEvidenceImage: jest.fn(),
  deleteAssistantManagerTaskEvidenceImage: jest.fn(), openAssistantManagerTaskEvidenceImageStream: jest.fn() }));
jest.mock('../../utils/logger.js', () => ({ __esModule: true, default: { warn: jest.fn(), error: jest.fn() } }));

import { Op } from 'sequelize';
import HttpError from '../../errors/HttpError.js';
import sequelize from '../../config/database.js';
import UserStub from '../../__mocks__/sequelizeModelStub.js';
import AssistantManagerTaskLog from '../../models/AssistantManagerTaskLog.js';
import AssistantManagerTaskTemplate from '../../models/AssistantManagerTaskTemplate.js';
import CleaningSubmission from '../../models/CleaningSubmission.js';
import CleaningPhotoVersion from '../../models/CleaningPhotoVersion.js';
import RequiredAction from '../../models/RequiredAction.js';
import ScheduleWeek from '../../models/ScheduleWeek.js';
import ShiftAssignment from '../../models/ShiftAssignment.js';
import ShiftInstance from '../../models/ShiftInstance.js';
import { normalizeCleaningPhoto } from '../cleaningPhotoValidationService.js';
import { prepareTaskCompletionPayrollMutation } from '../taskCompletionPayrollService.js';
import { deleteAssistantManagerTaskEvidenceImage, openAssistantManagerTaskEvidenceImageStream, storeAssistantManagerTaskEvidenceImage } from '../assistantManagerTaskEvidenceStorageService.js';
import { assertCleaningEvidencePreserved, assertCleaningTaskLogMutable, ensureCleaningSubmissionsForTaskLog,
  getCleaningPhotoStream, getCleaningReviewActionPayload, getCleaningSubmission, isCleaningTaskCompletionManaged,
  listMyCleaningSubmissions, reviewCleaningSubmissionPhoto, uploadCleaningSubmissionPhoto, waiveCanceledCleaningTask } from '../cleaningSubmissionService.js';

const tx = { LOCK: { UPDATE: 'UPDATE' } };
const userModel = Object.assign(UserStub, { findAll: jest.fn(), findByPk: jest.fn() });
const volunteer = { actorId: 7, roleSlug: 'guide' };
const manager = { actorId: 9, roleSlug: 'assistant-manager' };
const owner = { actorId: 99, roleSlug: 'owner' };
const config = { cleaningPhotoApprovalEnabled: true,
  evidenceRules: [{ key: 'kitchen', label: 'Clean kitchen', type: 'image', required: true, minItems: 1, multiple: false }],
  shiftEvidenceSources: [{ key: 'house', label: 'House care', evidenceRuleKey: 'kitchen', shiftTypeIds: [7] }] };
const record = (values: Record<string, unknown>) => {
  const row: any = { ...values, update: jest.fn() };
  row.update.mockImplementation(async (next: Record<string, unknown>) => Object.assign(row, next));
  return row;
};
const assignment = (id: number, userId: number, typeId: number, role = 'guide') => record({ id, userId, shiftInstanceId: typeId === 7 ? 50 : 60,
  roleInShift: role, shiftRole: { slug: role }, assignee: { id: userId, firstName: `Person ${userId}`, lastName: 'Surname', status: true, approved: true },
  shiftInstance: { id: typeId === 7 ? 50 : 60, shiftTypeId: typeId, date: '2026-09-07', timeStart: '18:00:00', timeEnd: '22:00:00',
    scheduleWeekId: 10, scheduleWeek: { id: 10, state: 'published' }, shiftType: { id: typeId, name: 'Cleaning' } } });
let log: any;
let template: any;
let rows: any[];
let submissions: any[];
let photos: any[];
let actions: any[];
let nextPhotoId: number;
const materialize = async () => { await ensureCleaningSubmissionsForTaskLog(1); return submissions[0]; };
const upload = async (submission: any, actor = volunteer) => uploadCleaningSubmissionPhoto({ ...actor, submissionId: submission.id,
  slotKey: 'house-1', expectedRevision: submission.revision, data: Buffer.from('image') });
const review = async (submission: any, decision = 'approved', actor = manager, extra: Record<string, unknown> = {}) =>
  reviewCleaningSubmissionPhoto({ ...actor, submissionId: submission.id, photoId: photos.at(-1).id,
    body: { expectedRevision: submission.revision, decision, ...extra } });

describe('assignment-scoped cleaning workflow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-09-07T18:00:00Z'));
    log = record({ id: 1, templateId: 4, userId: 9, taskDate: '2026-09-07', status: 'pending', meta: {}, updatedAt: new Date() });
    template = record({ id: 4, name: 'House cleaning', scheduleConfig: config });
    rows = [assignment(11, 7, 7), assignment(12, 9, 1, 'manager')];
    submissions = []; photos = []; actions = []; nextPhotoId = 100;
    (sequelize.transaction as jest.Mock).mockImplementation(async (...args) => args.at(-1)(tx));
    (AssistantManagerTaskLog.findByPk as jest.Mock).mockResolvedValue(log);
    (AssistantManagerTaskLog.findAll as jest.Mock).mockResolvedValue([Object.assign(log, { template })]);
    (AssistantManagerTaskTemplate.findByPk as jest.Mock).mockResolvedValue(template);
    (CleaningSubmission.findByPk as jest.Mock).mockImplementation(async (id) => submissions.find((row) => row.id === id) ?? null);
    (CleaningSubmission.findAll as jest.Mock).mockImplementation(async () => [...submissions]);
    (CleaningSubmission.findOne as jest.Mock).mockImplementation(async () => submissions[0] ?? null);
    (CleaningSubmission.create as jest.Mock).mockImplementation(async (values) => { const row = record({ id: submissions.length + 1, createdAt: new Date(), ...values }); submissions.push(row); return row; });
    (CleaningPhotoVersion.findAll as jest.Mock).mockImplementation(async (options) => photos.filter((photo) => typeof options.where.submissionId === 'number'
      ? photo.submissionId === options.where.submissionId : options.where.submissionId[Op.in].includes(photo.submissionId)));
    (CleaningPhotoVersion.findOne as jest.Mock).mockImplementation(async (options) => photos.find((photo) => photo.driveFileId === options.where.driveFileId) ?? null);
    (CleaningPhotoVersion.create as jest.Mock).mockImplementation(async (values) => { const row = record({ id: nextPhotoId++, ...values }); photos.push(row); return row; });
    (RequiredAction.findAll as jest.Mock).mockImplementation(async (options) => actions.filter((action) => action.payload.cleaningSubmission.submissionId === options.where.payload.cleaningSubmission.submissionId));
    (RequiredAction.findByPk as jest.Mock).mockImplementation(async (id) => actions.find((action) => action.id === id));
    (RequiredAction.create as jest.Mock).mockImplementation(async (values) => { const row = record({ id: actions.length + 1, ...values }); actions.push(row); return row; });
    (RequiredAction.update as jest.Mock).mockResolvedValue([1]);
    (ShiftAssignment.findAll as jest.Mock).mockImplementation(async (options) => {
      if (!options.include) return rows;
      const filter = options.include.find((item: any) => item.as === 'shiftInstance').where ?? {};
      return rows.filter((row) => (!options.where?.userId || options.where.userId === row.userId)
        && (!filter.shiftTypeId || filter.shiftTypeId[Op.in].includes(row.shiftInstance.shiftTypeId))
        && row.shiftInstance.scheduleWeek.state === 'published');
    });
    (ShiftAssignment.findByPk as jest.Mock).mockImplementation(async (id) => rows.find((row) => row.id === id));
    (ShiftInstance.findByPk as jest.Mock).mockImplementation(async (id) => rows.find((row) => row.shiftInstanceId === id)?.shiftInstance);
    (ShiftInstance.findAll as jest.Mock).mockResolvedValue([]);
    (ScheduleWeek.findAll as jest.Mock).mockResolvedValue([]);
    (ScheduleWeek.findByPk as jest.Mock).mockResolvedValue({ id: 10, state: 'published' });
    userModel.findAll.mockImplementation(async (options) => options?.include
      ? [{ id: 99, role: { slug: 'owner' } }] : [{ id: 9, firstName: 'Manager', lastName: 'Surname' }]);
    userModel.findByPk.mockImplementation(async (id) => ({ id, status: true, approved: true, role: { slug: id === 99 ? 'owner' : 'assistant-manager' } }));
    (normalizeCleaningPhoto as jest.Mock).mockResolvedValue({ data: Buffer.from('normalized'), mimeType: 'image/jpeg', fileName: 'cleaning-photo.jpg', width: 100, height: 100, sha256: 'a'.repeat(64) });
    (storeAssistantManagerTaskEvidenceImage as jest.Mock).mockImplementation(async () => ({ storagePath: `drive:file-${nextPhotoId}`, driveFileId: `file-${nextPhotoId}`, driveWebViewLink: null, mimeType: 'image/jpeg', fileSize: 10 }));
    (deleteAssistantManagerTaskEvidenceImage as jest.Mock).mockResolvedValue(undefined);
    (prepareTaskCompletionPayrollMutation as jest.Mock).mockResolvedValue(undefined);
    (openAssistantManagerTaskEvidenceImageStream as jest.Mock).mockResolvedValue({ stream: {}, mimeType: 'image/jpeg' });
  });
  afterEach(() => jest.useRealTimers());

  it('creates only actual published assignment slots and is idempotent across page reloads', async () => {
    await materialize(); await ensureCleaningSubmissionsForTaskLog(1);
    expect(CleaningSubmission.create).toHaveBeenCalledTimes(1);
    expect(submissions[0]).toMatchObject({ userId: 7, shiftAssignmentId: 11, reviewerUserIds: [9], requiredSlots: [{ key: 'house-1', ruleKey: 'kitchen' }] });
    expect(log.meta.cleaningPhotoWorkflow.managed).toBe(true);
    expect(RequiredAction.create).not.toHaveBeenCalled();
  });
  it('deduplicates a person with two roles on the same physical shift', async () => {
    rows.push(assignment(13, 7, 7, 'leader')); await materialize();
    expect(CleaningSubmission.create).toHaveBeenCalledTimes(1);
  });
  it('does not materialize old, future, closed or non-opted-in tasks', async () => {
    log.taskDate = '2026-09-06'; await ensureCleaningSubmissionsForTaskLog(1);
    log.taskDate = '2026-09-08'; await ensureCleaningSubmissionsForTaskLog(1);
    log.taskDate = '2026-09-07'; log.status = 'completed'; await ensureCleaningSubmissionsForTaskLog(1);
    log.status = 'pending'; template.scheduleConfig = {}; await ensureCleaningSubmissionsForTaskLog(1);
    expect(CleaningSubmission.create).not.toHaveBeenCalled();
  });
  it('detaches old ownership without transferring proof or blocking the new assigned person', async () => {
    const prior = await materialize(); await upload(prior);
    rows[0].userId = 8; rows[0].assignee.id = 8;
    await ensureCleaningSubmissionsForTaskLog(1);
    expect(prior.shiftAssignmentId).toBeNull();
    expect(photos[0].submissionId).toBe(prior.id);
    expect(submissions.find((row) => row.userId === 8)).toMatchObject({ shiftAssignmentId: 11, status: 'awaiting_upload' });
    expect(RequiredAction.update).toHaveBeenCalledWith({ status: false }, expect.anything());
  });
  it('does not revive orphaned submissions after a new assignment replaces a deleted one', async () => {
    const prior = await materialize(); prior.shiftAssignmentId = null; rows[0].id = 14;
    await ensureCleaningSubmissionsForTaskLog(1);
    expect(prior.shiftAssignmentId).toBeNull();
    expect(submissions.some((row) => row.id !== prior.id && row.shiftAssignmentId === 14)).toBe(true);
    await expect(upload(prior)).rejects.toMatchObject({ status: 409 });
  });
  it('blocks unrelated reads and upload attempts before any Drive write', async () => {
    const sub = await materialize();
    await expect(getCleaningSubmission(sub.id, { actorId: 500, roleSlug: 'guide' })).rejects.toMatchObject({ status: 404 });
    await expect(upload(sub, manager)).rejects.toMatchObject({ status: 403 });
    await expect(upload({ ...sub, revision: 500 })).rejects.toMatchObject({ status: 409 });
    expect(storeAssistantManagerTaskEvidenceImage).not.toHaveBeenCalled();
  });
  it('sends a nonblocking review request to the real on-shift manager only after upload', async () => {
    const sub = await materialize(); const result = await upload(sub);
    expect(result.submission.slots[0]).toMatchObject({ status: 'pending', currentVersion: { version: 1, mimeType: 'image/jpeg' } });
    expect(actions[0]).toMatchObject({ type: 'cleaning_review', targetUserIds: [9], requiresCompletion: false, requiresSignature: false });
    expect(log.status).toBe('pending');
    expect(result.submission.canReview).toBe(false);
  });
  it('rejects pending or approved replacements and preserves rejected versions on retake', async () => {
    const sub = await materialize(); await upload(sub);
    await expect(upload(sub)).rejects.toMatchObject({ status: 409 });
    await review(sub, 'rejected', manager, { reason: 'Please clean the sink.' });
    expect(photos[0].status).toBe('rejected'); expect(actions[0].status).toBe(false);
    await upload(sub);
    expect(photos.map((photo) => [photo.version, photo.status])).toEqual([[1, 'rejected'], [2, 'pending']]);
    expect(actions[0].status).toBe(true); expect(actions[0].payload.cleaningSubmission.revision).toBe(sub.revision);
    expect(deleteAssistantManagerTaskEvidenceImage).not.toHaveBeenCalled();
  });
  it('requires rejection notes and forbids self-review even by a global manager', async () => {
    const sub = await materialize(); await upload(sub);
    await expect(review(sub, 'rejected')).rejects.toMatchObject({ status: 400 });
    await expect(review(sub, 'approved', { actorId: 7, roleSlug: 'owner' })).rejects.toMatchObject({ status: 403 });
    expect(photos[0].status).toBe('pending');
  });
  it('uses an explicit audited manager escalation only when no reviewer is available', async () => {
    rows = rows.filter((row) => row.userId !== 9);
    const sub = await materialize(); await upload(sub);
    expect(actions[0].targetUserIds).toEqual([99]);
    await expect(review(sub, 'approved', owner)).rejects.toMatchObject({ status: 400 });
    const result = await review(sub, 'approved', owner, { escalationReason: 'No manager cleaning shift was scheduled.' });
    expect(result.taskCompleted).toBe(true); expect(log.status).toBe('completed');
  });
  it('does not let a global manager bypass a live scheduled reviewer', async () => {
    const sub = await materialize(); await upload(sub);
    await expect(review(sub, 'approved', owner, { escalationReason: 'Override' })).rejects.toMatchObject({ status: 403 });
  });
  it('locks real reviewer and subject roster rows and revalidates published state', async () => {
    const sub = await materialize(); await upload(sub);
    (ScheduleWeek.findByPk as jest.Mock).mockResolvedValue({ state: 'assigned' });
    await expect(review(sub)).rejects.toMatchObject({ status: 409 });
    expect(photos[0].status).toBe('pending');
    (ScheduleWeek.findByPk as jest.Mock).mockResolvedValue({ state: 'published' });
    await review(sub);
    expect(ShiftAssignment.findAll).toHaveBeenCalledWith(expect.objectContaining({ lock: 'UPDATE', where: { id: { [Op.in]: [11, 12] } } }));
  });
  it('requires every person before completing the task and preserves all approved photos', async () => {
    rows.push(assignment(14, 8, 7)); await materialize();
    const first = submissions.find((row) => row.userId === 7); const second = submissions.find((row) => row.userId === 8);
    await upload(first); const firstResult = await review(first);
    expect(firstResult.taskCompleted).toBe(false); expect(log.status).toBe('pending');
    await upload(second, { actorId: 8, roleSlug: 'guide' }); const secondResult = await review(second);
    expect(secondResult.taskCompleted).toBe(true);
    expect(log.meta.evidenceItems).toEqual(expect.arrayContaining([expect.objectContaining({ subjectUserId: 7, id: 'cleaning-photo-100' }), expect.objectContaining({ subjectUserId: 8, id: 'cleaning-photo-101' })]));
    expect(log.meta.evidenceItems).toHaveLength(2);
    expect(prepareTaskCompletionPayrollMutation).toHaveBeenCalledWith({ userId: 9, taskDate: '2026-09-07', transaction: tx });
  });
  it('does not mutate the task status when payroll rejects completion of settled work', async () => {
    const sub = await materialize(); await upload(sub);
    (prepareTaskCompletionPayrollMutation as jest.Mock).mockRejectedValueOnce(new Error('Settled payroll'));
    await expect(review(sub)).rejects.toThrow('Settled payroll');
    expect(log.status).toBe('pending'); expect(log.meta.evidenceItems).toBeUndefined();
  });
  it('returns a single own + authorized manager review queue and retains protected photo access', async () => {
    const sub = await materialize(); await upload(sub);
    const mine = await listMyCleaningSubmissions(volunteer); const queue = await listMyCleaningSubmissions(manager);
    expect(mine.submissions.map((row) => row.id)).toEqual([sub.id]); expect(mine.reviewSubmissions).toEqual([]);
    expect(queue.submissions).toEqual([]); expect(queue.reviewSubmissions.map((row) => row.id)).toEqual([sub.id]);
    await expect(getCleaningPhotoStream(sub.id, photos[0].id, { actorId: 500, roleSlug: 'guide' })).rejects.toMatchObject({ status: 404 });
    expect(openAssistantManagerTaskEvidenceImageStream).not.toHaveBeenCalled();
    await getCleaningPhotoStream(sub.id, photos[0].id, manager);
    expect(openAssistantManagerTaskEvidenceImageStream).toHaveBeenCalledTimes(1);
  });
  it('invalidates stale review popups when the manager is reassigned', async () => {
    const sub = await materialize(); await upload(sub);
    expect(await getCleaningReviewActionPayload(actions[0].id, sub.id, 9)).toMatchObject({ submissionId: sub.id, pendingPhotos: 1 });
    rows = rows.filter((row) => row.userId !== 9);
    expect(await getCleaningReviewActionPayload(actions[0].id, sub.id, 9)).toBeNull();
  });
  it('preserves managed evidence fields while allowing UI sanitization of private metadata', async () => {
    const sub = await materialize(); await upload(sub); await review(sub);
    const next = structuredClone(log.meta);
    delete next.evidenceItems[0].cleaningPhotoId; delete next.evidenceItems[0].cleaningSubmissionId;
    await expect(assertCleaningEvidencePreserved(1, log.meta, next)).resolves.toBeUndefined();
    next.evidenceItems[0].driveFileId = 'other-file';
    await expect(assertCleaningEvidencePreserved(1, log.meta, next)).rejects.toMatchObject({ status: 409 });
    await expect(assertCleaningTaskLogMutable(1)).rejects.toMatchObject({ status: 409 });
    await expect(assertCleaningEvidencePreserved(1, log.meta, null)).rejects.toMatchObject({ status: 409 });
  });
  it('remains managed after the original template is edited or disabled', async () => {
    const sub = await materialize(); template.scheduleConfig = {};
    expect(isCleaningTaskCompletionManaged(template.scheduleConfig, log.meta)).toBe(true);
    await upload(sub); await review(sub); expect(log.status).toBe('completed');
  });
  it('completes remaining approved work after the final outstanding participant is canceled', async () => {
    rows.push(assignment(14, 8, 7)); await materialize();
    const first = submissions.find((row) => row.userId === 7); const canceled = submissions.find((row) => row.userId === 8);
    await upload(first); await review(first);
    expect(log.status).toBe('pending');
    rows = rows.filter((row) => row.userId !== 8);
    await ensureCleaningSubmissionsForTaskLog(1);
    expect(canceled.shiftAssignmentId).toBeNull();
    expect(log.status).toBe('completed'); expect(log.updatedBy).toBeNull();
    expect(log.meta.evidenceItems.map((item: any) => item.subjectUserId)).toEqual([7]);
    expect(prepareTaskCompletionPayrollMutation).toHaveBeenCalledTimes(1);
    expect(RequiredAction.update).toHaveBeenCalledWith({ status: false }, expect.objectContaining({ where: expect.anything() }));
  });
  it('never credits an empty roster, and exposes canceled work to managers instead of keeping it invisible', async () => {
    const sub = await materialize(); await upload(sub);
    rows = rows.filter((row) => row.userId !== 7);
    const queue = await listMyCleaningSubmissions(owner);
    expect(log.status).toBe('pending'); expect(sub.shiftAssignmentId).toBeNull();
    expect(prepareTaskCompletionPayrollMutation).not.toHaveBeenCalled();
    expect(queue.taskIssues).toEqual([expect.objectContaining({ taskLogId: 1, code: 'no_active_cleaners' })]);
    expect((await listMyCleaningSubmissions(volunteer)).taskIssues).toEqual([]);
  });
  it('continues existing missed work reconciliation across midnight without fabricating new historical submissions', async () => {
    rows.push(assignment(14, 8, 7)); await materialize();
    const first = submissions.find((row) => row.userId === 7);
    await upload(first); await review(first); rows = rows.filter((row) => row.userId !== 8);
    jest.setSystemTime(new Date('2026-09-08T12:00:00Z')); log.status = 'missed';
    await listMyCleaningSubmissions(owner);
    expect(log.status).toBe('completed');
    expect(CleaningSubmission.create).toHaveBeenCalledTimes(2);
  });
  it('shows a manager issue for a new historical assignee without inheriting the original person photos', async () => {
    const original = await materialize(); await upload(original);
    jest.setSystemTime(new Date('2026-09-08T12:00:00Z')); log.status = 'missed'; rows[0].userId = 8;
    const queue = await listMyCleaningSubmissions(owner);
    expect(original.shiftAssignmentId).toBeNull(); expect(log.status).toBe('missed');
    expect(CleaningSubmission.create).toHaveBeenCalledTimes(1);
    expect(queue.taskIssues).toEqual([expect.objectContaining({ code: 'untracked_cleaning_assignments' })]);
  });
  it('keeps a payroll-blocked cancellation visible without changing settled compensation or fabricating completion', async () => {
    rows.push(assignment(14, 8, 7)); await materialize();
    const first = submissions.find((row) => row.userId === 7);
    await upload(first); await review(first); rows = rows.filter((row) => row.userId !== 8);
    (prepareTaskCompletionPayrollMutation as jest.Mock).mockRejectedValueOnce(new HttpError(409, 'Reconcile settled payroll first.'));
    const queue = await listMyCleaningSubmissions(owner);
    expect(log.status).toBe('pending');
    expect(queue.taskIssues).toEqual([expect.objectContaining({ code: 'settlement_reconciliation_required', message: 'Reconcile settled payroll first.' })]);
  });
  it('allows an explicit canceled-work waiver, retains photos and deactivates review requests without creating cleaning credit', async () => {
    const sub = await materialize(); await upload(sub); rows = rows.filter((row) => row.userId !== 7);
    const result = await waiveCanceledCleaningTask({ ...owner, taskLogId: 1, body: { reason: 'The cleaning shift was canceled.', expectedUpdatedAt: log.updatedAt.toISOString() } });
    expect(result).toEqual({ taskLogId: 1, status: 'waived' });
    expect(log.status).toBe('waived'); expect(log.completedAt).toBeNull();
    expect(log.meta.cleaningPhotoWorkflow.waiver).toMatchObject({ waivedBy: 99, reason: 'The cleaning shift was canceled.' });
    expect(sub.shiftAssignmentId).toBeNull(); expect(photos).toHaveLength(1);
    expect(sub.status).not.toBe('approved'); expect(deleteAssistantManagerTaskEvidenceImage).not.toHaveBeenCalled();
    expect(prepareTaskCompletionPayrollMutation).toHaveBeenCalledWith({ userId: 9, taskDate: '2026-09-07', transaction: tx });
  });
  it('rejects waiver when staff remain scheduled or the user lacks manager authority', async () => {
    await materialize(); const body = { reason: 'Canceled', expectedUpdatedAt: log.updatedAt.toISOString() };
    await expect(waiveCanceledCleaningTask({ ...owner, taskLogId: 1, body })).rejects.toMatchObject({ status: 409 });
    rows = rows.filter((row) => row.userId !== 7);
    await expect(waiveCanceledCleaningTask({ ...volunteer, taskLogId: 1, body })).rejects.toMatchObject({ status: 403 });
    await expect(waiveCanceledCleaningTask({ actorId: 500, roleSlug: 'assistant-manager', taskLogId: 1, body })).rejects.toMatchObject({ status: 403 });
    expect(log.status).toBe('pending');
  });
  it('requires waiver reason and a current task version, and respects settled payroll', async () => {
    await materialize(); rows = rows.filter((row) => row.userId !== 7);
    await expect(waiveCanceledCleaningTask({ ...owner, taskLogId: 1, body: { reason: '', expectedUpdatedAt: log.updatedAt.toISOString() } })).rejects.toMatchObject({ status: 400 });
    await expect(waiveCanceledCleaningTask({ ...owner, taskLogId: 1, body: { reason: 'Canceled', expectedUpdatedAt: '2020-01-01T00:00:00Z' } })).rejects.toMatchObject({ status: 409 });
    (prepareTaskCompletionPayrollMutation as jest.Mock).mockRejectedValueOnce(new HttpError(409, 'Settled payroll'));
    await expect(waiveCanceledCleaningTask({ ...manager, taskLogId: 1, body: { reason: 'Canceled', expectedUpdatedAt: log.updatedAt.toISOString() } })).rejects.toMatchObject({ status: 409 });
    expect(log.status).toBe('pending');
  });
  it('scopes historical reconciliation to related tasks for ordinary users and own tasks for assistant managers', async () => {
    await materialize();
    (AssistantManagerTaskLog.findAll as jest.Mock).mockClear();
    await listMyCleaningSubmissions(volunteer);
    let query = (AssistantManagerTaskLog.findAll as jest.Mock).mock.calls[0][0];
    expect(query.where[Op.or][0]).toEqual({ taskDate: '2026-09-07' });
    expect(query.where[Op.or][1]).toMatchObject({ meta: { cleaningPhotoWorkflow: { managed: true } }, id: { [Op.in]: [1] } });
    (AssistantManagerTaskLog.findAll as jest.Mock).mockClear();
    await listMyCleaningSubmissions({ actorId: 500, roleSlug: 'guide' });
    query = (AssistantManagerTaskLog.findAll as jest.Mock).mock.calls[0][0];
    expect(query.where[Op.or][1].id[Op.in]).toEqual([]);
    (AssistantManagerTaskLog.findAll as jest.Mock).mockClear();
    await listMyCleaningSubmissions(manager);
    query = (AssistantManagerTaskLog.findAll as jest.Mock).mock.calls[0][0];
    expect(query.where[Op.or][1]).toMatchObject({ userId: 9 });
    (AssistantManagerTaskLog.findAll as jest.Mock).mockClear();
    await listMyCleaningSubmissions(owner);
    query = (AssistantManagerTaskLog.findAll as jest.Mock).mock.calls[0][0];
    expect(query.where[Op.or][1]).toEqual({ meta: { cleaningPhotoWorkflow: { managed: true } } });
  });
  it('invalidates a same-ID shift type change even when the new type uses identical photo slots', async () => {
    template.scheduleConfig = structuredClone(config); template.scheduleConfig.shiftEvidenceSources[0].shiftTypeIds.push(8);
    const original = await materialize(); await upload(original);
    rows[0].shiftInstance.shiftTypeId = 8;
    await expect(upload(original)).rejects.toMatchObject({ status: 409 });
    expect((await getCleaningSubmission(original.id, volunteer)).submission.canUpload).toBe(false);
    await ensureCleaningSubmissionsForTaskLog(1);
    expect(original.shiftAssignmentId).toBeNull();
    expect(submissions.some((row) => row.id !== original.id && row.scheduleSnapshot.shiftTypeId === 8)).toBe(true);
    expect(photos[0].submissionId).toBe(original.id);
  });
  it('requires the saved assignment ID and date, not only the same person/physical shift ID', async () => {
    const original = await materialize();
    original.scheduleSnapshot.assignmentId = 500;
    await expect(upload(original)).rejects.toMatchObject({ status: 409 });
    original.scheduleSnapshot.assignmentId = 11; original.scheduleSnapshot.date = '2026-09-06';
    await expect(upload(original)).rejects.toMatchObject({ status: 409 });
    expect(storeAssistantManagerTaskEvidenceImage).not.toHaveBeenCalled();
  });
  it('retargets a pending popup after an on-shift manager replacement and bumps its revision only once', async () => {
    const sub = await materialize(); await upload(sub);
    const oldRevision = sub.revision; const actionId = actions[0].id;
    rows = rows.filter((row) => row.userId !== 9); rows.push(assignment(20, 10, 1, 'manager'));
    await ensureCleaningSubmissionsForTaskLog(1);
    expect(sub.reviewerUserIds).toEqual([10]); expect(sub.revision).toBe(oldRevision + 1);
    expect(actions[0]).toMatchObject({ id: actionId, status: true, targetUserIds: [10], updatedBy: null,
      payload: { cleaningSubmission: { submissionId: sub.id, revision: oldRevision + 1 } } });
    expect(await getCleaningReviewActionPayload(actionId, sub.id, 9)).toBeNull();
    expect(await getCleaningReviewActionPayload(actionId, sub.id, 10)).toMatchObject({ pendingPhotos: 1, revision: oldRevision + 1 });
    actions[0].update.mockClear(); sub.update.mockClear();
    await ensureCleaningSubmissionsForTaskLog(1);
    expect(sub.revision).toBe(oldRevision + 1); expect(sub.update).not.toHaveBeenCalled(); expect(actions[0].update).not.toHaveBeenCalled();
  });
  it('moves a pending popup to management escalation when the reviewer disappears, then to a newly scheduled manager', async () => {
    const sub = await materialize(); await upload(sub); const revision = sub.revision;
    rows = rows.filter((row) => row.userId !== 9);
    await ensureCleaningSubmissionsForTaskLog(1);
    expect(sub).toMatchObject({ status: 'escalated', reviewerUserIds: [], revision: revision + 1 });
    expect(actions[0].targetUserIds).toEqual([99]);
    rows.push(assignment(20, 10, 1, 'manager'));
    await ensureCleaningSubmissionsForTaskLog(1);
    expect(sub).toMatchObject({ status: 'awaiting_review', reviewerUserIds: [10], revision: revision + 2 });
    expect(actions[0].targetUserIds).toEqual([10]);
  });
  it('retargets changed escalation membership and disables stale popups if no authorized reviewer remains', async () => {
    rows = rows.filter((row) => row.userId !== 9); const sub = await materialize(); await upload(sub);
    const revision = sub.revision;
    userModel.findAll.mockImplementation(async (options) => options?.include ? [{ id: 101, role: { slug: 'admin' } }] : []);
    await ensureCleaningSubmissionsForTaskLog(1);
    expect(actions[0].targetUserIds).toEqual([101]); expect(sub.revision).toBe(revision + 1);
    userModel.findAll.mockResolvedValue([]);
    await ensureCleaningSubmissionsForTaskLog(1);
    expect(actions[0].status).toBe(false); expect(sub.revision).toBe(revision + 2);
    await ensureCleaningSubmissionsForTaskLog(1);
    expect(sub.revision).toBe(revision + 2);
  });
  it('does not churn pending popup revisions or reappearances during unchanged homepage refreshes', async () => {
    const sub = await materialize(); await upload(sub); const revision = sub.revision;
    actions[0].update.mockClear(); sub.update.mockClear();
    await listMyCleaningSubmissions(owner); await listMyCleaningSubmissions(owner);
    expect(sub.revision).toBe(revision); expect(sub.update).not.toHaveBeenCalled(); expect(actions[0].update).not.toHaveBeenCalled();
  });
});
