import dayjs from 'dayjs';
import { Op, type Transaction } from 'sequelize';
import sequelize from '../config/database.js';
import HttpError from '../errors/HttpError.js';
import AssistantManagerTaskLog from '../models/AssistantManagerTaskLog.js';
import AssistantManagerTaskTemplate from '../models/AssistantManagerTaskTemplate.js';
import AuditLog from '../models/AuditLog.js';
import CleaningSubmission from '../models/CleaningSubmission.js';
import CleaningPhotoVersion from '../models/CleaningPhotoVersion.js';
import RequiredAction from '../models/RequiredAction.js';
import ScheduleWeek from '../models/ScheduleWeek.js';
import ShiftAssignment from '../models/ShiftAssignment.js';
import ShiftInstance from '../models/ShiftInstance.js';
import ShiftRole from '../models/ShiftRole.js';
import ShiftType from '../models/ShiftType.js';
import User from '../models/User.js';
import UserType from '../models/UserType.js';
import logger from '../utils/logger.js';
import { prepareTaskCompletionPayrollMutation } from './taskCompletionPayrollService.js';
import { normalizeCleaningPhoto } from './cleaningPhotoValidationService.js';
import { storeAssistantManagerTaskEvidenceImage, deleteAssistantManagerTaskEvidenceImage,
  openAssistantManagerTaskEvidenceImageStream } from './assistantManagerTaskEvidenceStorageService.js';
import { assertCleaningRevision, cleaningPhotoWorkflowEnabled, CLEANING_TIMEZONE, CLEANING_WORKFLOW_META_KEY,
  objectValue, readCleaningPhotoSources, shiftsOverlap, type CleaningPhotoSlotSource, type CleaningRequiredSlot } from './cleaningSubmissionRulesService.js';

export type CleaningActor = { actorId: number; roleSlug: string | null };
type RosterAssignment = ShiftAssignment & {
  assignee?: User; shiftRole?: ShiftRole;
  shiftInstance?: ShiftInstance & { shiftType?: ShiftType; scheduleWeek?: ScheduleWeek };
};
type Context = { submission: CleaningSubmission; log: AssistantManagerTaskLog; template: AssistantManagerTaskTemplate;
  assignment: RosterAssignment | null; reviewers: number[]; actor: CleaningActor; photos: CleaningPhotoVersion[] };
const normalizeRole = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/[\s_-]/gu, '');
export const isCleaningGlobalManager = (actor: CleaningActor) => ['admin', 'administrator', 'owner', 'manager'].includes(normalizeRole(actor.roleSlug));
const positiveId = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const assertActor = (actor: CleaningActor) => { if (!positiveId(actor.actorId)) throw new HttpError(401, 'Authentication is required.'); };
const today = () => dayjs().tz(CLEANING_TIMEZONE).format('YYYY-MM-DD');
const fullName = (user: Pick<User, 'id' | 'firstName' | 'lastName'> | null | undefined) =>
  `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim() || `Staff #${user?.id ?? ''}`;
const canonicalSlots = (slots: CleaningRequiredSlot[]) => JSON.stringify([...slots].sort((a, b) => a.key.localeCompare(b.key)));

export const isCleaningTaskCompletionManaged = (scheduleConfig: unknown, meta: unknown): boolean =>
  cleaningPhotoWorkflowEnabled(scheduleConfig) || objectValue(objectValue(meta)[CLEANING_WORKFLOW_META_KEY]).managed === true;

const getSources = (log: AssistantManagerTaskLog, template: AssistantManagerTaskTemplate): CleaningPhotoSlotSource[] => {
  const savedConfig = objectValue(objectValue(log.meta)[CLEANING_WORKFLOW_META_KEY]).scheduleConfig;
  return readCleaningPhotoSources(savedConfig ?? template.scheduleConfig);
};

/** Select the real published roster; no inferred attendance and no current-profile filtering. */
const loadRoster = async (date: string, shiftTypeIds?: number[], transaction?: Transaction): Promise<RosterAssignment[]> => {
  const rows = await ShiftAssignment.findAll({
    include: [{ model: User, as: 'assignee', attributes: ['id', 'firstName', 'lastName', 'status', 'approved'], required: true },
      { model: ShiftRole, as: 'shiftRole', attributes: ['id', 'slug'], required: false },
      { model: ShiftInstance, as: 'shiftInstance', required: true,
        where: { date: shiftTypeIds ? date : { [Op.between]: [dayjs(date).subtract(1, 'day').format('YYYY-MM-DD'), dayjs(date).add(1, 'day').format('YYYY-MM-DD')] },
          ...(shiftTypeIds ? { shiftTypeId: { [Op.in]: shiftTypeIds } } : {}) },
        include: [{ model: ScheduleWeek, as: 'scheduleWeek', required: true, where: { state: 'published' } },
          { model: ShiftType, as: 'shiftType', attributes: ['id', 'name'], required: false }] }],
    order: [['id', 'ASC']], transaction,
  }) as RosterAssignment[];
  return rows;
};

export const deduplicateCleaningRoster = (rows: RosterAssignment[]): RosterAssignment[] => {
  const seen = new Set<string>();
  return rows.filter((row) => { const key = `${row.userId}:${row.shiftInstanceId}`; if (seen.has(key)) return false; seen.add(key); return true; });
};
const slotsFor = (assignment: RosterAssignment, sources: CleaningPhotoSlotSource[]) => sources
  .filter((source) => source.shiftTypeIds.includes(assignment.shiftInstance?.shiftTypeId ?? -1)).flatMap((source) => source.slots);
const matchesSubmissionIdentity = (submission: CleaningSubmission, assignment: RosterAssignment, taskDate: string): boolean => {
  const snapshot = objectValue(submission.scheduleSnapshot);
  return submission.shiftAssignmentId === assignment.id && submission.userId === assignment.userId
    && snapshot.assignmentId === assignment.id && snapshot.shiftInstanceId === assignment.shiftInstanceId
    && snapshot.date === taskDate && assignment.shiftInstance?.date === snapshot.date
    && assignment.shiftInstance?.shiftTypeId === snapshot.shiftTypeId;
};
const reviewerIds = (assignment: RosterAssignment, roster: RosterAssignment[]): number[] => [...new Set(roster.filter((candidate) =>
  candidate.userId !== assignment.userId && candidate.assignee?.status === true && candidate.assignee?.approved === true
  && ['manager', 'assistantmanager'].includes(normalizeRole(candidate.shiftRole?.slug ?? candidate.roleInShift))
  && assignment.shiftInstance && candidate.shiftInstance && shiftsOverlap(assignment.shiftInstance, candidate.shiftInstance))
  .map((candidate) => candidate.userId))];
const latestPhotos = (photos: CleaningPhotoVersion[]) => {
  const map = new Map<string, CleaningPhotoVersion>();
  for (const photo of photos) if (!map.has(photo.slotKey) || map.get(photo.slotKey)!.version < photo.version) map.set(photo.slotKey, photo);
  return map;
};

/** Materialization is idempotent and serialized with uploads/reviews by the task log row. */
export const ensureCleaningSubmissionsForTaskLog = async (taskLogId: number, transaction?: Transaction): Promise<CleaningSubmission[]> => {
  if (!transaction) return sequelize.transaction((tx) => ensureCleaningSubmissionsForTaskLog(taskLogId, tx));
  const log = await AssistantManagerTaskLog.findByPk(taskLogId, { transaction, lock: transaction.LOCK.UPDATE });
  if (!log) return [];
  const template = await AssistantManagerTaskTemplate.findByPk(log.templateId, { transaction });
  if (!template || !isCleaningTaskCompletionManaged(template.scheduleConfig, log.meta)) return [];
  const sources = getSources(log, template);
  const existing = await CleaningSubmission.findAll({ where: { taskLogId }, order: [['id', 'ASC']], transaction });
  // Do not silently manufacture past work or attach work to an already closed task.
  if (!['pending', 'missed'].includes(log.status) || (log.taskDate !== today() && existing.length === 0)) return existing;
  let roster = deduplicateCleaningRoster(await loadRoster(log.taskDate, [...new Set(sources.flatMap((source) => source.shiftTypeIds))], transaction));
  let managers = await loadRoster(log.taskDate, undefined, transaction);
  const relatedRows = [...roster, ...managers];
  const assignmentIds = [...new Set(relatedRows.map((row) => row.id))].sort((a, b) => a - b);
  const shiftIds = [...new Set(relatedRows.map((row) => row.shiftInstanceId))].sort((a, b) => a - b);
  const weekIds = [...new Set(relatedRows.map((row) => row.shiftInstance?.scheduleWeekId).filter(positiveId))].sort((a, b) => a - b);
  if (weekIds.length) await ScheduleWeek.findAll({ where: { id: { [Op.in]: weekIds } }, order: [['id', 'ASC']], transaction, lock: transaction.LOCK.UPDATE });
  if (shiftIds.length) await ShiftInstance.findAll({ where: { id: { [Op.in]: shiftIds } }, order: [['id', 'ASC']], transaction, lock: transaction.LOCK.UPDATE });
  if (assignmentIds.length) await ShiftAssignment.findAll({ where: { id: { [Op.in]: assignmentIds } }, order: [['id', 'ASC']], transaction, lock: transaction.LOCK.UPDATE });
  roster = deduplicateCleaningRoster(await loadRoster(log.taskDate, [...new Set(sources.flatMap((source) => source.shiftTypeIds))], transaction));
  managers = await loadRoster(log.taskDate, undefined, transaction);
  if (objectValue(objectValue(log.meta)[CLEANING_WORKFLOW_META_KEY]).managed !== true) {
    await log.update({ meta: { ...log.meta, [CLEANING_WORKFLOW_META_KEY]: { version: 1, managed: true, scheduleConfig: template.scheduleConfig } } }, { transaction });
  }
  for (const prior of existing) {
    const stillAssigned = roster.some((row) => matchesSubmissionIdentity(prior, row, log.taskDate));
    if (!stillAssigned) {
      if (prior.shiftAssignmentId != null) await prior.update({ shiftAssignmentId: null, revision: prior.revision + 1 }, { transaction });
      await RequiredAction.update({ status: false }, { where: actionWhere(prior.id), transaction });
    }
  }
  for (const assignment of roster) {
    const sameAssignment = existing.find((row) => row.shiftAssignmentId === assignment.id);
    if (sameAssignment && sameAssignment.userId === assignment.userId) continue;
    // An assignment changing owners never transfers the previous person's proof.
    if (sameAssignment) {
      await sameAssignment.update({ shiftAssignmentId: null, revision: sameAssignment.revision + 1 }, { transaction });
      await RequiredAction.update({ status: false }, { where: actionWhere(sameAssignment.id), transaction });
    }
    // New people added after the task day require an explicit new task; no automatic historical workload.
    if (log.taskDate !== today()) continue;
    const requiredSlots = slotsFor(assignment, sources);
    if (!requiredSlots.length) continue;
    const reviewers = reviewerIds(assignment, managers);
    const row = await CleaningSubmission.create({ taskLogId, shiftAssignmentId: assignment.id, userId: assignment.userId,
      requiredSlots, reviewerUserIds: reviewers, revision: 1, status: reviewers.length ? 'awaiting_upload' : 'escalated',
      scheduleSnapshot: { assignmentId: assignment.id, shiftInstanceId: assignment.shiftInstanceId,
        shiftTypeId: assignment.shiftInstance!.shiftTypeId, date: log.taskDate, timeStart: assignment.shiftInstance!.timeStart,
        timeEnd: assignment.shiftInstance!.timeEnd, shiftName: assignment.shiftInstance!.shiftType?.name ?? 'Cleaning', subjectName: fullName(assignment.assignee) },
    }, { transaction });
    existing.push(row);
  }
  for (const submission of existing) {
    const assignment = roster.find((row) => matchesSubmissionIdentity(submission, row, log.taskDate));
    if (!assignment) continue;
    const photos = await CleaningPhotoVersion.findAll({ where: { submissionId: submission.id }, order: [['version', 'DESC'], ['id', 'DESC']], transaction });
    if (![...latestPhotos(photos).values()].some((photo) => photo.status === 'pending')) continue;
    await reconcileCleaningReviewRouting({ submission, log, template, assignment, photos,
      reviewers: reviewerIds(assignment, managers), actor: { actorId: log.userId, roleSlug: null } }, transaction);
  }
  let rosterIssue: { code: string; message: string } | null = null;
  if (roster.length === 0) {
    rosterIssue = { code: 'no_active_cleaners', message: 'No cleaning staff remain on the published roster. This task has not been marked complete. A manager must resolve the canceled work.' };
  } else if (roster.some((assignment) => !existing.some((submission) => submission.shiftAssignmentId === assignment.id && submission.userId === assignment.userId))) {
    rosterIssue = { code: 'untracked_cleaning_assignments', message: 'The published roster changed after this task date. Previous photos were not transferred. A manager must resolve the newly assigned staff.' };
  } else {
    try {
      // A canceled outstanding participant can make the remaining, independently approved evidence complete.
      // Reconciliation is automatic; do not falsely attribute it to the person opening the homepage.
      await completeTaskIfApproved({ log, template, actor: { actorId: log.userId, roleSlug: null } }, transaction, null);
    } catch (error) {
      if (!(error instanceof HttpError && error.status === 409)) throw error;
      rosterIssue = { code: 'settlement_reconciliation_required', message: error.message };
    }
  }
  const savedWorkflow = objectValue(log.meta[CLEANING_WORKFLOW_META_KEY]);
  if (JSON.stringify(savedWorkflow.rosterIssue ?? null) !== JSON.stringify(rosterIssue)) {
    const nextWorkflow = { ...savedWorkflow };
    if (rosterIssue) nextWorkflow.rosterIssue = rosterIssue;
    else delete nextWorkflow.rosterIssue;
    await log.update({ meta: { ...log.meta, [CLEANING_WORKFLOW_META_KEY]: nextWorkflow } }, { transaction });
  }
  return existing;
};

const loadContext = async (submissionId: number, actor: CleaningActor, transaction?: Transaction, requireLive = false): Promise<Context> => {
  assertActor(actor);
  if (!positiveId(submissionId)) throw new HttpError(400, 'A valid cleaning submission is required.');
  const initial = await CleaningSubmission.findByPk(submissionId, { transaction });
  if (!initial) throw new HttpError(404, 'Cleaning submission was not found.');
  const log = await AssistantManagerTaskLog.findByPk(initial.taskLogId, { transaction, ...(transaction ? { lock: transaction.LOCK.UPDATE } : {}) });
  if (!log) throw new HttpError(404, 'Cleaning task was not found.');
  const submission = transaction ? await CleaningSubmission.findByPk(submissionId, { transaction, lock: transaction.LOCK.UPDATE }) : initial;
  if (!submission) throw new HttpError(404, 'Cleaning submission was not found.');
  const template = await AssistantManagerTaskTemplate.findByPk(log.templateId, { transaction });
  if (!template) throw new HttpError(404, 'Cleaning template was not found.');
  const sources = getSources(log, template);
  const roster = deduplicateCleaningRoster(await loadRoster(log.taskDate, [...new Set(sources.flatMap((source) => source.shiftTypeIds))], transaction));
  let assignment = roster.find((row) => matchesSubmissionIdentity(submission, row, log.taskDate)) ?? null;
  let reviewers = assignment ? reviewerIds(assignment, await loadRoster(log.taskDate, undefined, transaction)) : [];
  if (actor.actorId !== submission.userId && !reviewers.includes(actor.actorId) && !isCleaningGlobalManager(actor)) {
    throw new HttpError(404, 'Cleaning submission was not found.');
  }
  if (requireLive) {
    if (!assignment || submission.shiftAssignmentId == null || !isCleaningTaskCompletionManaged(template.scheduleConfig, log.meta)) {
      throw new HttpError(409, 'This cleaning assignment is no longer on the published schedule.');
    }
    if (canonicalSlots(slotsFor(assignment, sources)) !== canonicalSlots(submission.requiredSlots)) {
      throw new HttpError(409, 'The cleaning requirements changed. Ask a manager to review this task.');
    }
    if (!['pending', 'missed'].includes(log.status) || log.taskDate > today()) throw new HttpError(409, 'This cleaning task is not open for changes.');
    // Lock the assignment, shift and published schedule before accepting mutations; re-check after locks.
    const lockedAssignment = await ShiftAssignment.findByPk(assignment.id, { transaction, ...(transaction ? { lock: transaction.LOCK.UPDATE } : {}) });
    const lockedShift = lockedAssignment && await ShiftInstance.findByPk(lockedAssignment.shiftInstanceId, { transaction, ...(transaction ? { lock: transaction.LOCK.UPDATE } : {}) });
    const lockedWeek = lockedShift && await ScheduleWeek.findByPk(lockedShift.scheduleWeekId, { transaction, ...(transaction ? { lock: transaction.LOCK.UPDATE } : {}) });
    if (!lockedAssignment || lockedAssignment.userId !== submission.userId || lockedAssignment.shiftInstanceId !== assignment.shiftInstanceId
      || !lockedShift || lockedShift.date !== log.taskDate || lockedShift.shiftTypeId !== assignment.shiftInstance!.shiftTypeId
      || lockedWeek?.state !== 'published') throw new HttpError(409, 'The schedule changed. Refresh before continuing.');
    if (transaction) {
      const managerRoster = await loadRoster(log.taskDate, undefined, transaction);
      const allRows = [...roster, ...managerRoster];
      const assignmentIds = [...new Set(allRows.map((row) => row.id))].sort((a, b) => a - b);
      const shiftIds = [...new Set(allRows.map((row) => row.shiftInstanceId))].sort((a, b) => a - b);
      const weekIds = [...new Set(allRows.map((row) => row.shiftInstance?.scheduleWeekId).filter(positiveId))].sort((a, b) => a - b);
      await ScheduleWeek.findAll({ where: { id: { [Op.in]: weekIds } }, order: [['id', 'ASC']], transaction, lock: transaction.LOCK.UPDATE });
      await ShiftInstance.findAll({ where: { id: { [Op.in]: shiftIds } }, order: [['id', 'ASC']], transaction, lock: transaction.LOCK.UPDATE });
      await ShiftAssignment.findAll({ where: { id: { [Op.in]: assignmentIds } }, order: [['id', 'ASC']], transaction, lock: transaction.LOCK.UPDATE });
      const current = deduplicateCleaningRoster(await loadRoster(log.taskDate, [...new Set(sources.flatMap((source) => source.shiftTypeIds))], transaction));
      const refreshedAssignment = current.find((row) => matchesSubmissionIdentity(submission, row, log.taskDate));
      if (!refreshedAssignment) {
        throw new HttpError(409, 'The cleaning assignment changed. Refresh before continuing.');
      }
      // Shift times may also have changed while waiting for a row lock. Use the refreshed interval for review authority.
      assignment = refreshedAssignment;
      reviewers = reviewerIds(assignment, await loadRoster(log.taskDate, undefined, transaction));
    }
  }
  const photos = await CleaningPhotoVersion.findAll({ where: { submissionId }, order: [['version', 'DESC'], ['id', 'DESC']], transaction });
  return { submission, log, template, assignment, reviewers, actor, photos };
};

const canReviewContext = (context: Context) => context.actor.actorId !== context.submission.userId && Boolean(context.assignment)
  && ['pending', 'missed'].includes(context.log.status)
  && (context.reviewers.includes(context.actor.actorId) || (context.reviewers.length === 0 && isCleaningGlobalManager(context.actor)));

const serialize = async (context: Context, transaction?: Transaction) => {
  const { submission, log, template, assignment, reviewers, actor, photos } = context;
  const users = await User.findAll({ where: { id: { [Op.in]: [...new Set(photos.map((photo) => photo.reviewedBy).filter(positiveId))] } },
    attributes: ['id', 'firstName', 'lastName'], transaction });
  const names = new Map(users.map((user) => [user.id, fullName(user)]));
  const versionDto = (photo: CleaningPhotoVersion) => ({ id: photo.id, version: photo.version, status: photo.status,
    fileName: photo.fileName, mimeType: photo.mimeType, fileSize: photo.fileSize,
    uploadedAt: new Date(photo.uploadedAt).toISOString(), reviewedAt: photo.reviewedAt ? new Date(photo.reviewedAt).toISOString() : null,
    reviewerName: photo.reviewedBy ? names.get(photo.reviewedBy) ?? `Staff #${photo.reviewedBy}` : null,
    rejectionReason: photo.rejectionReason, photoUrl: `/api/cleaningSubmissions/${submission.id}/photos/${photo.id}` });
  const latest = latestPhotos(photos);
  return { id: submission.id, taskLogId: log.id, shiftAssignmentId: submission.shiftAssignmentId, userId: submission.userId,
    subjectName: String(objectValue(submission.scheduleSnapshot).subjectName ?? fullName(assignment?.assignee)), taskDate: log.taskDate,
    title: template.name, shiftName: String(objectValue(submission.scheduleSnapshot).shiftName ?? 'Cleaning'), status: submission.status,
    revision: submission.revision, reviewerMissing: reviewers.length === 0, canReview: canReviewContext(context),
    canUpload: actor.actorId === submission.userId && Boolean(assignment) && ['pending', 'missed'].includes(log.status) && log.taskDate <= today(),
    escalationReason: !assignment ? 'The assignment is no longer on the published schedule.' : reviewers.length === 0 ? 'No other manager is on the overlapping published shift.' : null,
    slots: submission.requiredSlots.map((slot) => ({ ...slot, status: latest.get(slot.key)?.status ?? 'missing',
      currentVersion: latest.has(slot.key) ? versionDto(latest.get(slot.key)!) : null,
      history: photos.filter((photo) => photo.slotKey === slot.key).map(versionDto) })) };
};

export const getCleaningSubmission = async (submissionId: number, actor: CleaningActor) => ({ submission: await serialize(await loadContext(submissionId, actor)) });

export const listMyCleaningSubmissions = async (actor: CleaningActor) => {
  assertActor(actor);
  // Restrict candidate submissions before loading protected contexts. Include live manager dates so a newly
  // assigned reviewer can pick up a pending request even when its original target list is now stale.
  const actorShifts = await ShiftAssignment.findAll({ where: { userId: actor.actorId },
    attributes: ['id', 'userId', 'roleInShift', 'shiftInstanceId'],
    include: [{ model: ShiftRole, as: 'shiftRole', attributes: ['slug'], required: false }, { model: ShiftInstance, as: 'shiftInstance', required: true,
      attributes: ['id', 'date', 'timeStart', 'timeEnd'],
      include: [{ model: ScheduleWeek, as: 'scheduleWeek', attributes: ['id'], required: true, where: { state: 'published' } }] }] }) as RosterAssignment[];
  const managerShifts = actorShifts.filter((row) => ['manager', 'assistantmanager'].includes(normalizeRole(row.shiftRole?.slug ?? row.roleInShift)));
  const managerDates = [...new Set(managerShifts
    .flatMap((row) => [-1, 0, 1].map((offset) => dayjs(row.shiftInstance!.date).add(offset, 'day').format('YYYY-MM-DD'))))];
  const globalManager = isCleaningGlobalManager(actor);
  const assistantManager = normalizeRole(actor.roleSlug) === 'assistantmanager';
  let relatedTaskIds: number[] = [];
  if (!globalManager && !assistantManager) {
    const relatedSubmissions = await CleaningSubmission.findAll({ attributes: ['taskLogId', 'userId', 'reviewerUserIds', 'scheduleSnapshot'],
      where: { [Op.or]: [{ userId: actor.actorId }, { reviewerUserIds: { [Op.contains]: [actor.actorId] } },
        ...(managerDates.length ? [{ scheduleSnapshot: { date: { [Op.in]: managerDates } } }] : [])] } });
    relatedTaskIds = [...new Set(relatedSubmissions.filter((row) => row.userId === actor.actorId || row.reviewerUserIds?.includes(actor.actorId)
      || managerShifts.some((shift) => {
        const snapshot = objectValue(row.scheduleSnapshot);
        return typeof snapshot.date === 'string' && typeof snapshot.timeStart === 'string'
          && typeof snapshot.timeEnd === 'string' && shift.shiftInstance
          && shiftsOverlap({ date: snapshot.date, timeStart: snapshot.timeStart, timeEnd: snapshot.timeEnd }, shift.shiftInstance);
      })).map((row) => row.taskLogId))];
  }
  const historicalScope = globalManager ? {} : assistantManager ? { userId: actor.actorId } : { id: { [Op.in]: relatedTaskIds } };
  const logs = await AssistantManagerTaskLog.findAll({ where: { taskDate: { [Op.lte]: today() }, status: { [Op.in]: ['pending', 'missed'] },
    [Op.or]: [{ taskDate: today() }, { meta: { cleaningPhotoWorkflow: { managed: true } }, ...historicalScope }] },
    include: [{ model: AssistantManagerTaskTemplate, as: 'template', required: true }], order: [['id', 'ASC']] });
  for (const log of logs) if (isCleaningTaskCompletionManaged(log.template?.scheduleConfig, log.meta)) await ensureCleaningSubmissionsForTaskLog(log.id);
  const reviewAudience = isCleaningGlobalManager(actor) ? {} : { [Op.or]: [
    { reviewerUserIds: { [Op.contains]: [actor.actorId] } },
    ...(managerDates.length ? [{ scheduleSnapshot: { date: { [Op.in]: managerDates } } }] : []),
  ] };
  const all = await CleaningSubmission.findAll({ where: { shiftAssignmentId: { [Op.ne]: null }, [Op.or]: [
    { userId: actor.actorId, [Op.or]: [{ status: { [Op.ne]: 'approved' } }, { createdAt: { [Op.gte]: dayjs().subtract(7, 'day').toDate() } }] },
    { status: { [Op.in]: ['awaiting_review', 'escalated'] }, ...reviewAudience },
  ] }, order: [['id', 'DESC']] });
  const submissions: Awaited<ReturnType<typeof serialize>>[] = [];
  const reviewSubmissions: Awaited<ReturnType<typeof serialize>>[] = [];
  for (const row of all) {
    try {
      const context = await loadContext(row.id, actor);
      if (!context.assignment || context.log.status === 'waived') continue;
      const dto = await serialize(context);
      if (row.userId === actor.actorId) submissions.push(dto);
      else if (canReviewContext(context) && context.photos.some((photo) => latestPhotos(context.photos).get(photo.slotKey)?.id === photo.id && photo.status === 'pending')) reviewSubmissions.push(dto);
    } catch (error) { if (!(error instanceof HttpError && error.status === 404)) throw error; }
  }
  const taskIssues: { taskLogId: number; taskDate: string; title: string; code: string; message: string; canWaive: boolean; updatedAt: string }[] = [];
  if (isCleaningGlobalManager(actor) || normalizeRole(actor.roleSlug) === 'assistantmanager') {
    const issueLogs = await AssistantManagerTaskLog.findAll({ where: { id: { [Op.in]: logs.map((log) => log.id) },
      status: { [Op.in]: ['pending', 'missed'] }, ...(isCleaningGlobalManager(actor) ? {} : { userId: actor.actorId }) },
      include: [{ model: AssistantManagerTaskTemplate, as: 'template', required: true }] });
    for (const log of issueLogs) {
      const issue = objectValue(objectValue(log.meta[CLEANING_WORKFLOW_META_KEY]).rosterIssue);
      if (typeof issue.code === 'string' && typeof issue.message === 'string') taskIssues.push({ taskLogId: log.id,
        taskDate: log.taskDate, title: log.template?.name ?? 'Cleaning task', code: issue.code, message: issue.message,
        canWaive: issue.code === 'no_active_cleaners', updatedAt: new Date(log.updatedAt).toISOString() });
    }
  }
  return { submissions, reviewSubmissions, taskIssues };
};

const actionWhere = (submissionId: number) => ({ type: 'cleaning_review', payload: { cleaningSubmission: { submissionId } } });
const normalizedIds = (values: number[] | null | undefined): number[] => [...new Set((values ?? []).filter(positiveId))].sort((a, b) => a - b);
const resolveReviewTargets = async (context: Pick<Context, 'reviewers' | 'submission'>, transaction: Transaction): Promise<number[]> => {
  if (context.reviewers.length) return normalizedIds(context.reviewers);
  const managers = await User.findAll({ where: { status: true, approved: true }, attributes: ['id'],
    include: [{ model: UserType, as: 'role', required: true, attributes: ['slug'] }], transaction });
  return normalizedIds(managers.filter((user) => user.id !== context.submission.userId
    && isCleaningGlobalManager({ actorId: user.id, roleSlug: (user as unknown as { role?: UserType }).role?.slug ?? null })).map((user) => user.id));
};
const syncReviewAction = async (context: Context, transaction: Transaction,
  options: { actions?: RequiredAction[]; targets?: number[]; actorId?: number | null } = {}) => {
  const latest = latestPhotos(context.photos);
  const pending = [...latest.values()].filter((photo) => photo.status === 'pending');
  const actions = options.actions ?? await RequiredAction.findAll({ where: actionWhere(context.submission.id), order: [['id', 'ASC']], transaction, lock: transaction.LOCK.UPDATE });
  const actorId = options.actorId === undefined ? context.actor.actorId : options.actorId;
  if (!pending.length || !context.assignment) {
    for (const action of actions) if (action.status) await action.update({ status: false, updatedBy: actorId }, { transaction });
    return;
  }
  // Escalation stays in the manager homepage queue; no broad broadcast to ordinary users.
  const targets = options.targets ?? await resolveReviewTargets(context, transaction);
  if (!targets.length) {
    for (const action of actions) if (action.status) await action.update({ status: false, updatedBy: actorId }, { transaction });
    return;
  }
  const values = { type: 'cleaning_review', title: 'Review cleaning photos', body: 'Approve the photos or request a retake.',
    payload: { cleaningSubmission: { submissionId: context.submission.id, revision: context.submission.revision } }, targetUserIds: targets,
    targetUserTypeIds: null, targetShiftRoleIds: null, targetStaffProfileTypes: null, requiresCompletion: false, requiresSignature: false,
    status: true, updatedBy: actorId };
  if (actions[0]) await actions[0].update(values, { transaction });
  else await RequiredAction.create({ ...values, createdBy: actorId }, { transaction });
  for (const action of actions.slice(1)) await action.update({ status: false }, { transaction });
};

/** A shift-manager change must move pending popups as well as live review authorization. */
const reconcileCleaningReviewRouting = async (context: Context, transaction: Transaction) => {
  const actions = await RequiredAction.findAll({ where: actionWhere(context.submission.id), order: [['id', 'ASC']], transaction, lock: transaction.LOCK.UPDATE });
  const targets = await resolveReviewTargets(context, transaction);
  const previousReviewers = normalizedIds(context.submission.reviewerUserIds);
  const reviewers = normalizedIds(context.reviewers);
  const active = actions.filter((action) => action.status);
  const routingChanged = JSON.stringify(previousReviewers) !== JSON.stringify(reviewers)
    || (targets.length === 0 ? active.length > 0 : active.length !== 1
      || JSON.stringify(normalizedIds(active[0]?.targetUserIds)) !== JSON.stringify(targets));
  if (!routingChanged) return;
  await context.submission.update({ reviewerUserIds: reviewers, revision: context.submission.revision + 1,
    status: reviewers.length ? 'awaiting_review' : 'escalated' }, { transaction });
  await syncReviewAction(context, transaction, { actions, targets, actorId: null });
  await AuditLog.create({ actorId: null, action: 'cleaning.review_rerouted', entity: 'am_task_log', entityId: String(context.log.id),
    metaJson: { submissionId: context.submission.id, revision: context.submission.revision,
      previousReviewerUserIds: previousReviewers, reviewerUserIds: reviewers, targetUserIds: targets,
      source: 'published_roster_reconciliation' } }, { transaction });
};

const updateSubmissionStatus = async (context: Context, transaction: Transaction) => {
  const latest = latestPhotos(context.photos);
  const allApproved = context.submission.requiredSlots.every((slot) => latest.get(slot.key)?.status === 'approved');
  const pending = [...latest.values()].some((photo) => photo.status === 'pending');
  const status = allApproved ? 'approved' : context.reviewers.length === 0 ? 'escalated' : pending ? 'awaiting_review' : 'awaiting_upload';
  await context.submission.update({ status, reviewerUserIds: context.reviewers, revision: context.submission.revision + 1 }, { transaction });
  await syncReviewAction(context, transaction);
};

export const uploadCleaningSubmissionPhoto = async (params: CleaningActor & { submissionId: number; slotKey: string; expectedRevision: unknown; data: Buffer }) => {
  const preflight = await loadContext(params.submissionId, params, undefined, true);
  if (preflight.submission.userId !== params.actorId) throw new HttpError(403, 'Only the assigned person can submit their cleaning photos.');
  assertCleaningRevision(params.expectedRevision, preflight.submission.revision);
  const slot = preflight.submission.requiredSlots.find((item) => item.key === params.slotKey);
  if (!slot) throw new HttpError(400, 'This photo slot is not part of your cleaning task.');
  const previous = latestPhotos(preflight.photos).get(slot.key);
  if (previous && previous.status !== 'rejected') throw new HttpError(409, 'Only a missing or rejected photo can be uploaded.');
  const normalized = await normalizeCleaningPhoto(params.data);
  const stored = await storeAssistantManagerTaskEvidenceImage({ logId: preflight.log.id, taskDate: preflight.log.taskDate,
    ruleKey: slot.ruleKey, originalName: normalized.fileName, mimeType: normalized.mimeType, data: normalized.data });
  try {
    await sequelize.transaction(async (transaction) => {
      const context = await loadContext(params.submissionId, params, transaction, true);
      if (context.submission.userId !== params.actorId) throw new HttpError(403, 'Only the assigned person can submit cleaning photos.');
      assertCleaningRevision(params.expectedRevision, context.submission.revision);
      const latest = latestPhotos(context.photos).get(slot.key);
      if (latest && latest.status !== 'rejected') throw new HttpError(409, 'This photo already has a pending or approved version.');
      const photo = await CleaningPhotoVersion.create({ submissionId: context.submission.id, slotKey: slot.key,
        version: (latest?.version ?? 0) + 1, ...stored, fileName: normalized.fileName, mimeType: normalized.mimeType,
        fileSize: normalized.data.length, sha256: normalized.sha256, width: normalized.width, height: normalized.height,
        status: 'pending', uploadedBy: params.actorId, uploadedAt: new Date() }, { transaction });
      context.photos.push(photo);
      await updateSubmissionStatus(context, transaction);
      await AuditLog.create({ actorId: params.actorId, action: 'cleaning.photo_uploaded', entity: 'am_task_log', entityId: String(context.log.id),
        metaJson: { submissionId: context.submission.id, photoId: photo.id, slotKey: slot.key, version: photo.version, sha256: photo.sha256 } }, { transaction });
    });
  } catch (error) {
    // The file was created by this failed attempt and was never accepted as evidence.
    try {
      // A commit acknowledgement can fail after the database committed. Never delete a file referenced by a saved version.
      const saved = await CleaningPhotoVersion.findOne({ where: { driveFileId: stored.driveFileId }, attributes: ['id'] });
      if (!saved) await deleteAssistantManagerTaskEvidenceImage(stored);
    } catch (cleanupError) { logger.warn('Unable to verify or clean up an uncommitted cleaning upload; its file has been retained.', cleanupError); }
    throw error;
  }
  return getCleaningSubmission(params.submissionId, params);
};

const completeTaskIfApproved = async (context: Pick<Context, 'log' | 'template' | 'actor'>, transaction: Transaction,
  completionActorId: number | null = context.actor.actorId): Promise<boolean> => {
  const { log, template } = context;
  if (!['pending', 'missed'].includes(log.status)) return false;
  const sources = getSources(log, template);
  const assignments = deduplicateCleaningRoster(await loadRoster(log.taskDate, [...new Set(sources.flatMap((source) => source.shiftTypeIds))], transaction));
  if (!assignments.length) return false;
  const submissions = await CleaningSubmission.findAll({ where: { taskLogId: log.id }, transaction });
  const active = assignments.map((assignment) => submissions.find((row) => matchesSubmissionIdentity(row, assignment, log.taskDate)));
  if (active.some((row) => !row || row.status !== 'approved')) return false;
  const selected = active as CleaningSubmission[];
  const photos = await CleaningPhotoVersion.findAll({ where: { submissionId: { [Op.in]: selected.map((row) => row.id) } }, transaction });
  const accepted: { photo: CleaningPhotoVersion; submission: CleaningSubmission; slot: CleaningRequiredSlot }[] = [];
  for (const submission of selected) {
    const latest = latestPhotos(photos.filter((photo) => photo.submissionId === submission.id));
    for (const slot of submission.requiredSlots) {
      const photo = latest.get(slot.key);
      if (!photo || photo.status !== 'approved' || !photo.reviewedBy || photo.reviewedBy === submission.userId) return false;
      accepted.push({ photo, submission, slot });
    }
  }
  await prepareTaskCompletionPayrollMutation({ userId: log.userId, taskDate: log.taskDate, transaction });
  const existing = Array.isArray(log.meta?.evidenceItems) ? log.meta.evidenceItems : [];
  const evidenceItems = [...existing, ...accepted.map(({ photo, submission, slot }) => ({ id: `cleaning-photo-${photo.id}`,
    ruleKey: slot.ruleKey, type: 'image', subjectUserId: submission.userId, subjectName: objectValue(submission.scheduleSnapshot).subjectName,
    fileName: photo.fileName, mimeType: photo.mimeType, fileSize: photo.fileSize, storagePath: photo.storagePath, driveFileId: photo.driveFileId,
    driveWebViewLink: photo.driveWebViewLink, uploadedAt: new Date(photo.uploadedAt).toISOString(), uploadedBy: photo.uploadedBy,
    valid: true, cleaningSubmissionId: submission.id, cleaningPhotoId: photo.id }))];
  const completedAt = new Date();
  await log.update({ status: 'completed', completedAt, updatedBy: completionActorId,
    meta: { ...log.meta, evidenceItems, [CLEANING_WORKFLOW_META_KEY]: { ...objectValue(log.meta[CLEANING_WORKFLOW_META_KEY]),
      managed: true, version: 1, completedAt: completedAt.toISOString(), submissionIds: selected.map((row) => row.id) } } }, { transaction });
  await AuditLog.create({ actorId: completionActorId, action: 'cleaning.task_completed', entity: 'am_task_log', entityId: String(log.id),
    metaJson: { submissionIds: selected.map((row) => row.id), photoIds: accepted.map((entry) => entry.photo.id), taskDate: log.taskDate,
      ...(completionActorId == null ? { source: 'cleaning_roster_reconciliation' } : {}) } }, { transaction });
  return true;
};

export const reviewCleaningSubmissionPhoto = async (params: CleaningActor & { submissionId: number; photoId: number; body: unknown }) => {
  const body = objectValue(params.body);
  if (Object.keys(body).some((key) => !['expectedRevision', 'decision', 'reason', 'escalationReason'].includes(key))) throw new HttpError(400, 'Unknown cleaning review field.');
  if (!['approved', 'rejected'].includes(String(body.decision))) throw new HttpError(400, 'Approve the photo or request a retake.');
  for (const field of ['reason', 'escalationReason']) if (body[field] != null && (typeof body[field] !== 'string' || String(body[field]).length > 2000)) throw new HttpError(400, 'Review notes must be at most 2000 characters.');
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  const escalationReason = typeof body.escalationReason === 'string' ? body.escalationReason.trim() : '';
  if (body.decision === 'rejected' && !reason) throw new HttpError(400, 'Explain what needs to be cleaned again.');
  const taskCompleted = await sequelize.transaction(async (transaction) => {
    const context = await loadContext(params.submissionId, params, transaction, true);
    if (!canReviewContext(context)) throw new HttpError(403, 'Only another on-shift manager can review this cleaning submission.');
    if (!context.reviewers.length && !escalationReason) throw new HttpError(400, 'Explain why you are handling this missing-manager review.');
    assertCleaningRevision(body.expectedRevision, context.submission.revision);
    const photo = context.photos.find((item) => item.id === params.photoId);
    if (!photo || latestPhotos(context.photos).get(photo.slotKey)?.id !== photo.id || photo.status !== 'pending') throw new HttpError(409, 'Only the latest pending photo can be reviewed.');
    // Re-read reviewer roster after acquiring all assignment locks: a reassignment removes reviewer authority immediately.
    const liveReviewers = context.assignment ? reviewerIds(context.assignment, await loadRoster(context.log.taskDate, undefined, transaction)) : [];
    if (!liveReviewers.includes(params.actorId) && !(liveReviewers.length === 0 && isCleaningGlobalManager(params) && escalationReason)) throw new HttpError(403, 'Your on-shift review assignment changed. Refresh before continuing.');
    context.reviewers = liveReviewers;
    await photo.update({ status: body.decision, reviewedBy: params.actorId, reviewedAt: new Date(), rejectionReason: body.decision === 'rejected' ? reason : null }, { transaction });
    await updateSubmissionStatus(context, transaction);
    await AuditLog.create({ actorId: params.actorId, action: 'cleaning.photo_reviewed', entity: 'am_task_log', entityId: String(context.log.id),
      metaJson: { submissionId: context.submission.id, photoId: photo.id, decision: body.decision, reason: reason || null,
        escalationReason: context.reviewers.length ? null : escalationReason, revision: context.submission.revision } }, { transaction });
    return completeTaskIfApproved(context, transaction);
  });
  return { ...await getCleaningSubmission(params.submissionId, params), taskCompleted };
};

/** Waiving canceled work is an explicit manager decision, never an automatic cleaning credit. */
export const waiveCanceledCleaningTask = async (params: CleaningActor & { taskLogId: number; body: unknown }) => {
  assertActor(params);
  const body = objectValue(params.body);
  if (Object.keys(body).some((key) => !['reason', 'expectedUpdatedAt'].includes(key))
    || typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 2000) {
    throw new HttpError(400, 'A reason of up to 2000 characters is required to waive canceled cleaning.');
  }
  if (typeof body.expectedUpdatedAt !== 'string' || body.expectedUpdatedAt.length > 40 || !Number.isFinite(new Date(body.expectedUpdatedAt).valueOf())) {
    throw new HttpError(400, 'Refresh the cleaning task before waiving it.');
  }
  const reason = body.reason.trim();
  if (!positiveId(params.taskLogId)) throw new HttpError(400, 'A valid cleaning task is required.');
  await sequelize.transaction(async (transaction) => {
    let log = await AssistantManagerTaskLog.findByPk(params.taskLogId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!log) throw new HttpError(404, 'Cleaning task was not found.');
    if (!isCleaningGlobalManager(params) && !(normalizeRole(params.roleSlug) === 'assistantmanager' && log.userId === params.actorId)) {
      throw new HttpError(403, 'Only management or this task’s assistant manager can waive canceled cleaning.');
    }
    if (new Date(log.updatedAt).valueOf() !== new Date(body.expectedUpdatedAt as string).valueOf()) throw new HttpError(409, 'The cleaning task changed. Refresh before waiving it.');
    if (!['pending', 'missed'].includes(log.status) || log.taskDate > today()) throw new HttpError(409, 'Only an open cleaning task from today or earlier can be waived.');
    const template = await AssistantManagerTaskTemplate.findByPk(log.templateId, { transaction });
    if (!template || !isCleaningTaskCompletionManaged(template.scheduleConfig, log.meta)) throw new HttpError(409, 'This is not a managed cleaning task.');
    const sources = getSources(log, template);
    const typeIds = [...new Set(sources.flatMap((source) => source.shiftTypeIds))];
    // Lock all matching instances, including unpublished ones, before checking the published roster.
    const instances = await ShiftInstance.findAll({ where: { date: log.taskDate, shiftTypeId: { [Op.in]: typeIds } },
      order: [['id', 'ASC']], transaction, lock: transaction.LOCK.UPDATE });
    const weekIds = [...new Set(instances.map((instance) => instance.scheduleWeekId))].sort((a, b) => a - b);
    if (weekIds.length) await ScheduleWeek.findAll({ where: { id: { [Op.in]: weekIds } }, order: [['id', 'ASC']], transaction, lock: transaction.LOCK.UPDATE });
    if ((await loadRoster(log.taskDate, typeIds, transaction)).length > 0) throw new HttpError(409, 'Cleaning staff are still assigned on a published shift. This task cannot be waived as canceled.');
    await ensureCleaningSubmissionsForTaskLog(log.id, transaction);
    // The reconciler can add its protected snapshot and detach history; do not overwrite that fresh metadata.
    log = await AssistantManagerTaskLog.findByPk(params.taskLogId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!log) throw new HttpError(404, 'Cleaning task was not found.');
    await prepareTaskCompletionPayrollMutation({ userId: log.userId, taskDate: log.taskDate, transaction });
    const waivedAt = new Date().toISOString();
    const workflow = { ...objectValue(log.meta[CLEANING_WORKFLOW_META_KEY]), waiver: { reason, waivedAt, waivedBy: params.actorId } };
    delete (workflow as Record<string, unknown>).rosterIssue;
    await log.update({ status: 'waived', completedAt: null, updatedBy: params.actorId,
      meta: { ...log.meta, [CLEANING_WORKFLOW_META_KEY]: workflow } }, { transaction });
    const submissions = await CleaningSubmission.findAll({ where: { taskLogId: log.id }, attributes: ['id'], transaction });
    for (const submission of submissions) await RequiredAction.update({ status: false }, { where: actionWhere(submission.id), transaction });
    await AuditLog.create({ actorId: params.actorId, action: 'cleaning.task_waived', entity: 'am_task_log', entityId: String(log.id),
      metaJson: { taskDate: log.taskDate, reason, source: 'no_active_cleaners', submissionIds: submissions.map((row) => row.id) } }, { transaction });
  });
  return { taskLogId: params.taskLogId, status: 'waived' as const };
};

export const getCleaningPhotoStream = async (submissionId: number, photoId: number, actor: CleaningActor) => {
  const context = await loadContext(submissionId, actor);
  const photo = context.photos.find((item) => item.id === photoId);
  if (!photo) throw new HttpError(404, 'Cleaning photo was not found.');
  return { ...await openAssistantManagerTaskEvidenceImageStream(photo), fileName: photo.fileName };
};

export const getCleaningReviewActionPayload = async (actionId: number, submissionId: number, userId: number) => {
  const action = await RequiredAction.findByPk(actionId);
  if (!action || action.type !== 'cleaning_review' || !action.status || !action.targetUserIds?.includes(userId)
    || objectValue(objectValue(action.payload).cleaningSubmission).submissionId !== submissionId) return null;
  const user = await User.findByPk(userId, { include: [{ model: UserType, as: 'role', attributes: ['slug'] }] });
  if (!user?.status || !user.approved) return null;
  try {
    const actor = { actorId: userId, roleSlug: (user as unknown as { role?: UserType }).role?.slug ?? null };
    const context = await loadContext(submissionId, actor);
    if (!canReviewContext(context)) return null;
    const pendingPhotos = [...latestPhotos(context.photos).values()].filter((photo) => photo.status === 'pending').length;
    if (!pendingPhotos) return null;
    return { submissionId, revision: context.submission.revision, taskLogId: context.log.id, taskDate: context.log.taskDate,
      title: context.template.name, subjectName: String(objectValue(context.submission.scheduleSnapshot).subjectName ?? ''), pendingPhotos };
  } catch (error) { if (error instanceof HttpError && [404, 409].includes(error.status)) return null; throw error; }
};

/** Ordinary task edits cannot erase approved photos or detach the audit/history from its task. */
export const assertCleaningEvidencePreserved = async (logId: number, currentMeta: unknown, nextMeta: unknown, transaction?: Transaction) => {
  const submissions = await CleaningSubmission.findAll({ where: { taskLogId: logId }, attributes: ['id'], transaction });
  if (!submissions.length) return;
  if (nextMeta == null) throw new HttpError(409, 'This task has cleaning submissions. Keep the task and its evidence history.');
  if (JSON.stringify(objectValue(currentMeta)[CLEANING_WORKFLOW_META_KEY]) !== JSON.stringify(objectValue(nextMeta)[CLEANING_WORKFLOW_META_KEY])) {
    throw new HttpError(409, 'Cleaning approval metadata is managed by the cleaning workflow.');
  }
  const current = Array.isArray(objectValue(currentMeta).evidenceItems) ? objectValue(currentMeta).evidenceItems as unknown[] : [];
  const proposed = Array.isArray(objectValue(nextMeta).evidenceItems) ? objectValue(nextMeta).evidenceItems as unknown[] : [];
  const fields = ['id', 'type', 'ruleKey', 'subjectUserId', 'fileName', 'mimeType', 'fileSize', 'storagePath', 'driveFileId', 'driveWebViewLink', 'uploadedBy', 'uploadedAt'];
  for (const item of current.map(objectValue).filter((entry) => String(entry.id).startsWith('cleaning-photo-'))) {
    if (!proposed.some((entry) => fields.every((field) => (objectValue(entry)[field] ?? null) === (item[field] ?? null)))) {
      throw new HttpError(409, 'Approved cleaning evidence cannot be changed or removed.');
    }
  }
};

export const assertCleaningTaskLogMutable = async (logId: number, transaction?: Transaction) => {
  if (await CleaningSubmission.findOne({ where: { taskLogId: logId }, attributes: ['id'], transaction })) {
    throw new HttpError(409, 'This task has cleaning submissions. Its date, assignee and history cannot be changed.');
  }
};
