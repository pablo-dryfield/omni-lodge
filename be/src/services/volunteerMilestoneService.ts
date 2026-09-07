import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';
import { Op } from 'sequelize';
import HttpError from '../errors/HttpError.js';
import AssistantManagerTaskLog from '../models/AssistantManagerTaskLog.js';
import AssistantManagerTaskTemplate from '../models/AssistantManagerTaskTemplate.js';
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
import User from '../models/User.js';
import VolunteerMilestoneFeedback from '../models/VolunteerMilestoneFeedback.js';
import VolunteerShiftAttendance, {
  type VolunteerAttendanceStatus,
} from '../models/VolunteerShiftAttendance.js';
import { reviewDateRangeInWarsaw } from '../utils/reviewCreditMonth.js';

dayjs.extend(utc);
dayjs.extend(timezone);

export const VOLUNTEER_MILESTONE_TIMEZONE = 'Europe/Warsaw';
export const VOLUNTEER_MILESTONE_THRESHOLDS = {
  reviews: 5,
  attendancePercent: 90,
  monthlyShifts: 16,
  cleaningTasks: 5,
} as const;

export type VolunteerMilestoneKey =
  | 'reviews'
  | 'attendance'
  | 'monthly_shifts'
  | 'cleaning'
  | 'management_feedback';

export type VolunteerMilestoneState = 'earned' | 'in_progress' | 'locked';

export type VolunteerMilestonePeriod = {
  month: string;
  startDate: string;
  endDate: string;
  asOfDate: string;
  timezone: typeof VOLUNTEER_MILESTONE_TIMEZONE;
};

export type VolunteerMilestoneEvidence = {
  id?: string | number;
  label: string;
  detail?: string;
  occurredAt?: string;
  status?: string;
};

export type VolunteerMilestone = {
  key: VolunteerMilestoneKey;
  title: string;
  current: number;
  target: number;
  unit: string;
  progressPercent: number;
  earned: boolean;
  state: VolunteerMilestoneState;
  remainingText: string;
  reason: string;
  evidence: VolunteerMilestoneEvidence[];
};

export type VolunteerMilestoneUser = {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  profilePhotoUrl: string | null;
};

export type VolunteerAttendanceAssignment = {
  assignmentId: number;
  shiftInstanceId: number;
  date: string;
  startTime: string;
  endTime: string | null;
  shiftName: string;
  role: string | null;
  status: VolunteerAttendanceStatus | null;
  notes: string | null;
  recordedAt: Date | null;
  recordedByName: string | null;
  isPast: boolean;
};

export type VolunteerManagementFeedbackPayload = {
  approved: boolean;
  feedback: string | null;
  approvedAt: Date | null;
  approvedByName: string | null;
  updatedAt: Date;
  updatedByName: string | null;
};

export type VolunteerMilestoneProgress = {
  period: VolunteerMilestonePeriod;
  user: VolunteerMilestoneUser;
  starsEarned: number;
  totalStars: 5;
  milestones: VolunteerMilestone[];
  attendanceAssignments: VolunteerAttendanceAssignment[];
  managementFeedback: VolunteerManagementFeedbackPayload | null;
};

type FeedbackWithUser = VolunteerMilestoneFeedback & {
  approvedByUser?: User | null;
  updatedByUser?: User | null;
};

type ProfileWithUser = StaffProfile & {
  user?: User | null;
};

type ReviewEntryWithCounter = ReviewCounterEntry & {
  counter?: ReviewCounter | null;
};

type ReviewCreditRecord = {
  id?: string | number;
  userId: number;
  amount: number;
  label: string;
  detail: string;
  occurredAt: string;
  status: 'credited';
};

type TaskLogWithTemplate = AssistantManagerTaskLog & {
  template?: AssistantManagerTaskTemplate | null;
};

type AssignmentWithRelations = ShiftAssignment & {
  shiftInstance?: (ShiftInstance & {
    shiftType?: ShiftType | null;
    template?: ShiftTemplate | null;
    scheduleWeek?: ScheduleWeek | null;
  }) | null;
  volunteerAttendance?: (VolunteerShiftAttendance & {
    recordedByUser?: User | null;
  }) | null;
};

export type MilestoneCalculationInput = {
  reviewCredits: number;
  scheduledPastShifts: number;
  pendingAttendance: number;
  attendedShifts: number;
  lateShifts: number;
  absentShifts: number;
  excusedShifts: number;
  completedCleaningTasks: number;
  managementApproved: boolean;
  evidence?: Partial<Record<VolunteerMilestoneKey, VolunteerMilestoneEvidence[]>>;
};

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/u;

const progressPercent = (current: number, target: number): number => {
  if (target <= 0) {
    return 100;
  }
  return Math.max(0, Math.min(100, Math.round((current / target) * 100)));
};

const pluralize = (count: number, singular: string, plural = `${singular}s`): string =>
  `${count} ${count === 1 ? singular : plural}`;

const safeNumber = (value: unknown): number => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const nameForUser = (user?: User | null): string | null => {
  if (!user) {
    return null;
  }
  const name = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
  return name || user.email || null;
};

export const parseVolunteerMilestonePeriod = (
  month?: string | null,
  now: Date = new Date(),
): VolunteerMilestonePeriod => {
  const normalizedMonth = month?.trim() || dayjs(now).tz(VOLUNTEER_MILESTONE_TIMEZONE).format('YYYY-MM');
  if (!MONTH_PATTERN.test(normalizedMonth)) {
    throw new HttpError(400, 'month must use YYYY-MM format');
  }

  const startDate = `${normalizedMonth}-01`;
  const endDate = dayjs(startDate).add(1, 'month').subtract(1, 'day').format('YYYY-MM-DD');
  return {
    month: normalizedMonth,
    startDate,
    endDate,
    asOfDate: (() => {
      const today = dayjs(now).tz(VOLUNTEER_MILESTONE_TIMEZONE).format('YYYY-MM-DD');
      if (today < startDate) {
        return startDate;
      }
      return today > endDate ? endDate : today;
    })(),
    timezone: VOLUNTEER_MILESTONE_TIMEZONE,
  };
};

const normalizeTime = (value: string | null | undefined): string => {
  const trimmed = String(value ?? '00:00:00').trim();
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?/u.exec(trimmed);
  return match ? `${match[1]}:${match[2]}:${match[3] ?? '00'}` : '00:00:00';
};

export const isPastShift = (
  shift: Pick<ShiftInstance, 'date' | 'timeStart' | 'timeEnd'>,
  now: Date = new Date(),
): boolean => {
  const startTime = normalizeTime(shift.timeStart);
  const endTime = normalizeTime(shift.timeEnd ?? shift.timeStart);
  let end = dayjs.tz(`${shift.date}T${endTime}`, VOLUNTEER_MILESTONE_TIMEZONE);
  if (shift.timeEnd && endTime < startTime) {
    end = end.add(1, 'day');
  }
  return !end.isAfter(dayjs(now));
};

const normalizedTags = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
};

export const isCleaningTaskTemplate = (
  template?: Pick<AssistantManagerTaskTemplate, 'name' | 'category' | 'subgroup' | 'scheduleConfig'> | null,
  logMeta?: Record<string, unknown> | null,
): boolean => {
  if (!template) {
    return false;
  }
  const tags = [
    ...normalizedTags(template.scheduleConfig?.tags),
    ...normalizedTags(logMeta?.tags),
  ];
  if (tags.some((tag) => ['cleaning', 'housekeeping', 'house-care', 'house_care'].includes(tag))) {
    return true;
  }

  const searchable = [template.name, template.category, template.subgroup]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();
  return /\b(clean(?:ing)?|housekeeping|house[\s_-]*care)\b/u.test(searchable);
};

export const calculateVolunteerMilestones = (input: MilestoneCalculationInput): VolunteerMilestone[] => {
  const evidence = input.evidence ?? {};
  const reviewCredits = Math.max(0, input.reviewCredits);
  const reviewsEarned = reviewCredits >= VOLUNTEER_MILESTONE_THRESHOLDS.reviews;

  const eligibleAttendance = Math.max(0, input.scheduledPastShifts - input.excusedShifts);
  const attendanceCount = Math.max(0, input.attendedShifts + input.lateShifts);
  const attendanceRate = eligibleAttendance > 0
    ? Math.round((attendanceCount / eligibleAttendance) * 100)
    : 0;
  const attendanceEarned = input.scheduledPastShifts > 0
    && eligibleAttendance > 0
    && input.pendingAttendance === 0
    && input.absentShifts === 0
    && attendanceRate >= VOLUNTEER_MILESTONE_THRESHOLDS.attendancePercent;
  const shiftsEarned = attendanceCount >= VOLUNTEER_MILESTONE_THRESHOLDS.monthlyShifts;
  const cleaningEarned = input.completedCleaningTasks >= VOLUNTEER_MILESTONE_THRESHOLDS.cleaningTasks;
  const measurableComplete = reviewsEarned && attendanceEarned && shiftsEarned && cleaningEarned;
  const managementEarned = measurableComplete && input.managementApproved;

  let attendanceReason = `Attendance is ${attendanceRate}% against a ${VOLUNTEER_MILESTONE_THRESHOLDS.attendancePercent}% target.`;
  let attendanceRemaining = `${VOLUNTEER_MILESTONE_THRESHOLDS.attendancePercent}% attendance required`;
  if (input.scheduledPastShifts === 0) {
    attendanceReason = 'No completed scheduled shift is available yet.';
    attendanceRemaining = 'Complete your first scheduled shift';
  } else if (input.pendingAttendance > 0) {
    attendanceReason = `${pluralize(input.pendingAttendance, 'shift')} awaiting management confirmation.`;
    attendanceRemaining = `${pluralize(input.pendingAttendance, 'confirmation')} pending`;
  } else if (eligibleAttendance === 0) {
    attendanceReason = 'All completed scheduled shifts were excused, so attendance is not measurable yet.';
    attendanceRemaining = 'Complete one non-excused shift';
  } else if (input.absentShifts > 0) {
    attendanceReason = `${pluralize(input.absentShifts, 'unexcused absence')} recorded this month.`;
    attendanceRemaining = 'Resolve or avoid unexcused absences';
  } else if (attendanceEarned) {
    attendanceReason = `${attendanceRate}% attendance with ${pluralize(input.lateShifts, 'late arrival')}.`;
    attendanceRemaining = 'Target reached';
  }

  const reviewRemaining = Math.max(0, VOLUNTEER_MILESTONE_THRESHOLDS.reviews - reviewCredits);
  const shiftRemaining = Math.max(0, VOLUNTEER_MILESTONE_THRESHOLDS.monthlyShifts - attendanceCount);
  const cleaningRemaining = Math.max(0, VOLUNTEER_MILESTONE_THRESHOLDS.cleaningTasks - input.completedCleaningTasks);

  return [
    {
      key: 'reviews',
      title: 'Review target',
      current: reviewCredits,
      target: VOLUNTEER_MILESTONE_THRESHOLDS.reviews,
      unit: 'reviews',
      progressPercent: progressPercent(reviewCredits, VOLUNTEER_MILESTONE_THRESHOLDS.reviews),
      earned: reviewsEarned,
      state: reviewsEarned ? 'earned' : 'in_progress',
      remainingText: reviewsEarned ? 'Target reached' : `${pluralize(reviewRemaining, 'review')} to go`,
      reason: reviewsEarned
        ? 'The monthly review-credit target is complete.'
        : `${pluralize(reviewCredits, 'review credit')} recorded this month.`,
      evidence: evidence.reviews ?? [],
    },
    {
      key: 'attendance',
      title: 'Attendance & punctuality',
      current: attendanceRate,
      target: VOLUNTEER_MILESTONE_THRESHOLDS.attendancePercent,
      unit: '%',
      progressPercent: progressPercent(attendanceRate, VOLUNTEER_MILESTONE_THRESHOLDS.attendancePercent),
      earned: attendanceEarned,
      state: attendanceEarned ? 'earned' : 'in_progress',
      remainingText: attendanceRemaining,
      reason: attendanceReason,
      evidence: evidence.attendance ?? [],
    },
    {
      key: 'monthly_shifts',
      title: 'Monthly shift commitment',
      current: attendanceCount,
      target: VOLUNTEER_MILESTONE_THRESHOLDS.monthlyShifts,
      unit: 'shifts',
      progressPercent: progressPercent(attendanceCount, VOLUNTEER_MILESTONE_THRESHOLDS.monthlyShifts),
      earned: shiftsEarned,
      state: shiftsEarned ? 'earned' : 'in_progress',
      remainingText: shiftsEarned ? 'Target reached' : `${pluralize(shiftRemaining, 'shift')} to go`,
      reason: `${pluralize(attendanceCount, 'manager-confirmed shift')} attended this month.`,
      evidence: evidence.monthly_shifts ?? [],
    },
    {
      key: 'cleaning',
      title: 'Cleaning & house care',
      current: Math.max(0, input.completedCleaningTasks),
      target: VOLUNTEER_MILESTONE_THRESHOLDS.cleaningTasks,
      unit: 'tasks',
      progressPercent: progressPercent(
        Math.max(0, input.completedCleaningTasks),
        VOLUNTEER_MILESTONE_THRESHOLDS.cleaningTasks,
      ),
      earned: cleaningEarned,
      state: cleaningEarned ? 'earned' : 'in_progress',
      remainingText: cleaningEarned ? 'Target reached' : `${pluralize(cleaningRemaining, 'task')} to go`,
      reason: `${pluralize(Math.max(0, input.completedCleaningTasks), 'cleaning task')} completed this month.`,
      evidence: evidence.cleaning ?? [],
    },
    {
      key: 'management_feedback',
      title: 'Management feedback',
      current: managementEarned ? 1 : 0,
      target: 1,
      unit: 'approval',
      progressPercent: managementEarned ? 100 : 0,
      earned: managementEarned,
      state: !measurableComplete ? 'locked' : managementEarned ? 'earned' : 'in_progress',
      remainingText: !measurableComplete
        ? 'Complete the first four milestones'
        : managementEarned
          ? 'Final star confirmed'
          : 'Awaiting management feedback',
      reason: !measurableComplete
        ? input.managementApproved
          ? 'Management approval is recorded, but this star is locked because a measurable milestone is no longer earned.'
          : 'This final star unlocks after all four measurable milestones are earned.'
        : managementEarned
          ? 'Management approved the final monthly star.'
          : 'The measurable milestones are complete and ready for management review.',
      evidence: evidence.management_feedback ?? [],
    },
  ];
};

const findVolunteer = async (
  userId: number,
  options: { activeOnly?: boolean; selfAccess?: boolean } = {},
): Promise<ProfileWithUser> => {
  const profile = await StaffProfile.findOne({
    where: {
      userId,
      staffType: 'volunteer',
      ...(options.activeOnly ? { active: true } : {}),
    },
    include: [{ model: User, as: 'user', attributes: ['id', 'firstName', 'lastName', 'email', 'profilePhotoUrl', 'status'] }],
  }) as ProfileWithUser | null;

  if (!profile || !profile.user) {
    throw new HttpError(
      options.selfAccess ? 403 : 404,
      options.selfAccess
        ? 'Volunteer milestones are available only to volunteers.'
        : 'Volunteer not found.',
    );
  }
  return profile;
};

/** Photo checks belong to the original person, physical shift/type and evidence task date. */
export const currentVolunteerAttendance = (assignment: Pick<AssignmentWithRelations, 'userId' | 'shiftInstance' | 'volunteerAttendance'>) => {
  const attendance = assignment.volunteerAttendance;
  if (!attendance || (attendance.subjectUserId != null && attendance.subjectUserId !== assignment.userId)) return undefined;
  if (attendance.evidenceTaskLogId == null) return attendance;
  const shift = assignment.shiftInstance;
  if (!shift || attendance.evidenceTaskLog?.id !== attendance.evidenceTaskLogId || attendance.evidenceTaskLog.taskDate !== shift.date
    || attendance.evidenceShiftInstanceId !== shift.id || attendance.evidenceShiftTypeId !== shift.shiftTypeId) return undefined;
  return attendance;
};

const attendanceAssignmentPayload = (
  assignment: AssignmentWithRelations,
  now: Date,
): VolunteerAttendanceAssignment | null => {
  const instance = assignment.shiftInstance;
  if (!instance) {
    return null;
  }
  const attendance = currentVolunteerAttendance(assignment);
  const shiftName = instance.template?.name
    || instance.shiftType?.name
    || instance.shiftType?.key
    || `Shift ${instance.id}`;

  return {
    assignmentId: assignment.id,
    shiftInstanceId: instance.id,
    date: instance.date,
    startTime: instance.timeStart,
    endTime: instance.timeEnd,
    shiftName,
    role: assignment.roleInShift || null,
    status: attendance?.status ?? null,
    notes: attendance?.notes ?? null,
    recordedAt: attendance?.recordedAt ?? null,
    recordedByName: nameForUser(attendance?.recordedByUser),
    isPast: isPastShift(instance, now),
  };
};

export const deduplicateVolunteerAttendanceAssignments = (
  assignments: VolunteerAttendanceAssignment[],
): VolunteerAttendanceAssignment[] => {
  const byShiftInstance = new Map<number, VolunteerAttendanceAssignment[]>();
  for (const assignment of assignments) {
    const rows = byShiftInstance.get(assignment.shiftInstanceId) ?? [];
    rows.push(assignment);
    byShiftInstance.set(assignment.shiftInstanceId, rows);
  }

  return Array.from(byShiftInstance.values())
    .map((rows) => {
      const ordered = [...rows].sort((left, right) => {
        const leftRecordedAt = left.recordedAt ? new Date(left.recordedAt).getTime() : Number.NEGATIVE_INFINITY;
        const rightRecordedAt = right.recordedAt ? new Date(right.recordedAt).getTime() : Number.NEGATIVE_INFINITY;
        if (leftRecordedAt !== rightRecordedAt) {
          return rightRecordedAt - leftRecordedAt;
        }
        if (Boolean(left.status) !== Boolean(right.status)) {
          return left.status ? -1 : 1;
        }
        return left.assignmentId - right.assignmentId;
      });
      const selected = ordered[0];
      const roles = Array.from(new Set(rows.map((row) => row.role?.trim()).filter(Boolean)));
      return {
        ...selected,
        role: roles.length > 0 ? roles.join(', ') : null,
      };
    })
    .sort((left, right) => left.date.localeCompare(right.date)
      || left.startTime.localeCompare(right.startTime)
      || left.shiftInstanceId - right.shiftInstanceId);
};

export const selectVolunteerCleaningEvidence = (
  completedTaskEvidence: VolunteerMilestoneEvidence[],
  confirmedCleaningShiftEvidence: VolunteerMilestoneEvidence[],
): VolunteerMilestoneEvidence[] => (
  completedTaskEvidence.length >= confirmedCleaningShiftEvidence.length
    ? completedTaskEvidence
    : confirmedCleaningShiftEvidence
);

const feedbackPayload = (feedback?: FeedbackWithUser | null): VolunteerManagementFeedbackPayload | null => {
  if (!feedback) {
    return null;
  }
  return {
    approved: feedback.approved,
    feedback: feedback.feedback,
    approvedAt: feedback.approvedAt,
    approvedByName: nameForUser(feedback.approvedByUser),
    updatedAt: feedback.updatedAt,
    updatedByName: nameForUser(feedback.updatedByUser),
  };
};

export const loadVolunteerReviewCredits = async (
  userIds: number[],
  period: VolunteerMilestonePeriod,
): Promise<Map<number, ReviewCreditRecord[]>> => {
  const [legacyEntries, monthLock, manualCredits] = await Promise.all([
    ReviewCounterEntry.findAll({
      where: { userId: { [Op.in]: userIds }, category: 'staff' },
      attributes: ['id', 'userId', 'displayName', 'rawCount'],
      include: [{
        model: ReviewCounter,
        as: 'counter',
        required: true,
        attributes: ['periodStart', 'platform'],
        where: { periodStart: { [Op.between]: [period.startDate, period.endDate] } },
      }],
      order: [['id', 'ASC']],
    }) as Promise<ReviewEntryWithCounter[]>,
    ReviewMonthLock.findOne({
      where: { periodStart: period.startDate, isLocked: true },
      attributes: ['id', 'reviewIds'],
    }),
    ReviewManualCredit.findAll({
      where: {
        userId: { [Op.in]: userIds },
        date: { [Op.between]: [period.startDate, period.endDate] },
        [Op.or]: [
          { notes: null },
          { notes: { [Op.notLike]: 'Backfilled from legacy review counter #%'} },
        ],
      },
      attributes: ['id', 'userId', 'platform', 'date', 'credit', 'notes'],
      order: [['date', 'ASC'], ['id', 'ASC']],
    }),
  ]);

  const lockedReviewIds = Array.isArray(monthLock?.reviewIds)
    ? monthLock.reviewIds.map(Number).filter((id) => Number.isInteger(id) && id > 0)
    : [];
  const reviewRange = reviewDateRangeInWarsaw(period.startDate, period.endDate);
  const archivedReviews = monthLock
    ? (lockedReviewIds.length > 0
        ? await ReviewArchive.findAll({
            where: { id: { [Op.in]: lockedReviewIds } },
            attributes: ['id', 'platform', 'reviewerName', 'creditMonth', 'reviewCreatedAt'],
          })
        : [])
    : await ReviewArchive.findAll({
        where: {
          [Op.or]: [
            { creditMonth: { [Op.between]: [period.startDate, period.endDate] } },
            { creditMonth: null, reviewCreatedAt: { [Op.between]: [reviewRange.start, reviewRange.end] } },
          ],
          isDeleted: false,
        },
        attributes: ['id', 'platform', 'reviewerName', 'creditMonth', 'reviewCreatedAt'],
      });
  const archivedReviewIds = archivedReviews.map((review) => review.id);
  const archivedAssignments = archivedReviewIds.length > 0
    ? await ReviewAssignment.findAll({
        where: { reviewId: { [Op.in]: archivedReviewIds } },
        attributes: ['id', 'reviewId', 'userId'],
      })
    : [];

  const selectedUsers = new Set(userIds);
  const records = new Map<number, ReviewCreditRecord[]>();
  const add = (record: ReviewCreditRecord): void => {
    if (!selectedUsers.has(record.userId) || record.amount <= 0) {
      return;
    }
    const current = records.get(record.userId) ?? [];
    current.push(record);
    records.set(record.userId, current);
  };

  for (const entry of legacyEntries) {
    if (entry.userId == null) {
      continue;
    }
    const amount = Math.max(0, safeNumber(entry.rawCount));
    add({
      id: `legacy-${entry.id}`,
      userId: entry.userId,
      amount,
      label: `${entry.counter?.platform ?? 'Review'} counter credit`,
      detail: `${amount} credit${amount === 1 ? '' : 's'}`,
      occurredAt: entry.counter?.periodStart ?? period.startDate,
      status: 'credited',
    });
  }

  const assignmentsByReview = new Map<number, ReviewAssignment[]>();
  for (const assignment of archivedAssignments) {
    const rows = assignmentsByReview.get(assignment.reviewId) ?? [];
    rows.push(assignment);
    assignmentsByReview.set(assignment.reviewId, rows);
  }
  for (const review of archivedReviews) {
    const reviewAssignments = assignmentsByReview.get(review.id) ?? [];
    if (reviewAssignments.length === 0) {
      continue;
    }
    const amount = 1 / reviewAssignments.length;
    for (const assignment of reviewAssignments) {
      add({
        id: `archive-${review.id}-${assignment.userId}`,
        userId: assignment.userId,
        amount,
        label: review.reviewerName || `${review.platform} review`,
        detail: `${amount.toFixed(amount === 1 ? 0 : 2)} credit${amount === 1 ? '' : 's'} · ${review.platform}`,
        occurredAt: review.creditMonth ?? dayjs(review.reviewCreatedAt).tz(VOLUNTEER_MILESTONE_TIMEZONE).format('YYYY-MM-DD'),
        status: 'credited',
      });
    }
  }

  for (const manual of manualCredits) {
    if (manual.userId == null) {
      continue;
    }
    const amount = Math.max(0, safeNumber(manual.credit));
    add({
      id: `manual-${manual.id}`,
      userId: manual.userId,
      amount,
      label: `Manual ${manual.platform} credit`,
      detail: manual.notes?.trim() || `${amount} credit${amount === 1 ? '' : 's'}`,
      occurredAt: manual.date,
      status: 'credited',
    });
  }

  return records;
};

const loadProgressForProfiles = async (
  profiles: ProfileWithUser[],
  period: VolunteerMilestonePeriod,
  now: Date,
): Promise<VolunteerMilestoneProgress[]> => {
  if (profiles.length === 0) {
    return [];
  }
  const userIds = profiles.map((profile) => profile.userId);

  const [reviewsByUser, assignments, taskLogs, feedbackRows] = await Promise.all([
    loadVolunteerReviewCredits(userIds, period),
    ShiftAssignment.findAll({
      where: { userId: { [Op.in]: userIds } },
      attributes: ['id', 'userId', 'shiftInstanceId', 'roleInShift'],
      include: [
        {
          model: ShiftInstance,
          as: 'shiftInstance',
          required: true,
          attributes: ['id', 'date', 'timeStart', 'timeEnd'],
          where: { date: { [Op.between]: [period.startDate, period.endDate] } },
          include: [
            {
              model: ScheduleWeek,
              as: 'scheduleWeek',
              attributes: ['id', 'state'],
              required: true,
              where: { state: 'published' },
            },
            { model: ShiftType, as: 'shiftType', attributes: ['id', 'key', 'name'], required: false },
            { model: ShiftTemplate, as: 'template', attributes: ['id', 'name'], required: false },
          ],
        },
        {
          model: VolunteerShiftAttendance,
          as: 'volunteerAttendance',
          required: false,
          attributes: ['id', 'status', 'notes', 'recordedAt', 'recordedBy', 'subjectUserId', 'evidenceTaskLogId', 'evidenceShiftInstanceId', 'evidenceShiftTypeId'],
          include: [{ model: User, as: 'recordedByUser', attributes: ['id', 'firstName', 'lastName', 'email'] },
            { model: AssistantManagerTaskLog, as: 'evidenceTaskLog', required: false, attributes: ['id', 'taskDate'] }],
        },
      ],
      order: [[{ model: ShiftInstance, as: 'shiftInstance' }, 'date', 'ASC']],
    }) as Promise<AssignmentWithRelations[]>,
    AssistantManagerTaskLog.findAll({
      where: {
        userId: { [Op.in]: userIds },
        taskDate: { [Op.between]: [period.startDate, period.endDate] },
        status: 'completed',
      },
      attributes: ['id', 'userId', 'taskDate', 'completedAt', 'notes', 'meta'],
      include: [{
        model: AssistantManagerTaskTemplate,
        as: 'template',
        required: true,
        attributes: ['id', 'name', 'category', 'subgroup', 'scheduleConfig'],
      }],
      order: [['taskDate', 'ASC'], ['id', 'ASC']],
    }) as Promise<TaskLogWithTemplate[]>,
    VolunteerMilestoneFeedback.findAll({
      where: { volunteerUserId: { [Op.in]: userIds }, periodStart: period.startDate },
      include: [
        { model: User, as: 'approvedByUser', attributes: ['id', 'firstName', 'lastName', 'email'] },
        { model: User, as: 'updatedByUser', attributes: ['id', 'firstName', 'lastName', 'email'] },
      ],
    }) as Promise<FeedbackWithUser[]>,
  ]);

  const assignmentsByUser = new Map<number, AssignmentWithRelations[]>();
  for (const assignment of assignments) {
    const rows = assignmentsByUser.get(assignment.userId) ?? [];
    rows.push(assignment);
    assignmentsByUser.set(assignment.userId, rows);
  }

  const taskLogsByUser = new Map<number, TaskLogWithTemplate[]>();
  for (const log of taskLogs) {
    if (!isCleaningTaskTemplate(log.template, log.meta)) {
      continue;
    }
    const rows = taskLogsByUser.get(log.userId) ?? [];
    rows.push(log);
    taskLogsByUser.set(log.userId, rows);
  }

  const feedbackByUser = new Map(feedbackRows.map((feedback) => [feedback.volunteerUserId, feedback]));

  return profiles.map((profile) => {
    const user = profile.user as User;
    const reviews = reviewsByUser.get(profile.userId) ?? [];
    const rawAssignments = assignmentsByUser.get(profile.userId) ?? [];
    const attendanceAssignments = deduplicateVolunteerAttendanceAssignments(
      rawAssignments
        .map((assignment) => attendanceAssignmentPayload(assignment, now))
        .filter((assignment): assignment is VolunteerAttendanceAssignment => Boolean(assignment)),
    );
    const pastAssignments = attendanceAssignments.filter((assignment) => assignment.isPast);
    const cleaningLogs = taskLogsByUser.get(profile.userId) ?? [];
    const managementFeedback = feedbackByUser.get(profile.userId) ?? null;

    const attended = pastAssignments.filter((assignment) => assignment.status === 'attended');
    const late = pastAssignments.filter((assignment) => assignment.status === 'late');
    const absent = pastAssignments.filter((assignment) => assignment.status === 'absent');
    const excused = pastAssignments.filter((assignment) => assignment.status === 'excused');
    const pending = pastAssignments.filter((assignment) => assignment.status == null);
    const reviewCredits = Math.round(
      reviews.reduce((total, entry) => total + Math.max(0, entry.amount), 0) * 10_000,
    ) / 10_000;

    const cleaningShiftInstanceIds = new Set(
      rawAssignments
        .filter((assignment) => {
          const shiftType = assignment.shiftInstance?.shiftType;
          const searchable = [
            shiftType?.key,
            shiftType?.name,
            assignment.shiftInstance?.template?.name,
          ].filter((value): value is string => typeof value === 'string').join(' ').toLowerCase();
          return /\bclean(?:ing)?\b/u.test(searchable);
        })
        .map((assignment) => assignment.shiftInstanceId),
    );
    const completedCleaningShifts = pastAssignments.filter((assignment) =>
      cleaningShiftInstanceIds.has(assignment.shiftInstanceId)
      && (assignment.status === 'attended' || assignment.status === 'late'));

    const shiftEvidence = (rows: VolunteerAttendanceAssignment[]): VolunteerMilestoneEvidence[] => rows.map((assignment) => ({
      id: assignment.assignmentId,
      label: assignment.shiftName,
      detail: [
        `${assignment.startTime}${assignment.endTime ? `–${assignment.endTime}` : ''}`,
        assignment.role,
        assignment.notes,
      ].filter(Boolean).join(' · '),
      occurredAt: assignment.date,
      status: assignment.status ?? 'pending',
    }));

    const cleaningLogEvidence: VolunteerMilestoneEvidence[] = cleaningLogs.map((log) => ({
      id: log.id,
      label: log.template?.name ?? 'Cleaning task',
      detail: log.notes ?? undefined,
      occurredAt: log.completedAt?.toISOString() ?? log.taskDate,
      status: 'completed',
    }));
    const cleaningShiftEvidence: VolunteerMilestoneEvidence[] = completedCleaningShifts.map((assignment) => ({
      id: assignment.assignmentId,
      label: assignment.shiftName,
      detail: `Manager-confirmed cleaning shift${assignment.notes ? ` · ${assignment.notes}` : ''}`,
      occurredAt: assignment.date,
      status: assignment.status ?? 'attended',
    }));
    // Deployments differ in how house-care work is captured. Prefer the source
    // with more verified completions without summing both and double-counting
    // the same work when cleaning tasks also generated cleaning shifts.
    const cleaningEvidence = selectVolunteerCleaningEvidence(cleaningLogEvidence, cleaningShiftEvidence);

    const milestones = calculateVolunteerMilestones({
      reviewCredits,
      scheduledPastShifts: pastAssignments.length,
      pendingAttendance: pending.length,
      attendedShifts: attended.length,
      lateShifts: late.length,
      absentShifts: absent.length,
      excusedShifts: excused.length,
      completedCleaningTasks: cleaningEvidence.length,
      managementApproved: Boolean(managementFeedback?.approved),
      evidence: {
        reviews: reviews.map(({ id, label, detail, occurredAt, status }) => ({
          id,
          label,
          detail,
          occurredAt,
          status,
        })),
        attendance: shiftEvidence(pastAssignments),
        monthly_shifts: shiftEvidence([...attended, ...late]),
        cleaning: cleaningEvidence,
        management_feedback: managementFeedback ? [{
          id: managementFeedback.id,
          label: managementFeedback.approved ? 'Management approved' : 'Feedback draft',
          detail: managementFeedback.feedback ?? undefined,
          occurredAt: (managementFeedback.approvedAt ?? managementFeedback.updatedAt)?.toISOString(),
          status: managementFeedback.approved ? 'approved' : 'draft',
        }] : [],
      },
    });

    return {
      period,
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        profilePhotoUrl: user.profilePhotoUrl ?? null,
      },
      starsEarned: milestones.filter((milestone) => milestone.earned).length,
      totalStars: 5,
      milestones,
      attendanceAssignments,
      managementFeedback: feedbackPayload(managementFeedback),
    };
  });
};

export const getVolunteerMilestoneProgress = async (
  userId: number,
  month?: string | null,
  options: { selfAccess?: boolean; now?: Date } = {},
): Promise<VolunteerMilestoneProgress> => {
  const now = options.now ?? new Date();
  const period = parseVolunteerMilestonePeriod(month, now);
  const profile = await findVolunteer(userId, {
    selfAccess: options.selfAccess,
    activeOnly: options.selfAccess,
  });
  const [progress] = await loadProgressForProfiles([profile], period, now);
  return progress;
};

export const listActiveVolunteerMilestoneProgress = async (
  month?: string | null,
  options: { now?: Date } = {},
): Promise<{
  period: VolunteerMilestonePeriod;
  volunteers: Array<{
    userId: number;
    firstName: string;
    lastName: string;
    email: string;
    profilePhotoUrl: string | null;
    active: true;
    starsEarned: number;
    totalStars: 5;
    milestones: VolunteerMilestone[];
  }>;
}> => {
  const now = options.now ?? new Date();
  const period = parseVolunteerMilestonePeriod(month, now);
  const profiles = await StaffProfile.findAll({
    where: { staffType: 'volunteer', active: true },
    include: [{
            model: User,
      as: 'user',
      required: true,
      where: { status: true },
      attributes: ['id', 'firstName', 'lastName', 'email', 'profilePhotoUrl', 'status'],
    }],
  }) as ProfileWithUser[];
  const orderedProfiles = [...profiles].sort((left, right) => {
    const leftName = `${left.user?.firstName ?? ''} ${left.user?.lastName ?? ''}`.trim();
    const rightName = `${right.user?.firstName ?? ''} ${right.user?.lastName ?? ''}`.trim();
    return leftName.localeCompare(rightName);
  });
  const progressRows = await loadProgressForProfiles(orderedProfiles, period, now);

  return {
    period,
    volunteers: progressRows.map((progress) => ({
      userId: progress.user.id,
      firstName: progress.user.firstName,
      lastName: progress.user.lastName,
      email: progress.user.email,
      profilePhotoUrl: progress.user.profilePhotoUrl,
      active: true,
      starsEarned: progress.starsEarned,
      totalStars: progress.totalStars,
      milestones: progress.milestones.map((milestone) => ({ ...milestone, evidence: [] })),
    })),
  };
};

export const recordVolunteerAttendance = async (params: {
  shiftAssignmentId: number;
  status: VolunteerAttendanceStatus;
  notes: string | null;
  actorId: number;
}): Promise<{ attendance: VolunteerShiftAttendance; volunteerUserId: number }> => {
  const assignment = await ShiftAssignment.findByPk(params.shiftAssignmentId, {
    include: [{
      model: ShiftInstance,
      as: 'shiftInstance',
      required: true,
      include: [{ model: ScheduleWeek, as: 'scheduleWeek', required: false, attributes: ['id', 'state'] }],
    }],
  }) as AssignmentWithRelations | null;
  if (!assignment || !assignment.shiftInstance) {
    throw new HttpError(404, 'Shift assignment not found.');
  }
  await findVolunteer(assignment.userId);
  if (assignment.shiftInstance.scheduleWeek?.state !== 'published') {
    throw new HttpError(409, 'Attendance can be recorded only for a published schedule.');
  }
  if (!isPastShift(assignment.shiftInstance)) {
    throw new HttpError(409, 'Attendance can be confirmed only after the shift has ended.');
  }

  return VolunteerShiftAttendance.sequelize!.transaction(async (transaction) => {
  const lockedAssignment = await ShiftAssignment.findByPk(assignment.id, { transaction, lock: transaction.LOCK.UPDATE });
  if (!lockedAssignment || lockedAssignment.userId !== assignment.userId || lockedAssignment.shiftInstanceId !== assignment.shiftInstanceId) {
    throw new HttpError(409, 'The scheduled assignment changed. Refresh before recording attendance.');
  }
  const lockedShift = await ShiftInstance.findByPk(lockedAssignment.shiftInstanceId, { transaction, lock: transaction.LOCK.UPDATE });
  const lockedWeek = lockedShift ? await ScheduleWeek.findByPk(lockedShift.scheduleWeekId, { attributes: ['id', 'state'], transaction, lock: transaction.LOCK.UPDATE }) : null;
  if (!lockedShift || lockedWeek?.state !== 'published' || !isPastShift(lockedShift)) {
    throw new HttpError(409, 'Attendance can be recorded only after the currently published shift has ended.');
  }
  const sameDayTasks = await AssistantManagerTaskLog.findAll({
    where: { taskDate: lockedShift.date }, attributes: ['id', 'templateId'],
    include: [{ model: AssistantManagerTaskTemplate, as: 'template', required: true, attributes: ['id', 'scheduleConfig'] }],
    transaction,
  }) as TaskLogWithTemplate[];
  const photoManaged = sameDayTasks.some((task) => {
    const configured = task.template?.scheduleConfig?.volunteerAttendance;
    if (!configured || typeof configured !== 'object' || Array.isArray(configured)) return false;
    const ids = (configured as Record<string, unknown>).shiftTypeIds;
    return Array.isArray(ids) && ids.includes(lockedShift.shiftTypeId);
  });
  if (photoManaged) {
    throw new HttpError(409, 'This scheduled shift has a photo-based attendance task. Record attendance through that task’s photo check in Task Planner.');
  }
  const [attendance, created] = await VolunteerShiftAttendance.findOrCreate({
    where: { shiftAssignmentId: assignment.id },
    defaults: {
      shiftAssignmentId: assignment.id,
      subjectUserId: assignment.userId,
      status: params.status,
      notes: params.notes,
      recordedBy: params.actorId,
      recordedAt: new Date(),
      revision: 1,
    },
    transaction,
  });
  if (!created) {
    if (attendance.evidenceTaskLogId != null) {
      throw new HttpError(409, 'This attendance is linked to a task photo. Make corrections through the attendance check in Task Planner.');
    }
    await attendance.update({
      status: params.status,
      notes: params.notes,
      recordedBy: params.actorId,
      recordedAt: new Date(),
      revision: (attendance.revision ?? 1) + 1,
      subjectUserId: assignment.userId,
    }, { transaction });
  }
  return { attendance, volunteerUserId: assignment.userId };
  });
};

export const saveVolunteerManagementFeedback = async (params: {
  volunteerUserId: number;
  month?: string | null;
  feedback: string | null;
  approved: boolean;
  actorId: number;
  now?: Date;
}): Promise<VolunteerMilestoneFeedback> => {
  const now = params.now ?? new Date();
  const period = parseVolunteerMilestonePeriod(params.month, now);
  const currentPeriod = parseVolunteerMilestonePeriod(null, now);
  if (period.startDate > currentPeriod.startDate) {
    throw new HttpError(400, 'Management feedback cannot be recorded for a future month.');
  }
  await findVolunteer(params.volunteerUserId);
  const feedbackText = params.feedback?.trim() || null;

  if (params.approved && !feedbackText) {
    throw new HttpError(400, 'Feedback is required before the final star can be approved.');
  }
  if (params.approved) {
    const progress = await getVolunteerMilestoneProgress(params.volunteerUserId, period.month, { now });
    const incomplete = progress.milestones
      .filter((milestone) => milestone.key !== 'management_feedback' && !milestone.earned)
      .map((milestone) => milestone.key);
    if (incomplete.length > 0) {
      throw new HttpError(
        409,
        'The first four milestones must be earned before management can approve the final star.',
        { incompleteMilestones: incomplete },
      );
    }
  }

  const [record, created] = await VolunteerMilestoneFeedback.findOrCreate({
    where: { volunteerUserId: params.volunteerUserId, periodStart: period.startDate },
    defaults: {
      volunteerUserId: params.volunteerUserId,
      periodStart: period.startDate,
      feedback: null,
      approved: false,
      approvedBy: null,
      approvedAt: null,
      createdBy: params.actorId,
      updatedBy: params.actorId,
    },
  });
  const newlyApproved = params.approved && !record.approved;
  await record.update({
    feedback: feedbackText,
    approved: params.approved,
    approvedBy: params.approved ? (newlyApproved || created ? params.actorId : record.approvedBy) : null,
    approvedAt: params.approved ? (newlyApproved || created ? now : record.approvedAt) : null,
    updatedBy: params.actorId,
  });
  return record;
};
