import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { Op, Transaction } from 'sequelize';
import sequelize from '../config/database.js';
import HttpError from '../errors/HttpError.js';
import AssistantManagerTaskLog from '../models/AssistantManagerTaskLog.js';
import AssistantManagerTaskTemplate from '../models/AssistantManagerTaskTemplate.js';
import AuditLog from '../models/AuditLog.js';
import CleaningSubmission from '../models/CleaningSubmission.js';
import ReviewArchive from '../models/ReviewArchive.js';
import ReviewAssignment from '../models/ReviewAssignment.js';
import ReviewCounter from '../models/ReviewCounter.js';
import ReviewCounterEntry from '../models/ReviewCounterEntry.js';
import ReviewManualCredit from '../models/ReviewManualCredit.js';
import ReviewMonthLock from '../models/ReviewMonthLock.js';
import ScheduleWeek from '../models/ScheduleWeek.js';
import ShiftAssignment from '../models/ShiftAssignment.js';
import ShiftInstance from '../models/ShiftInstance.js';
import ShiftTemplate from '../models/ShiftTemplate.js';
import ShiftType from '../models/ShiftType.js';
import StaffProfile from '../models/StaffProfile.js';
import StaffProfileTypePeriod from '../models/StaffProfileTypePeriod.js';
import User from '../models/User.js';
import UserType from '../models/UserType.js';
import VolunteerShiftAttendance from '../models/VolunteerShiftAttendance.js';
import VolunteerStay from '../models/VolunteerStay.js';
import VolunteerStayRevision from '../models/VolunteerStayRevision.js';
import {
  calculateVolunteerStayTargets,
  DEFAULT_VOLUNTEER_MONTHLY_TARGETS,
  type VolunteerMonthlyTargets,
} from '../utils/volunteerStayTargets.js';
import {
  deduplicateVolunteerAttendanceAssignments,
  currentVolunteerAttendance,
  isCleaningTaskTemplate,
  isPastShift,
  selectVolunteerCleaningEvidence,
  VOLUNTEER_MILESTONE_TIMEZONE,
  type VolunteerAttendanceAssignment,
  type VolunteerMilestone,
  type VolunteerMilestoneEvidence,
} from './volunteerMilestoneService.js';

dayjs.extend(utc);
dayjs.extend(timezone);

type Position = 'guide' | 'social_media';
type ShiftMappings = { guiding: number[]; promotion: number[]; socialMedia: number[] };
type UserRecord = User & { role?: { slug: string } | null; volunteerProfileActive?: boolean };
type ShiftRecord = ShiftAssignment & {
  shiftInstance?: ShiftInstance & { shiftType?: ShiftType; template?: ShiftTemplate };
  volunteerAttendance?: VolunteerShiftAttendance & { recordedByUser?: User };
};
type TaskRecord = AssistantManagerTaskLog & { template?: AssistantManagerTaskTemplate };
type ReviewCredit = { userId: number; date: string; amount: number; evidence: VolunteerMilestoneEvidence };
type LegacyReviewCredit = ReviewCredit & { nextMonth: string };
type LegacyReviewBackfill = { userId: number; month: string };
type MilestoneSubtarget = { key: string; title: string; current: number; target: number; expectedToDate: number; unit: string };
export type VolunteerStayMilestone = VolunteerMilestone & {
  expectedToDate: number;
  subtargets?: MilestoneSubtarget[];
};

const userAttributes = [
  'id', 'firstName', 'lastName', 'email', 'profilePhotoUrl', 'profilePhotoPath',
  'arrivalDate', 'departureDate', 'status', 'updatedAt',
];
const dateOnly = (value: unknown): string | null => {
  if (value == null || value === '') return null;
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text)) return null;
  const date = new Date(`${text}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === text ? text : null;
};
const iso = (value: Date | string | null | undefined): string | null => value ? new Date(value).toISOString() : null;
const fullName = (user?: Pick<User, 'firstName' | 'lastName' | 'email'> | null): string | null =>
  user ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email || null : null;
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const isInStay = (date: string, stay: Pick<VolunteerStay, 'startDate' | 'endDate'>): boolean =>
  date >= stay.startDate && date < stay.endDate;
const round = (value: number): number => Math.round(value * 10000) / 10000;
const percent = (current: number, target: number): number => target <= 0 ? 100 : Math.min(100, Math.max(0, Math.round(current / target * 100)));
const storedProfilePhotoVersion = (user: UserRecord): string | null => {
  if (!user.profilePhotoPath) return null;
  const updatedAt = user.updatedAt instanceof Date ? user.updatedAt.getTime() : new Date(user.updatedAt ?? 0).getTime();
  return `${user.id}-${Number.isFinite(updatedAt) ? updatedAt : 0}`;
};

export const serializeVolunteerStay = (stay: VolunteerStay) => ({
  id: stay.id, userId: stay.userId, startDate: stay.startDate, endDate: stay.endDate,
  position: stay.position, monthlyTargets: stay.monthlyTargets, shiftTypeIds: stay.shiftTypeIds,
  feedback: stay.feedback ?? null, changeReason: stay.changeReason ?? null, revision: stay.revision,
  createdBy: stay.createdBy, updatedBy: stay.updatedBy, createdAt: iso(stay.createdAt), updatedAt: iso(stay.updatedAt),
});

const shiftOptions = (types: ShiftType[]) => types.map(({ id, key, name }) => ({ id, key, name }));
const normalizedIdentity = (...values: Array<string | null | undefined>): string => values
  .filter((value): value is string => typeof value === 'string')
  .join(' ')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/gu, '_')
  .replace(/^_+|_+$/gu, '');
const hasIdentityToken = (identity: string, token: string): boolean =>
  (`_${identity}_`).includes(`_${token}_`);

export const resolveVolunteerStayPosition = (roleSlug: string | null | undefined): Position | null => {
  const role = normalizedIdentity(roleSlug);
  if (role === 'social_media' || role === 'socialmedia') return 'social_media';
  if (role === 'guide' || role === 'pub_crawl_guide' || role === 'pubcrawl_guide') return 'guide';
  return null;
};

/**
 * Resolve the default milestone buckets from operational shift-type identity.
 * The name is included so named variants such as "Kazimierz Pub Crawl" are
 * classified even when their key is not one of the original seed keys.
 */
export const suggestVolunteerShiftMappings = (types: ShiftType[]): ShiftMappings => {
  const mappings: ShiftMappings = { guiding: [], promotion: [], socialMedia: [] };
  for (const type of types) {
    const identity = normalizedIdentity(type.key, type.name);
    // Buckets are intentionally exclusive, matching manual stay validation.
    if (identity.includes('social_media') || hasIdentityToken(identity, 'socialmedia')) {
      mappings.socialMedia.push(type.id);
    } else if (identity.includes('promotion') || hasIdentityToken(identity, 'promo')) {
      mappings.promotion.push(type.id);
    } else if (identity.includes('pub_crawl') || hasIdentityToken(identity, 'guide') || hasIdentityToken(identity, 'guiding')) {
      mappings.guiding.push(type.id);
    }
  }
  return mappings;
};

const selectedStay = (stays: VolunteerStay[], today: string, requestedId?: number): VolunteerStay | null => {
  if (requestedId != null) {
    const selected = stays.find((stay) => stay.id === requestedId);
    if (!selected) throw new HttpError(404, 'Volunteer stay was not found for this person.');
    return selected;
  }
  return stays.find((stay) => stay.startDate <= today && stay.endDate > today)
    ?? stays.filter((stay) => stay.startDate > today)
      .sort((left, right) => left.startDate.localeCompare(right.startDate) || left.id - right.id)[0]
    ?? stays.filter((stay) => stay.endDate <= today)
      .sort((left, right) => right.startDate.localeCompare(left.startDate) || right.id - left.id)[0]
    ?? null;
};

const buildMilestone = (
  key: VolunteerMilestone['key'], title: string, current: number, target: number,
  expectedToDate: number, unit: string, evidence: VolunteerMilestoneEvidence[],
  options: { earned?: boolean; reason?: string; subtargets?: MilestoneSubtarget[] } = {},
): VolunteerStayMilestone => {
  const earned = options.earned ?? (current >= target
    || Math.abs(current - target) <= Number.EPSILON * Math.max(Math.abs(current), Math.abs(target)) * 16);
  return {
    key, title, current: round(current), target, expectedToDate, unit,
    progressPercent: percent(current, target), earned, state: earned ? 'earned' : 'in_progress',
    remainingText: earned ? 'Stay target reached' : `${round(Math.max(0, target - current))} ${unit} remaining`,
    reason: options.reason ?? `${round(current)} ${unit} recorded during this stay.`, evidence,
    ...(options.subtargets ? { subtargets: options.subtargets } : {}),
  };
};

const loadDatedReviewCredits = async (
  userIds: number[], startDate: string, endDate: string, transaction?: Transaction,
): Promise<{ credits: ReviewCredit[]; legacyCredits: LegacyReviewCredit[]; legacyBackfills: LegacyReviewBackfill[] }> => {
  const start = dayjs.tz(`${startDate}T00:00:00`, VOLUNTEER_MILESTONE_TIMEZONE).toDate();
  const end = dayjs.tz(`${endDate}T00:00:00`, VOLUNTEER_MILESTONE_TIMEZONE).toDate();
  const [reviews, manuals, legacy] = await Promise.all([
    ReviewArchive.findAll({
      where: { reviewCreatedAt: { [Op.gte]: start, [Op.lt]: end } },
      attributes: ['id', 'platform', 'reviewerName', 'reviewCreatedAt', 'creditMonth', 'isDeleted'],
      transaction,
    }),
    ReviewManualCredit.findAll({
      where: { userId: { [Op.in]: userIds }, date: { [Op.gte]: startDate, [Op.lt]: endDate } },
      attributes: ['id', 'userId', 'platform', 'date', 'credit', 'notes'],
      transaction,
    }),
    ReviewCounterEntry.findAll({
      where: { userId: { [Op.in]: userIds }, category: 'staff', rawCount: { [Op.gt]: 0 } },
      attributes: ['id', 'userId', 'rawCount'],
      include: [{ model: ReviewCounter, as: 'counter', required: true, attributes: ['periodStart', 'platform'],
        where: { periodStart: { [Op.gte]: `${startDate.slice(0, 7)}-01`, [Op.lt]: endDate } } }],
      transaction,
    }),
  ]);
  const attributionMonths = [...new Set(reviews.map((review) =>
    `${(review.creditMonth ?? dayjs(review.reviewCreatedAt).tz(VOLUNTEER_MILESTONE_TIMEZONE).format('YYYY-MM-DD')).slice(0, 7)}-01`))];
  const [locks, assignments] = await Promise.all([
    attributionMonths.length ? ReviewMonthLock.findAll({
      where: { periodStart: { [Op.in]: attributionMonths }, isLocked: true },
      attributes: ['periodStart', 'reviewIds'],
      transaction,
    }) : Promise.resolve([]),
    reviews.length ? ReviewAssignment.findAll({
      where: { reviewId: { [Op.in]: reviews.map((review) => review.id) } },
      attributes: ['id', 'reviewId', 'userId'],
      transaction,
    }) : Promise.resolve([]),
  ]);
  const locksByMonth = new Map(locks.map((lock) => [lock.periodStart, new Set((lock.reviewIds ?? []).map(Number))]));
  const assignmentsByReview = new Map<number, Set<number>>();
  for (const assignment of assignments) {
    const users = assignmentsByReview.get(assignment.reviewId) ?? new Set<number>();
    users.add(assignment.userId);
    assignmentsByReview.set(assignment.reviewId, users);
  }
  const selectedUsers = new Set(userIds);
  const credits: ReviewCredit[] = [];
  for (const review of reviews) {
    const date = dayjs(review.reviewCreatedAt).tz(VOLUNTEER_MILESTONE_TIMEZONE).format('YYYY-MM-DD');
    const creditMonth = `${(review.creditMonth ?? date).slice(0, 7)}-01`;
    const lockedIds = locksByMonth.get(creditMonth);
    if (lockedIds ? !lockedIds.has(review.id) : review.isDeleted) continue;
    const assignedUsers = assignmentsByReview.get(review.id);
    if (!assignedUsers?.size) continue;
    for (const userId of assignedUsers) {
      if (!selectedUsers.has(userId)) continue;
      const amount = 1 / assignedUsers.size;
      credits.push({ userId, date, amount, evidence: {
        id: `archive-${review.id}-${userId}`, label: review.reviewerName || `${review.platform} review`,
        detail: `${round(amount)} credit · ${review.platform}`, occurredAt: date, status: 'credited',
      } });
    }
  }
  const legacyCredits: LegacyReviewCredit[] = [];
  for (const entry of legacy) {
    const month = dateOnly(entry.counter?.periodStart);
    const amount = Number(entry.rawCount);
    if (entry.userId == null || !month || !Number.isFinite(amount) || amount <= 0) continue;
    const nextMonth = dayjs(month).startOf('month').add(1, 'month').format('YYYY-MM-DD');
    legacyCredits.push({ userId: entry.userId, date: month, nextMonth, amount, evidence: {
      id: `legacy-${entry.id}`, label: `${entry.counter?.platform ?? 'Review'} counter credit`,
      detail: `${amount} credits for the complete calendar month ${month.slice(0, 7)}; individual dates unavailable`,
      occurredAt: month, status: 'credited',
    } });
  }
  const legacyBackfills: LegacyReviewBackfill[] = [];
  for (const manual of manuals) {
    if (manual.notes?.startsWith('Backfilled from legacy review counter #')) {
      if (manual.userId != null) legacyBackfills.push({ userId: manual.userId, month: `${manual.date.slice(0, 7)}-01` });
      continue;
    }
    const amount = Number(manual.credit);
    if (manual.userId == null || !Number.isFinite(amount) || amount <= 0) continue;
    credits.push({ userId: manual.userId, date: manual.date, amount, evidence: {
      id: `manual-${manual.id}`, label: `Manual ${manual.platform} credit`,
      detail: manual.notes?.trim() || `${amount} credits`, occurredAt: manual.date, status: 'credited',
    } });
  }
  return { credits, legacyCredits, legacyBackfills };
};

const loadEvidence = async (stays: VolunteerStay[], today: string, transaction?: Transaction) => {
  const emptyReviews = { credits: [] as ReviewCredit[], legacyCredits: [] as LegacyReviewCredit[], legacyBackfills: [] as LegacyReviewBackfill[] };
  if (!stays.length) return { ...emptyReviews, assignments: [] as ShiftRecord[], tasks: [] as TaskRecord[], cleaningTasks: [] as TaskRecord[], cleaningSubmissions: [] as CleaningSubmission[] };
  const userIds = [...new Set(stays.map((stay) => stay.userId))];
  const startDate = stays.map((stay) => stay.startDate).sort()[0];
  const endDate = stays.map((stay) => stay.endDate).sort().at(-1)!;
  const cutoff = dayjs(today).add(1, 'day').format('YYYY-MM-DD');
  const evidenceEnd = endDate < cutoff ? endDate : cutoff;
  const [reviews, assignments, tasks, cleaningTasks] = await Promise.all([
    startDate < evidenceEnd ? loadDatedReviewCredits(userIds, startDate, evidenceEnd, transaction) : Promise.resolve(emptyReviews),
    ShiftAssignment.findAll({
      where: { userId: { [Op.in]: userIds } }, attributes: ['id', 'userId', 'shiftInstanceId', 'roleInShift'],
      include: [{ model: ShiftInstance, as: 'shiftInstance', required: true,
        attributes: ['id', 'date', 'timeStart', 'timeEnd', 'shiftTypeId'],
        where: { date: { [Op.gte]: startDate, [Op.lt]: endDate } },
        include: [
          { model: ScheduleWeek, as: 'scheduleWeek', required: true, attributes: ['state'], where: { state: 'published' } },
          { model: ShiftType, as: 'shiftType', required: false, attributes: ['id', 'key', 'name'] },
          { model: ShiftTemplate, as: 'template', required: false, attributes: ['id', 'name'] },
        ],
      }, { model: VolunteerShiftAttendance, as: 'volunteerAttendance', required: false,
        include: [{ model: User, as: 'recordedByUser', attributes: ['id', 'firstName', 'lastName', 'email'] },
          { model: AssistantManagerTaskLog, as: 'evidenceTaskLog', required: false, attributes: ['id', 'taskDate'] }],
      }],
      transaction,
    }) as Promise<ShiftRecord[]>,
    startDate < evidenceEnd ? AssistantManagerTaskLog.findAll({
      where: { userId: { [Op.in]: userIds }, taskDate: { [Op.gte]: startDate, [Op.lt]: evidenceEnd }, status: 'completed' },
      attributes: ['id', 'userId', 'taskDate', 'completedAt', 'notes', 'meta'],
      include: [{ model: AssistantManagerTaskTemplate, as: 'template', required: true,
        attributes: ['id', 'name', 'category', 'subgroup', 'scheduleConfig'] }],
      transaction,
    }) as Promise<TaskRecord[]> : Promise.resolve([] as TaskRecord[]),
    // These logs belong to the reviewing manager, not to the cleaner. Read them in one batch.
    startDate < evidenceEnd ? AssistantManagerTaskLog.findAll({
      where: { taskDate: { [Op.gte]: startDate, [Op.lt]: evidenceEnd } },
      attributes: ['id', 'userId', 'taskDate', 'status', 'meta'],
      include: [{ model: AssistantManagerTaskTemplate, as: 'template', required: true,
        attributes: ['id', 'name', 'scheduleConfig'], where: { 'scheduleConfig.cleaningPhotoApprovalEnabled': true } }], transaction,
    }) as Promise<TaskRecord[]> : Promise.resolve([] as TaskRecord[]),
  ]);
  const cleaningSubmissions = assignments.length ? await CleaningSubmission.findAll({
    where: { shiftAssignmentId: { [Op.in]: assignments.map((assignment) => assignment.id) } },
    attributes: ['id', 'taskLogId', 'shiftAssignmentId', 'userId', 'status', 'scheduleSnapshot', 'updatedAt'], transaction,
    include: [{ model: AssistantManagerTaskLog, as: 'taskLog', required: true, attributes: ['id', 'taskDate'] }],
  }) : [];
  return { ...reviews, assignments, tasks, cleaningTasks, cleaningSubmissions };
};

const assignmentPayload = (assignment: ShiftRecord, now: Date): VolunteerAttendanceAssignment => {
  const attendance = currentVolunteerAttendance(assignment);
  return ({
  assignmentId: assignment.id, shiftInstanceId: assignment.shiftInstanceId,
  date: assignment.shiftInstance!.date, startTime: assignment.shiftInstance!.timeStart,
  endTime: assignment.shiftInstance!.timeEnd,
  shiftName: assignment.shiftInstance!.template?.name || assignment.shiftInstance!.shiftType?.name || `Shift ${assignment.shiftInstanceId}`,
  role: assignment.roleInShift || null,
  status: attendance?.status ?? null, notes: attendance?.notes ?? null,
  recordedAt: attendance?.recordedAt ?? null,
  recordedByName: fullName(attendance?.recordedByUser),
  isPast: isPastShift(assignment.shiftInstance!, now),
}); };
const shiftEvidence = (assignments: VolunteerAttendanceAssignment[]): VolunteerMilestoneEvidence[] => assignments.map((assignment) => ({
  id: assignment.assignmentId, label: assignment.shiftName,
  detail: [assignment.role, assignment.notes].filter(Boolean).join(' · ') || undefined,
  occurredAt: assignment.date, status: assignment.status ?? 'pending',
}));

const buildProgress = (
  user: UserRecord, allStays: VolunteerStay[], stay: VolunteerStay | null,
  evidence: Awaited<ReturnType<typeof loadEvidence>>, types: ShiftType[], now: Date,
  names: Map<number, string | null>,
) => {
  const today = dayjs(now).tz(VOLUNTEER_MILESTONE_TIMEZONE).format('YYYY-MM-DD');
  const position: Position = resolveVolunteerStayPosition(user.role?.slug) ?? 'guide';
  const common = {
    mode: 'stay' as const,
    user: { id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email,
      profilePhotoUrl: user.profilePhotoUrl ?? null,
      hasStoredProfilePhoto: Boolean(user.profilePhotoPath),
      profilePhotoVersion: storedProfilePhotoVersion(user),
      arrivalDate: dateOnly(user.arrivalDate), departureDate: dateOnly(user.departureDate) },
    active: user.status && user.volunteerProfileActive === true,
    stay: stay ? serializeVolunteerStay(stay) : null,
    stays: allStays.map(serializeVolunteerStay), setupRequired: stay == null,
    suggestedStay: { startDate: dateOnly(user.arrivalDate), endDate: dateOnly(user.departureDate), position,
      monthlyTargets: { ...DEFAULT_VOLUNTEER_MONTHLY_TARGETS }, shiftTypeIds: suggestVolunteerShiftMappings(types) },
    asOfDate: today, timezone: VOLUNTEER_MILESTONE_TIMEZONE,
    shiftTypes: shiftOptions(types), totalStars: 5 as const,
  };
  if (!stay) return { ...common, targetSummary: null, starsEarned: 0, milestones: [] as VolunteerStayMilestone[],
    attendanceAssignments: [] as VolunteerAttendanceAssignment[], managementFeedback: null,
    warnings: ['A manager must confirm this volunteer’s stay and targets before progress can be calculated.'] };

  const targetSummary = calculateVolunteerStayTargets({
    startDate: stay.startDate, endDate: stay.endDate,
    asOfDate: dayjs(today).add(1, 'day').format('YYYY-MM-DD'), position: stay.position,
    monthlyTargets: stay.monthlyTargets,
  });
  const { targets, expectedToDate } = targetSummary;
  const rawAssignments = evidence.assignments.filter((assignment) => assignment.userId === user.id
    && assignment.shiftInstance && isInStay(assignment.shiftInstance.date, stay));
  const attendanceAssignments = deduplicateVolunteerAttendanceAssignments(rawAssignments.map((assignment) => assignmentPayload(assignment, now)));
  const past = attendanceAssignments.filter((assignment) => assignment.isPast);
  const confirmed = past.filter((assignment) => assignment.status === 'attended' || assignment.status === 'late');
  const excused = past.filter((assignment) => assignment.status === 'excused').length;
  const pending = past.filter((assignment) => assignment.status == null).length;
  const absent = past.filter((assignment) => assignment.status === 'absent').length;
  const eligible = past.length - excused;
  // Keep the display below a threshold until the actual ratio reaches it.
  const attendanceRate = eligible > 0 ? Math.floor(confirmed.length / eligible * 1000) / 10 : 0;
  const onTime = confirmed.filter((assignment) => assignment.status === 'attended').length;
  const punctualityRate = confirmed.length ? Math.floor(onTime / confirmed.length * 1000) / 10 : 0;
  // Compare unrounded ratios so 89.6% cannot unlock a 90% target through display rounding.
  const attendanceMet = eligible > 0 && confirmed.length * 100 >= targets.attendancePercent * eligible;
  const punctualityMet = confirmed.length > 0 && onTime * 100 >= targets.attendancePercent * confirmed.length;
  const excusedSummary = `${excused} excused ${excused === 1 ? 'shift' : 'shifts'} excluded.`;
  const pendingSummary = `${pending} shift ${pending === 1 ? 'confirmation' : 'confirmations'} pending`;
  const typesByShift = new Map(rawAssignments.map((assignment) => [assignment.shiftInstanceId, assignment.shiftInstance!.shiftTypeId]));
  const forTypes = (ids: number[]) => confirmed.filter((assignment) => ids.includes(typesByShift.get(assignment.shiftInstanceId)!));
  const mappings = stay.shiftTypeIds as ShiftMappings;
  const guiding = forTypes(mappings.guiding ?? []);
  const promotion = forTypes(mappings.promotion ?? []);
  const socialMedia = forTypes(mappings.socialMedia ?? []);
  const subtargets: MilestoneSubtarget[] = stay.position === 'guide' ? [
    { key: 'guidingShifts', title: 'Guiding shifts', current: guiding.length, target: targets.guidingShifts, expectedToDate: expectedToDate.guidingShifts, unit: 'shifts' },
    { key: 'promotionShifts', title: 'Promotion shifts', current: promotion.length, target: targets.promotionShifts, expectedToDate: expectedToDate.promotionShifts, unit: 'shifts' },
  ] : [{ key: 'socialMediaShifts', title: 'Social Media shifts', current: socialMedia.length, target: targets.socialMediaShifts, expectedToDate: expectedToDate.socialMediaShifts, unit: 'shifts' }];
  const reviewCutoff = [stay.endDate, dayjs(today).add(1, 'day').format('YYYY-MM-DD')].sort()[0];
  // Undated aggregates become usable only after the calendar month has actually ended.
  const completedMonthCutoff = [stay.endDate, today].sort()[0];
  const overlappingLegacy = evidence.legacyCredits.filter((credit) => credit.userId === user.id
    && credit.date < reviewCutoff && credit.nextMonth > stay.startDate);
  const completeMonthCredits = overlappingLegacy.filter((credit) => credit.date >= stay.startDate && credit.nextMonth <= completedMonthCutoff);
  const includedLegacyMonths = new Set(completeMonthCredits.map((credit) => credit.date));
  const excludedLegacy = overlappingLegacy.some((credit) => !includedLegacyMonths.has(credit.date))
    || evidence.legacyBackfills.some((backfill) => backfill.userId === user.id && backfill.month < reviewCutoff
      && dayjs(backfill.month).add(1, 'month').format('YYYY-MM-DD') > stay.startDate && !includedLegacyMonths.has(backfill.month));
  const reviewCredits = [...evidence.credits.filter((credit) => credit.userId === user.id && isInStay(credit.date, stay)), ...completeMonthCredits];
  const managedShiftIds = new Set(rawAssignments.filter((assignment) => evidence.cleaningTasks.some((task) =>
    task.taskDate === assignment.shiftInstance!.date
    && Array.isArray(task.template?.scheduleConfig?.shiftEvidenceSources)
    && task.template!.scheduleConfig!.shiftEvidenceSources.some((source: unknown) => {
      const ids = record(source).shiftTypeIds;
      return Array.isArray(ids) && ids.includes(assignment.shiftInstance!.shiftTypeId);
    }))).map((assignment) => assignment.shiftInstanceId));
  const assignmentsById = new Map(rawAssignments.map((assignment) => [assignment.id, assignment]));
  const approvedCleaning = new Map<number, VolunteerMilestoneEvidence>();
  for (const submission of evidence.cleaningSubmissions) {
    const assignment = submission.shiftAssignmentId != null ? assignmentsById.get(submission.shiftAssignmentId) : null;
    if (!assignment || assignment.shiftInstanceId !== Number(record(submission.scheduleSnapshot).shiftInstanceId)) continue;
    managedShiftIds.add(assignment.shiftInstanceId);
    if (submission.userId !== user.id || submission.status !== 'approved' || !isPastShift(assignment.shiftInstance!, now)
      || record(submission.scheduleSnapshot).date !== assignment.shiftInstance!.date
      || Number(record(submission.scheduleSnapshot).shiftTypeId) !== assignment.shiftInstance!.shiftTypeId
      || submission.taskLog?.id !== submission.taskLogId || submission.taskLog.taskDate !== assignment.shiftInstance!.date
      || (submission.updatedAt && new Date(submission.updatedAt).valueOf() > now.valueOf())) continue;
    approvedCleaning.set(assignment.shiftInstanceId, { id: `cleaning-submission-${submission.id}`, label: 'Approved cleaning photos',
      detail: String(record(submission.scheduleSnapshot).shiftName ?? 'Cleaning'), occurredAt: assignment.shiftInstance!.date, status: 'approved' });
  }
  const managedDates = new Set(rawAssignments.filter((assignment) => managedShiftIds.has(assignment.shiftInstanceId)).map((assignment) => assignment.shiftInstance!.date));
  const cleaningTasks = evidence.tasks.filter((task) => task.userId === user.id && isInStay(task.taskDate, stay)
    && (!task.completedAt || new Date(task.completedAt).valueOf() <= now.valueOf())
    && task.template?.scheduleConfig?.cleaningPhotoApprovalEnabled !== true && !record(task.meta).cleaningPhotoWorkflow
    && !managedDates.has(task.taskDate)
    && isCleaningTaskTemplate(task.template, task.meta));
  const cleaningShiftIds = new Set(rawAssignments.filter((assignment) =>
    /\bclean(?:ing)?\b/iu.test([assignment.shiftInstance?.shiftType?.key, assignment.shiftInstance?.shiftType?.name, assignment.shiftInstance?.template?.name].filter(Boolean).join(' ')))
    .map((assignment) => assignment.shiftInstanceId));
  const cleaningEvidence = [...selectVolunteerCleaningEvidence(cleaningTasks.map((task) => ({
    id: task.id, label: task.template?.name ?? 'Cleaning task', detail: task.notes ?? undefined,
    occurredAt: iso(task.completedAt) ?? task.taskDate, status: 'completed',
  })), shiftEvidence(confirmed.filter((assignment) => cleaningShiftIds.has(assignment.shiftInstanceId) && !managedShiftIds.has(assignment.shiftInstanceId)))), ...approvedCleaning.values()];
  const feedback = stay.feedback;
  const managementFeedback = feedback ? {
    ...feedback,
    approvedByName: feedback.approvedBy != null ? names.get(feedback.approvedBy) ?? null : null,
    updatedByName: feedback.updatedBy != null ? names.get(feedback.updatedBy) ?? null : null,
  } : null;
  const measurable: VolunteerStayMilestone[] = [
    buildMilestone('reviews', 'Review target', reviewCredits.reduce((sum, credit) => sum + credit.amount, 0), targets.reviews, expectedToDate.reviews,
      'reviews', reviewCredits.map((credit) => credit.evidence)),
    buildMilestone('attendance', 'Attendance & punctuality', Math.min(attendanceRate, punctualityRate), targets.attendancePercent, expectedToDate.attendancePercent, '%', shiftEvidence(past), {
      // Stay agreements use their saved percentages; the legacy calendar keeps its separate absence policy.
      earned: pending === 0 && attendanceMet && punctualityMet,
      subtargets: [
        { key: 'attendance', title: 'Attendance', current: attendanceRate, target: targets.attendancePercent, expectedToDate: targets.attendancePercent, unit: '%' },
        { key: 'punctuality', title: 'On time', current: punctualityRate, target: targets.attendancePercent, expectedToDate: targets.attendancePercent, unit: '%' },
      ],
      reason: eligible === 0 ? `No completed non-excused shifts yet; ${excusedSummary}`
        : `Attendance: ${confirmed.length}/${eligible} (${attendanceRate}%).`
          + (confirmed.length ? ` On time: ${onTime}/${confirmed.length} (${punctualityRate}%).` : ' On time: no attended shifts yet.')
          + ` Both require ${targets.attendancePercent}%.`
          + ` ${absent} unexcused ${absent === 1 ? 'absence counts' : 'absences count'} against attendance; ${excusedSummary}`
          + (pending ? ` ${pendingSummary}.` : ''),
    }),
    buildMilestone('monthly_shifts', stay.position === 'guide' ? 'Guiding & promotion commitment' : 'Social Media commitment',
      subtargets.reduce((sum, target) => sum + target.current, 0), subtargets.reduce((sum, target) => sum + target.target, 0),
      subtargets.reduce((sum, target) => sum + target.expectedToDate, 0), 'shifts',
      shiftEvidence(stay.position === 'guide' ? [...guiding, ...promotion] : socialMedia), {
        earned: subtargets.every((target) => target.current >= target.target), subtargets,
        reason: stay.position === 'guide' ? 'Both guiding and promotion targets must be met; extra shifts in one do not replace the other.'
          : 'Counts confirmed shifts from the Social Media shift types saved for this stay.',
      }),
    buildMilestone('cleaning', 'Cleaning & house care', cleaningEvidence.length, targets.cleaningTasks, expectedToDate.cleaningTasks, 'tasks', cleaningEvidence),
  ];
  if (!measurable[1].earned) {
    measurable[1].remainingText = pending ? pendingSummary
      : eligible === 0 ? 'Complete one non-excused shift'
        : !attendanceMet && !punctualityMet ? `Attendance and on-time targets not yet reached (${targets.attendancePercent}% each)`
          : !attendanceMet ? `Attendance target not yet reached (${targets.attendancePercent}%)`
            : `On-time target not yet reached (${targets.attendancePercent}%)`;
  }
  const firstFourComplete = measurable.every((milestone) => milestone.earned);
  const management = buildMilestone('management_feedback', 'Management feedback', firstFourComplete && feedback?.approved ? 1 : 0, 1, 1, 'approval',
    feedback ? [{ label: feedback.approved ? 'Management approved' : 'Feedback draft', detail: feedback.feedback ?? undefined,
      occurredAt: feedback.approvedAt ?? feedback.updatedAt, status: feedback.approved ? 'approved' : 'draft' }] : []);
  if (!firstFourComplete) {
    management.state = 'locked'; management.reason = 'Complete the first four stay milestones before management approval.';
    management.remainingText = 'Complete the first four milestones';
  }
  const milestones = [...measurable, management];
  return { ...common, targetSummary, starsEarned: milestones.filter((milestone) => milestone.earned).length,
    milestones, attendanceAssignments, managementFeedback,
    warnings: excludedLegacy ? ['Monthly-only legacy review totals from partial or ongoing calendar months are excluded because individual review dates are unavailable. Complete calendar months contained within this stay are included.'] : [],
  };
};

export type VolunteerStayProgress = ReturnType<typeof buildProgress>;

const loadStayReports = async (users: UserRecord[], stays: VolunteerStay[], types: ShiftType[], now: Date, stayId?: number, transaction?: Transaction): Promise<VolunteerStayProgress[]> => {
  const today = dayjs(now).tz(VOLUNTEER_MILESTONE_TIMEZONE).format('YYYY-MM-DD');
  const byUser = new Map(users.map((user) => [user.id, stays.filter((stay) => stay.userId === user.id)]));
  const selections = new Map(users.map((user) => [user.id, selectedStay(byUser.get(user.id)!, today, stayId)]));
  const selected = [...selections.values()].filter((stay): stay is VolunteerStay => stay != null);
  const evidence = await loadEvidence(selected, today, transaction);
  const feedbackIds = [...new Set(selected.flatMap((stay) => [stay.feedback?.approvedBy, stay.feedback?.updatedBy]).filter((id): id is number => typeof id === 'number'))];
  const reviewers = feedbackIds.length ? await User.findAll({ where: { id: { [Op.in]: feedbackIds } }, attributes: ['id', 'firstName', 'lastName', 'email'], transaction }) : [];
  const names = new Map(reviewers.map((user) => [user.id, fullName(user)]));
  return users.map((user) => buildProgress(user, byUser.get(user.id)!, selections.get(user.id)!, evidence, types, now, names));
};

export const getVolunteerStayProgress = async (
  userId: number, options: { stayId?: number; selfAccess?: boolean; now?: Date; transaction?: Transaction } = {},
): Promise<VolunteerStayProgress> => {
  const [user, profile, stays, types] = await Promise.all([
    User.findByPk(userId, { attributes: userAttributes, include: [{ model: UserType, as: 'role', attributes: ['slug'], required: false }], transaction: options.transaction }) as Promise<UserRecord | null>,
    StaffProfile.findOne({ where: { userId, staffType: 'volunteer' }, attributes: ['userId', 'active'], transaction: options.transaction }),
    VolunteerStay.findAll({ where: { userId }, order: [['startDate', 'DESC'], ['id', 'DESC']], transaction: options.transaction }),
    ShiftType.findAll({ attributes: ['id', 'key', 'name'], order: [['name', 'ASC']], transaction: options.transaction }),
  ]);
  if (!user) throw new HttpError(options.selfAccess ? 403 : 404, 'Volunteer stay progress is not available for this person.');
  const historicalVolunteer = !profile && !stays.length
    ? await StaffProfileTypePeriod.findOne({
      where: {
        userId,
        staffType: 'volunteer',
        effectiveStart: { [Op.lte]: dayjs(options.now ?? new Date()).tz(VOLUNTEER_MILESTONE_TIMEZONE).format('YYYY-MM-DD') },
      },
      attributes: ['id'],
      transaction: options.transaction,
    })
    : null;
  if (!profile && !stays.length && !historicalVolunteer) throw new HttpError(options.selfAccess ? 403 : 404, 'Volunteer stay progress is not available for this person.');
  user.volunteerProfileActive = profile?.active === true;
  const [progress] = await loadStayReports([user], stays, types, options.now ?? new Date(), options.stayId, options.transaction);
  return progress;
};

export const listVolunteerStayProgress = async (options: { now?: Date } = {}) => {
  const today = dayjs(options.now ?? new Date()).tz(VOLUNTEER_MILESTONE_TIMEZONE).format('YYYY-MM-DD');
  const [profiles, historicalVolunteerPeriods, stays, types] = await Promise.all([
    // Keep former volunteers available for historical stay setup even when the
    // user or staff profile was deactivated before a stay was saved.
    StaffProfile.findAll({ where: { staffType: 'volunteer' }, attributes: ['userId', 'active'] }),
    StaffProfileTypePeriod.findAll({
      where: { staffType: 'volunteer', effectiveStart: { [Op.lte]: today } },
      attributes: ['userId'],
    }),
    VolunteerStay.findAll({ order: [['startDate', 'DESC'], ['id', 'DESC']] }),
    ShiftType.findAll({ attributes: ['id', 'key', 'name'], order: [['name', 'ASC']] }),
  ]);
  const ids = [...new Set([
    ...profiles.map((profile) => profile.userId),
    ...historicalVolunteerPeriods.map((period) => period.userId),
    ...stays.map((stay) => stay.userId),
  ])];
  const users = ids.length ? await User.findAll({ where: { id: { [Op.in]: ids } }, attributes: userAttributes,
    include: [{ model: UserType, as: 'role', attributes: ['slug'], required: false }],
    order: [['firstName', 'ASC'], ['lastName', 'ASC'], ['id', 'ASC']],
  }) as UserRecord[] : [];
  const activeProfileIds = new Set(profiles.filter((profile) => profile.active === true).map((profile) => profile.userId));
  users.forEach((user) => { user.volunteerProfileActive = activeProfileIds.has(user.id); });
  const progress = await loadStayReports(users, stays, types, options.now ?? new Date());
  return { mode: 'stay' as const, volunteers: progress.map((report) => ({ ...report,
    milestones: report.milestones.map((milestone) => ({ ...milestone, evidence: [] })), attendanceAssignments: [],
  })), shiftTypes: shiftOptions(types) };
};

const parseStayValues = (body: unknown, previous?: VolunteerStay) => {
  const input = record(body);
  const allowed = new Set(['startDate', 'endDate', 'position', 'monthlyTargets', 'shiftTypeIds', 'changeReason', ...(previous ? ['expectedRevision'] : [])]);
  const unknown = Object.keys(input).find((key) => !allowed.has(key));
  if (unknown) throw new HttpError(400, `Unknown stay field: ${unknown}`);
  const startDate = dateOnly(Object.prototype.hasOwnProperty.call(input, 'startDate') ? input.startDate : previous?.startDate);
  const endDate = dateOnly(Object.prototype.hasOwnProperty.call(input, 'endDate') ? input.endDate : previous?.endDate);
  if (!startDate || !endDate || endDate <= startDate) throw new HttpError(400, 'A valid arrival date and later departure date are required. Departure is not counted as a stay day.');
  const position = Object.prototype.hasOwnProperty.call(input, 'position') ? input.position : previous?.position;
  if (position !== 'guide' && position !== 'social_media') throw new HttpError(400, 'position must be guide or social_media');
  for (const field of ['monthlyTargets', 'shiftTypeIds']) {
    if (Object.prototype.hasOwnProperty.call(input, field) && (!input[field] || typeof input[field] !== 'object' || Array.isArray(input[field]))) {
      throw new HttpError(400, `${field} must be an object.`);
    }
  }
  const monthlyInput = record(input.monthlyTargets ?? previous?.monthlyTargets ?? DEFAULT_VOLUNTEER_MONTHLY_TARGETS);
  const monthlyTargets = {} as VolunteerMonthlyTargets;
  for (const key of Object.keys(DEFAULT_VOLUNTEER_MONTHLY_TARGETS) as Array<keyof VolunteerMonthlyTargets>) {
    const value = monthlyInput[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > (key === 'attendancePercent' ? 100 : 10000)) {
      throw new HttpError(400, `${key} must be a non-negative number${key === 'attendancePercent' ? ' up to 100' : ''}.`);
    }
    monthlyTargets[key] = value;
  }
  if (Object.keys(monthlyInput).some((key) => !Object.prototype.hasOwnProperty.call(DEFAULT_VOLUNTEER_MONTHLY_TARGETS, key))) throw new HttpError(400, 'Unknown monthly target field.');
  const rawMappings = record(input.shiftTypeIds ?? previous?.shiftTypeIds);
  const shiftTypeIds: ShiftMappings = { guiding: [], promotion: [], socialMedia: [] };
  const seen = new Set<number>();
  for (const key of Object.keys(shiftTypeIds) as Array<keyof ShiftMappings>) {
    const values = rawMappings[key] ?? [];
    if (!Array.isArray(values) || values.some((id) => typeof id !== 'number' || !Number.isInteger(id) || id <= 0)) throw new HttpError(400, `${key} shift types must be positive integer IDs.`);
    for (const id of values) {
      if (seen.has(id)) throw new HttpError(400, 'A shift type can belong to only one stay commitment.');
      seen.add(id);
    }
    shiftTypeIds[key] = [...values].sort((left, right) => left - right);
  }
  if (Object.keys(rawMappings).some((key) => !(key in shiftTypeIds))) throw new HttpError(400, 'Unknown shift type mapping.');
  if ((position === 'guide' && monthlyTargets.guidingShifts > 0 && !shiftTypeIds.guiding.length)
    || (position === 'guide' && monthlyTargets.promotionShifts > 0 && !shiftTypeIds.promotion.length)
    || (position === 'social_media' && monthlyTargets.socialMediaShifts > 0 && !shiftTypeIds.socialMedia.length)) {
    throw new HttpError(400, 'Choose the shift types for every non-zero commitment before saving the stay.');
  }
  if (input.changeReason != null && typeof input.changeReason !== 'string') throw new HttpError(400, 'changeReason must be text.');
  const changeReason = typeof input.changeReason === 'string' ? input.changeReason.trim() : null;
  if ((previous && !changeReason) || (changeReason && changeReason.length > 2000)) throw new HttpError(400, 'A reason of at most 2000 characters is required for stay edits.');
  if (!previous && !changeReason && (Object.keys(monthlyTargets) as Array<keyof VolunteerMonthlyTargets>)
    .some((key) => monthlyTargets[key] !== DEFAULT_VOLUNTEER_MONTHLY_TARGETS[key])) {
    throw new HttpError(400, 'Explain why the stay uses custom monthly targets before saving.');
  }
  return { startDate, endDate, position: position as Position, monthlyTargets, shiftTypeIds, changeReason: changeReason || null };
};

const assertExpectedRevision = (value: unknown, stay: VolunteerStay): void => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new HttpError(400, 'expectedRevision must be a positive integer.');
  if (value !== stay.revision) throw new HttpError(409, 'This stay changed since it was opened. Refresh it before saving.');
};
const writeRevision = async (
  stay: VolunteerStay,
  actorId: number | null,
  reason: string | null,
  action: string,
  transaction: Transaction,
  approvalEvidence?: Record<string, unknown>,
  auditMeta?: Record<string, unknown>,
) => {
  await VolunteerStayRevision.create({ stayId: stay.id, revision: stay.revision,
    snapshot: { ...serializeVolunteerStay(stay), ...(approvalEvidence ? { approvalEvidence } : {}) }, reason, actorId }, { transaction });
  await AuditLog.create({ actorId, action, entity: 'volunteer_stay', entityId: String(stay.id),
    metaJson: { userId: stay.userId, stayId: stay.id, revision: stay.revision, reason, ...auditMeta } }, { transaction });
};

export type EnsureVolunteerStayResult = {
  status: 'created' | 'existing' | 'skipped';
  stayId: number | null;
  reason?: 'user_not_found' | 'inactive_user' | 'unapproved_user' | 'inactive_volunteer_profile'
    | 'missing_or_invalid_dates' | 'past_stay' | 'unsupported_position' | 'missing_shift_mapping';
};

const AUTO_STAY_REASON = 'Automatically created from the active Volunteer profile.';

/**
 * Create the default stay once all lifecycle prerequisites exist. This is
 * deliberately create-only: later profile, role, or date edits never rewrite
 * an audited stay, and managers retain the existing revisioned editor.
 */
export const ensureDefaultVolunteerStay = async (params: {
  userId: number;
  actorId?: number | null;
  source?: string;
  transaction?: Transaction;
  now?: Date;
  /** Management-controlled profile/user mutations may activate a stay before account approval. */
  allowUnapproved?: boolean;
}): Promise<EnsureVolunteerStayResult> => {
  const work = async (transaction: Transaction): Promise<EnsureVolunteerStayResult> => {
    const user = await User.findByPk(params.userId, {
      attributes: ['id', 'status', 'approved', 'arrivalDate', 'departureDate', 'userTypeId'],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!user) return { status: 'skipped', stayId: null, reason: 'user_not_found' };
    if (user.status !== true) return { status: 'skipped', stayId: null, reason: 'inactive_user' };
    if (user.approved !== true && params.allowUnapproved !== true) {
      return { status: 'skipped', stayId: null, reason: 'unapproved_user' };
    }

    const profile = await StaffProfile.findOne({
      where: { userId: params.userId, staffType: 'volunteer', active: true },
      attributes: ['userId'],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!profile) return { status: 'skipped', stayId: null, reason: 'inactive_volunteer_profile' };

    const startDate = dateOnly(user.arrivalDate);
    const endDate = dateOnly(user.departureDate);
    if (!startDate || !endDate || endDate <= startDate) {
      return { status: 'skipped', stayId: null, reason: 'missing_or_invalid_dates' };
    }
    const today = dayjs(params.now ?? new Date()).tz(VOLUNTEER_MILESTONE_TIMEZONE).format('YYYY-MM-DD');
    if (endDate <= today) return { status: 'skipped', stayId: null, reason: 'past_stay' };

    const role = user.userTypeId ? await UserType.findByPk(user.userTypeId, {
      attributes: ['slug'], transaction,
    }) : null;
    const position = resolveVolunteerStayPosition(role?.slug);
    if (!position) return { status: 'skipped', stayId: null, reason: 'unsupported_position' };

    // Locking the user above serializes all application writers for this person.
    const overlapping = await VolunteerStay.findOne({
      where: {
        userId: params.userId,
        startDate: { [Op.lt]: endDate },
        endDate: { [Op.gt]: startDate },
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (overlapping) return { status: 'existing', stayId: overlapping.id };

    const shiftTypes = await ShiftType.findAll({
      attributes: ['id', 'key', 'name'],
      order: [['id', 'ASC']],
      transaction,
    });
    const shiftTypeIds = suggestVolunteerShiftMappings(shiftTypes);
    const hasRequiredMappings = position === 'guide'
      ? shiftTypeIds.guiding.length > 0 && shiftTypeIds.promotion.length > 0
      : shiftTypeIds.socialMedia.length > 0;
    if (!hasRequiredMappings) return { status: 'skipped', stayId: null, reason: 'missing_shift_mapping' };

    const actorId = params.actorId ?? null;
    const created = await VolunteerStay.create({
      userId: params.userId,
      startDate,
      endDate,
      position,
      monthlyTargets: { ...DEFAULT_VOLUNTEER_MONTHLY_TARGETS },
      shiftTypeIds,
      feedback: null,
      changeReason: AUTO_STAY_REASON,
      revision: 1,
      createdBy: actorId,
      updatedBy: actorId,
    }, { transaction });
    await writeRevision(created, actorId, AUTO_STAY_REASON, 'volunteer_stay.auto_created', transaction, undefined, {
      source: params.source ?? 'application',
    });
    return { status: 'created', stayId: created.id };
  };

  return params.transaction ? work(params.transaction) : sequelize.transaction(work);
};

export const saveVolunteerStay = async (params: { userId: number; stayId?: number; body: unknown; actorId: number }): Promise<VolunteerStayProgress> => {
  const stayId = await sequelize.transaction(async (transaction) => {
    const user = await User.findByPk(params.userId, { attributes: ['id'], transaction, lock: transaction.LOCK.UPDATE });
    if (!user) throw new HttpError(404, 'Volunteer was not found.');
    const profile = await StaffProfile.findOne({
      where: { userId: params.userId, staffType: 'volunteer' }, transaction, lock: transaction.LOCK.UPDATE,
    });
    const previous = params.stayId ? await VolunteerStay.findOne({ where: { id: params.stayId, userId: params.userId }, transaction, lock: transaction.LOCK.UPDATE }) : null;
    if (params.stayId && !previous) throw new HttpError(404, 'Volunteer stay was not found for this person.');
    if (previous) assertExpectedRevision(record(params.body).expectedRevision, previous);
    const values = parseStayValues(params.body, previous ?? undefined);
    if (!previous && !profile) {
      const historicalVolunteer = await StaffProfileTypePeriod.findOne({
        where: {
          userId: params.userId,
          staffType: 'volunteer',
          effectiveStart: { [Op.lt]: values.endDate },
          [Op.or]: [
            { effectiveEnd: null },
            { effectiveEnd: { [Op.gte]: values.startDate } },
          ],
        },
        attributes: ['id'],
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!historicalVolunteer) throw new HttpError(400, 'A current or historically recorded volunteer staff profile is required to create a stay for these dates.');
    }
    const ids = Object.values(values.shiftTypeIds).flat();
    const types = ids.length ? await ShiftType.findAll({ where: { id: { [Op.in]: ids } }, attributes: ['id'], transaction }) : [];
    if (types.length !== ids.length) throw new HttpError(400, 'One or more selected shift types no longer exist.');
    const overlapping = await VolunteerStay.findOne({ where: {
      userId: params.userId, ...(previous ? { id: { [Op.ne]: previous.id } } : {}),
      startDate: { [Op.lt]: values.endDate }, endDate: { [Op.gt]: values.startDate },
    }, transaction, lock: transaction.LOCK.UPDATE });
    if (overlapping) throw new HttpError(409, 'This person already has a stay that overlaps these dates. Edit that stay or choose separate dates.');
    if (previous) {
      const comparable = (stay: typeof values | VolunteerStay) => JSON.stringify({
        startDate: stay.startDate, endDate: stay.endDate, position: stay.position,
        monthlyTargets: (Object.keys(DEFAULT_VOLUNTEER_MONTHLY_TARGETS) as Array<keyof VolunteerMonthlyTargets>)
          .map((key) => [key, stay.monthlyTargets[key]]),
        shiftTypeIds: (['guiding', 'promotion', 'socialMedia'] as const)
          .map((key) => [key, [...stay.shiftTypeIds[key]].sort((left, right) => left - right)]),
      });
      if (comparable(previous) === comparable(values)) return previous.id;
      await previous.update({ ...values, revision: previous.revision + 1, updatedBy: params.actorId,
        feedback: previous.feedback ? { ...previous.feedback, approved: false, approvedAt: null, approvedBy: null,
          updatedAt: new Date().toISOString(), updatedBy: params.actorId } : null,
      }, { transaction });
      await writeRevision(previous, params.actorId, values.changeReason, 'volunteer_stay.updated', transaction);
      return previous.id;
    }
    const created = await VolunteerStay.create({ ...values, userId: params.userId, revision: 1,
      feedback: null, createdBy: params.actorId, updatedBy: params.actorId }, { transaction });
    await writeRevision(created, params.actorId, values.changeReason, 'volunteer_stay.created', transaction);
    return created.id;
  });
  return getVolunteerStayProgress(params.userId, { stayId });
};

export const saveVolunteerStayFeedback = async (params: { userId: number; stayId: number; body: unknown; actorId: number }): Promise<VolunteerStayProgress> => {
  const body = record(params.body);
  if (Object.keys(body).some((key) => !['feedback', 'approved', 'expectedRevision'].includes(key))) throw new HttpError(400, 'Unknown feedback field.');
  if (typeof body.approved !== 'boolean') throw new HttpError(400, 'approved must be boolean.');
  const feedback = typeof body.feedback === 'string' ? body.feedback.trim() || null : null;
  if ((feedback?.length ?? 0) > 5000 || (body.approved && !feedback)) throw new HttpError(400, 'Written feedback of at most 5000 characters is required for approval.');
  await sequelize.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ }, async (transaction) => {
    await User.findByPk(params.userId, { attributes: ['id'], transaction, lock: transaction.LOCK.UPDATE });
    const stay = await VolunteerStay.findOne({ where: { id: params.stayId, userId: params.userId }, transaction, lock: transaction.LOCK.UPDATE });
    if (!stay) throw new HttpError(404, 'Volunteer stay was not found for this person.');
    assertExpectedRevision(body.expectedRevision, stay);
    const today = dayjs().tz(VOLUNTEER_MILESTONE_TIMEZONE).format('YYYY-MM-DD');
    if (stay.startDate > today) throw new HttpError(400, 'Management feedback cannot be recorded before the stay begins.');
    let approvalEvidence: Record<string, unknown> | undefined;
    if (body.approved) {
      const progress = await getVolunteerStayProgress(params.userId, { stayId: stay.id, transaction });
      const incomplete = progress.milestones.filter((milestone) => milestone.key !== 'management_feedback' && !milestone.earned).map((milestone) => milestone.key);
      if (incomplete.length) throw new HttpError(409, 'The first four stay milestones must be earned before management approval.', { incompleteMilestones: incomplete });
      approvalEvidence = {
        asOfDate: progress.asOfDate, timezone: progress.timezone, targetSummary: progress.targetSummary,
        milestones: progress.milestones.filter((milestone) => milestone.key !== 'management_feedback').map((milestone) => ({
          key: milestone.key, current: milestone.current, target: milestone.target, earned: milestone.earned,
          subtargets: milestone.subtargets ?? [], evidence: milestone.evidence,
        })),
      };
    }
    const now = new Date().toISOString();
    const approved = body.approved as boolean;
    await stay.update({ revision: stay.revision + 1, updatedBy: params.actorId,
      feedback: { approved, feedback, approvedBy: approved ? stay.feedback?.approvedBy ?? params.actorId : null,
        approvedAt: approved ? stay.feedback?.approvedAt ?? now : null, updatedBy: params.actorId, updatedAt: now },
    }, { transaction });
    await writeRevision(stay, params.actorId, 'Management feedback updated', 'volunteer_stay.feedback_updated', transaction, approvalEvidence);
  }).catch((error: unknown) => {
    const failure = record(error);
    const code = record(failure.original).code ?? record(failure.parent).code ?? failure.code;
    if (code === '40001' || code === '40P01') throw new HttpError(409, 'This stay changed while feedback was being saved. Refresh it before saving again.');
    throw error;
  });
  return getVolunteerStayProgress(params.userId, { stayId: params.stayId });
};
