import { Op } from 'sequelize';
import type { Request, Response } from 'express';
import dayjs from 'dayjs';
import ReviewCounter from '../models/ReviewCounter.js';
import ReviewCounterEntry, { type ReviewCounterEntryCategory } from '../models/ReviewCounterEntry.js';
import ReviewCounterMonthlyApproval from '../models/ReviewCounterMonthlyApproval.js';
import CompensationComponentAssignment, { type CompensationTargetScope } from '../models/CompensationComponentAssignment.js';
import CompensationComponent from '../models/CompensationComponent.js';
import StaffProfile from '../models/StaffProfile.js';
import User from '../models/User.js';
import UserShiftRole from '../models/UserShiftRole.js';
import { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';

const REVIEW_COUNTER_COLUMNS = [
  { header: 'ID', accessorKey: 'id', type: 'number' },
  { header: 'Platform', accessorKey: 'platform', type: 'text' },
  { header: 'Period Start', accessorKey: 'periodStart', type: 'date' },
  { header: 'Period End', accessorKey: 'periodEnd', type: 'date' },
  { header: 'Total Reviews', accessorKey: 'totalReviews', type: 'number' },
  { header: 'First Review', accessorKey: 'firstReviewAuthor', type: 'text' },
  { header: 'Second Review', accessorKey: 'secondReviewAuthor', type: 'text' },
  { header: 'Before Last Review', accessorKey: 'beforeLastReviewAuthor', type: 'text' },
  { header: 'Last Review', accessorKey: 'lastReviewAuthor', type: 'text' },
  { header: 'Bad Reviews', accessorKey: 'badReviewCount', type: 'number' },
  { header: 'No Name Reviews', accessorKey: 'noNameReviewCount', type: 'number' },
  { header: 'Notes', accessorKey: 'notes', type: 'text' },
];

const FLOAT_TOLERANCE = 1e-9;
const MINIMUM_REVIEWS_FOR_PAYMENT = 15;
const UNDER_MINIMUM_APPROVER_ROLES = new Set(['admin', 'owner', 'manager']);
const DEFAULT_ANALYTICS_WINDOW_DAYS = 90;
const ANALYTICS_GROUP_VALUES = new Set(['day', 'week', 'month']);

type AnalyticsGroupBy = 'day' | 'week' | 'month';

type TimelineBucket = {
  key: string;
  label: string;
  startDate: string;
  totalReviews: number;
  badReviews: number;
  noNameReviews: number;
};

type PlatformAggregate = {
  platform: string;
  totalReviews: number;
  badReviews: number;
  noNameReviews: number;
  counters: number;
};

type ContributorAggregate = {
  userId: number | null;
  displayName: string;
  rawCount: number;
  roundedCount: number;
  counters: number;
};

type StaffPlatformSummary = {
  counterId: number;
  platform: string;
  rawCount: number;
  roundedCount: number;
};

type MonthlyApprovalStatus = {
  approved: boolean;
  approvedAt: string | null;
  approvedByName: string | null;
};

type ReviewRequirementConfig = {
  minReviews: number;
};

type StaffReviewComponentSummary = {
  componentId: number;
  name: string;
  scope: CompensationTargetScope;
};

type StaffMonthlySummary = {
  userId: number;
  displayName: string;
  totalReviews: number;
  totalRoundedReviews: number;
  needsMinimum: boolean;
  eligibleForIncentive: boolean;
  canApproveIncentive: boolean;
  paymentApproval: MonthlyApprovalStatus;
  incentiveApproval: MonthlyApprovalStatus;
  baseOverrideApproval: MonthlyApprovalStatus;
  platforms: StaffPlatformSummary[];
  reviewComponents: StaffReviewComponentSummary[];
};

type StaffSummaryPayload = {
  periodStart: string;
  periodEnd: string;
  minimumReviews: number;
  staff: StaffMonthlySummary[];
};

const normalizeRoleSlug = (value?: string | null): string | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }
  const withHyphens = trimmed.replace(/[\s_]+/g, '-');
  const collapsed = withHyphens.replace(/-/g, '');
  if (collapsed === 'administrator') {
    return 'admin';
  }
  if (collapsed === 'assistantmanager' || collapsed === 'assistmanager') {
    return 'assistant-manager';
  }
  if (collapsed === 'mgr' || collapsed === 'manager') {
    return 'manager';
  }
  return withHyphens;
};

const parseGroupByParam = (raw: unknown): AnalyticsGroupBy => {
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    if (ANALYTICS_GROUP_VALUES.has(normalized)) {
      return normalized as AnalyticsGroupBy;
    }
  }
  return 'month';
};

const buildTimelineKey = (dateValue: string | Date, groupBy: AnalyticsGroupBy) => {
  const date = dayjs(dateValue);
  const start = groupBy === 'day' ? date.startOf('day') : groupBy === 'week' ? date.startOf('week') : date.startOf('month');
  const label =
    groupBy === 'day'
      ? start.format('MMM D')
      : groupBy === 'week'
      ? `${start.format('MMM D')} - ${start.endOf('week').format('MMM D')}`
      : start.format('MMM YYYY');
  const key =
    groupBy === 'day'
      ? start.format('YYYY-MM-DD')
      : groupBy === 'week'
      ? `week-${start.format('YYYY-MM-DD')}`
      : start.format('YYYY-MM');
  return { key, label, startDate: start.format('YYYY-MM-DD') };
};

const summarizeEntriesTotals = (entries?: ReviewCounterEntry[]) =>
  (entries ?? []).reduce(
    (acc, entry) => {
      const amount = toNumber(entry.rawCount);
      acc.total += amount;
      if (entry.category === 'bad') {
        acc.bad += amount;
      } else if (entry.category === 'no_name') {
        acc.noName += amount;
      }
      return acc;
    },
    { total: 0, bad: 0, noName: 0 },
  );

const canApproveUnderMinimum = (role?: string | null): boolean => {
  const normalized = normalizeRoleSlug(role);
  if (!normalized) {
    return false;
  }
  return UNDER_MINIMUM_APPROVER_ROLES.has(normalized);
};

const resolveApprovalFlag = (source: Record<string, unknown>): boolean | null => {
  if (typeof source.underMinimumApproved === 'boolean') {
    return source.underMinimumApproved;
  }
  if (typeof (source as Record<string, unknown>).under_minimum_approved === 'boolean') {
    return (source as { under_minimum_approved: boolean }).under_minimum_approved;
  }
  return null;
};

const toNumber = (value: unknown): number => {
  if (value == null) {
    return 0;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const readMinReviewsFromConfig = (config: unknown): ReviewRequirementConfig | null => {
  if (!config || typeof config !== 'object') {
    return null;
  }
  const record = config as Record<string, unknown>;
  const candidate =
    typeof record.requiresReviewTarget === 'object'
      ? (record.requiresReviewTarget as Record<string, unknown>)
      : typeof record.requires_review_target === 'object'
      ? (record.requires_review_target as Record<string, unknown>)
      : record;
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }
  const rawValue =
    candidate.minReviews ??
    candidate.min_reviews ??
    candidate.minimumReviews ??
    candidate.minimum_reviews ??
    null;
  if (rawValue == null) {
    return null;
  }
  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return { minReviews: Math.max(1, Math.floor(numeric)) };
};

const roundReviewCredit = (rawValue: number): number => {
  const raw = Math.max(0, rawValue);
  const base = Math.trunc(raw);
  const fraction = raw - base;
  if (fraction <= 0.5 + FLOAT_TOLERANCE) {
    return base;
  }
  return base + 1;
};

const getActorId = (req: AuthenticatedRequest): number | null => req.authContext?.id ?? null;

const normalizeDate = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  const parsed = dayjs(value);
  if (!parsed.isValid()) {
    return null;
  }
  return parsed.format('YYYY-MM-DD');
};

const parsePeriodInput = (value: unknown): dayjs.Dayjs | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const raw = value.trim();
  if (!raw) {
    return null;
  }
  const monthCandidate = dayjs(raw, 'YYYY-MM', true);
  if (monthCandidate.isValid()) {
    return monthCandidate.startOf('month');
  }
  const dateCandidate = dayjs(raw);
  return dateCandidate.isValid() ? dateCandidate.startOf('month') : null;
};

const formatUserDisplayName = (user?: Pick<User, 'firstName' | 'lastName'> | null, fallback?: string | null) => {
  const composed = `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim();
  if (composed.length > 0) {
    return composed;
  }
  if (fallback && fallback.trim().length > 0) {
    return fallback.trim();
  }
  return 'Unknown';
};

const sanitizeReviewCounterPayload = (payload: Record<string, unknown>) => {
  const next: Record<string, unknown> = {};

  if (typeof payload.platform === 'string' && payload.platform.trim().length > 0) {
    next.platform = payload.platform.trim();
  }

  const periodStart = normalizeDate(payload.periodStart ?? payload.period_start);
  if (periodStart) {
    next.periodStart = periodStart;
  }

  const periodEnd = normalizeDate(payload.periodEnd ?? payload.period_end);
  if (periodEnd) {
    next.periodEnd = periodEnd;
  } else if (payload.periodEnd === null || payload.period_end === null) {
    next.periodEnd = null;
  }

  if (payload.totalReviews != null) {
    next.totalReviews = Math.max(0, Math.trunc(toNumber(payload.totalReviews)));
  }

  const copyString = (key: string) => {
    const raw = payload[key as keyof typeof payload];
    if (typeof raw === 'string') {
      next[key] = raw.trim();
    } else if (raw === null) {
      next[key] = null;
    }
  };

  copyString('firstReviewAuthor');
  copyString('secondReviewAuthor');
  copyString('beforeLastReviewAuthor');
  copyString('lastReviewAuthor');
  copyString('notes');

  if (payload.badReviewCount != null) {
    next.badReviewCount = Math.max(0, Math.trunc(toNumber(payload.badReviewCount)));
  }
  if (payload.noNameReviewCount != null) {
    next.noNameReviewCount = Math.max(0, Math.trunc(toNumber(payload.noNameReviewCount)));
  }

  if (payload.meta && typeof payload.meta === 'object') {
    next.meta = payload.meta;
  }

  return next;
};

const sanitizeEntryPayload = async (payload: Record<string, unknown>) => {
  const entry: Record<string, unknown> = {};

  if (payload.userId != null) {
    const userId = Number(payload.userId);
    if (!Number.isFinite(userId) || userId <= 0) {
      throw new Error('userId must be a positive number when provided');
    }
    const user = await User.findByPk(userId, { attributes: ['id', 'firstName', 'lastName'] });
    if (!user) {
      throw new Error('User not found');
    }
    entry.userId = userId;
    if (!payload.displayName || typeof payload.displayName !== 'string') {
      const fallbackName = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
      if (!fallbackName) {
        throw new Error('displayName is required when staff record has no name');
      }
      entry.displayName = fallbackName;
    }
  }

  if (typeof payload.displayName === 'string' && payload.displayName.trim().length > 0) {
    entry.displayName = payload.displayName.trim();
  }

  if (!entry.displayName) {
    throw new Error('displayName is required');
  }

  if (typeof payload.category === 'string') {
    const normalized = payload.category.trim().toLowerCase();
    if (['staff', 'bad', 'no_name', 'other'].includes(normalized)) {
      entry.category = normalized;
    } else {
      throw new Error('Invalid category');
    }
  }

  const rawCountSource = payload.rawCount ?? payload.raw_count;
  const rawCount = toNumber(rawCountSource);
  entry.rawCount = rawCount;
  entry.roundedCount = roundReviewCredit(rawCount);

  if (payload.notes === null) {
    entry.notes = null;
  } else if (typeof payload.notes === 'string') {
    entry.notes = payload.notes.trim();
  }

  if (payload.meta && typeof payload.meta === 'object') {
    entry.meta = payload.meta;
  }

  if (!entry.category) {
    entry.category = 'staff';
  }

  return entry;
};

const formatEntryRecord = (entry: ReviewCounterEntry & { user?: User | null; underMinimumApprovedByUser?: User | null }) => ({
  id: entry.id,
  counterId: entry.counterId,
  userId: entry.userId,
  displayName: entry.displayName,
  category: entry.category,
  rawCount: toNumber(entry.rawCount),
  roundedCount: entry.roundedCount,
  notes: entry.notes ?? null,
  meta: entry.meta ?? {},
  userName: entry.user ? `${entry.user.firstName ?? ''} ${entry.user.lastName ?? ''}`.trim() || null : null,
  underMinimumApproved: entry.underMinimumApproved ?? false,
  underMinimumApprovedBy: entry.underMinimumApprovedBy ?? null,
  underMinimumApprovedByName: entry.underMinimumApprovedByUser
    ? `${entry.underMinimumApprovedByUser.firstName ?? ''} ${entry.underMinimumApprovedByUser.lastName ?? ''}`.trim() || null
    : null,
});

const formatCounterRecord = (counter: ReviewCounter & { entries?: ReviewCounterEntry[]; createdByUser?: User | null; updatedByUser?: User | null }) => ({
  id: counter.id,
  platform: counter.platform,
  periodStart: counter.periodStart,
  periodEnd: counter.periodEnd,
  totalReviews: counter.totalReviews,
  firstReviewAuthor: counter.firstReviewAuthor,
  secondReviewAuthor: counter.secondReviewAuthor,
  beforeLastReviewAuthor: counter.beforeLastReviewAuthor,
  lastReviewAuthor: counter.lastReviewAuthor,
  badReviewCount: counter.badReviewCount,
  noNameReviewCount: counter.noNameReviewCount,
  notes: counter.notes ?? null,
  meta: counter.meta ?? {},
  entries: (counter.entries ?? []).map((entry) => formatEntryRecord(entry as ReviewCounterEntry & { user?: User | null })),
  createdByName: counter.createdByUser ? `${counter.createdByUser.firstName ?? ''} ${counter.createdByUser.lastName ?? ''}`.trim() || null : null,
  updatedByName: counter.updatedByUser ? `${counter.updatedByUser.firstName ?? ''} ${counter.updatedByUser.lastName ?? ''}`.trim() || null : null,
  createdAt: counter.createdAt?.toISOString() ?? null,
  updatedAt: counter.updatedAt?.toISOString() ?? null,
});

export const listReviewCounters = async (req: Request, res: Response): Promise<void> => {
  try {
    const where: Record<string, unknown> = {};
    if (typeof req.query.platform === 'string' && req.query.platform.trim().length > 0) {
      where.platform = req.query.platform.trim();
    }
    const start = normalizeDate(req.query.periodStart);
    const end = normalizeDate(req.query.periodEnd);
    if (start && end) {
      where.periodStart = { [Op.between]: [start, end] };
    } else if (start) {
      where.periodStart = { [Op.gte]: start };
    } else if (end) {
      where.periodStart = { [Op.lte]: end };
    }

    const counters = await ReviewCounter.findAll({
      where,
      include: [
        {
          model: ReviewCounterEntry,
          as: 'entries',
          include: [
            { model: User, as: 'user', attributes: ['id', 'firstName', 'lastName'] },
            { model: User, as: 'underMinimumApprovedByUser', attributes: ['id', 'firstName', 'lastName'] },
          ],
        },
        { model: User, as: 'createdByUser', attributes: ['id', 'firstName', 'lastName'] },
        { model: User, as: 'updatedByUser', attributes: ['id', 'firstName', 'lastName'] },
      ],
      order: [
        ['platform', 'ASC'],
        ['periodStart', 'DESC'],
        ['id', 'DESC'],
      ],
    });

    const payload = counters.map((counter) => formatCounterRecord(counter as ReviewCounter & { entries?: ReviewCounterEntry[]; createdByUser?: User | null; updatedByUser?: User | null }));

    res.status(200).json([{ data: payload, columns: REVIEW_COUNTER_COLUMNS }]);
  } catch (error) {
    console.error('Failed to list review counters', error);
    res.status(500).json([{ message: 'Failed to list review counters' }]);
  }
};

export const createReviewCounter = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const actorId = getActorId(req);
    const payload = sanitizeReviewCounterPayload(req.body ?? {});
    if (!payload.platform || !payload.periodStart) {
      res.status(400).json([{ message: 'platform and periodStart are required' }]);
      return;
    }

    const record = await ReviewCounter.create({
      ...payload,
      createdBy: actorId,
      updatedBy: actorId,
    });

    await createDefaultEntriesForCounter(record.id, actorId ?? null);

    const withRelations = await ReviewCounter.findByPk(record.id, {
      include: [
        {
          model: ReviewCounterEntry,
          as: 'entries',
          include: [
            { model: User, as: 'user', attributes: ['id', 'firstName', 'lastName'] },
            { model: User, as: 'underMinimumApprovedByUser', attributes: ['id', 'firstName', 'lastName'] },
          ],
        },
        { model: User, as: 'createdByUser', attributes: ['id', 'firstName', 'lastName'] },
        { model: User, as: 'updatedByUser', attributes: ['id', 'firstName', 'lastName'] },
      ],
    });

    res.status(201).json([{ data: withRelations ? [formatCounterRecord(withRelations as ReviewCounter & { entries?: ReviewCounterEntry[]; createdByUser?: User | null; updatedByUser?: User | null })] : [] }]);
  } catch (error) {
    console.error('Failed to create review counter', error);
    res.status(500).json([{ message: (error as Error).message }]);
  }
};

export const updateReviewCounter = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json([{ message: 'Invalid counter id' }]);
      return;
    }
    const actorId = getActorId(req);
    const payload = sanitizeReviewCounterPayload(req.body ?? {});
    payload.updatedBy = actorId;

    const [updated] = await ReviewCounter.update(payload, { where: { id } });
    if (!updated) {
      res.status(404).json([{ message: 'Review counter not found' }]);
      return;
    }

    const refreshed = await ReviewCounter.findByPk(id, {
      include: [
        {
          model: ReviewCounterEntry,
          as: 'entries',
          include: [
            { model: User, as: 'user', attributes: ['id', 'firstName', 'lastName'] },
            { model: User, as: 'underMinimumApprovedByUser', attributes: ['id', 'firstName', 'lastName'] },
          ],
        },
        { model: User, as: 'createdByUser', attributes: ['id', 'firstName', 'lastName'] },
        { model: User, as: 'updatedByUser', attributes: ['id', 'firstName', 'lastName'] },
      ],
    });

    res.status(200).json([{ data: refreshed ? [formatCounterRecord(refreshed as ReviewCounter & { entries?: ReviewCounterEntry[]; createdByUser?: User | null; updatedByUser?: User | null })] : [] }]);
  } catch (error) {
    console.error('Failed to update review counter', error);
    res.status(500).json([{ message: (error as Error).message }]);
  }
};

export const deleteReviewCounter = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json([{ message: 'Invalid counter id' }]);
      return;
    }

    const deleted = await ReviewCounter.destroy({ where: { id } });
    if (!deleted) {
      res.status(404).json([{ message: 'Review counter not found' }]);
      return;
    }

    res.status(204).send();
  } catch (error) {
    console.error('Failed to delete review counter', error);
    res.status(500).json([{ message: 'Failed to delete review counter' }]);
  }
};

export const listReviewCounterEntries = async (req: Request, res: Response): Promise<void> => {
  try {
    const counterId = Number(req.params.id);
    if (!Number.isInteger(counterId) || counterId <= 0) {
      res.status(400).json([{ message: 'Invalid counter id' }]);
      return;
    }

    const entries = await ReviewCounterEntry.findAll({
      where: { counterId },
      include: [
        { model: User, as: 'user', attributes: ['id', 'firstName', 'lastName'] },
        { model: User, as: 'underMinimumApprovedByUser', attributes: ['id', 'firstName', 'lastName'] },
      ],
      order: [
        ['category', 'ASC'],
        ['displayName', 'ASC'],
      ],
    });

    res.status(200).json([{ data: entries.map((entry) => formatEntryRecord(entry as ReviewCounterEntry & { user?: User | null })), columns: [] }]);
  } catch (error) {
    console.error('Failed to list review counter entries', error);
    res.status(500).json([{ message: 'Failed to list entries' }]);
  }
};

export const createReviewCounterEntry = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const counterId = Number(req.params.id);
    if (!Number.isInteger(counterId) || counterId <= 0) {
      res.status(400).json([{ message: 'Invalid counter id' }]);
      return;
    }

    const counter = await ReviewCounter.findByPk(counterId);
    if (!counter) {
      res.status(404).json([{ message: 'Review counter not found' }]);
      return;
    }

    const actorId = getActorId(req);
    const payload = await sanitizeEntryPayload(req.body ?? {});
    payload.counterId = counterId;
    payload.createdBy = actorId;
    payload.updatedBy = actorId;
    const requestedApproval = resolveApprovalFlag(req.body ?? {});
    const nextRawCount = toNumber(payload.rawCount ?? 0);
    let nextApproval = false;
    let approvalBy: number | null = null;

    if (nextRawCount >= MINIMUM_REVIEWS_FOR_PAYMENT) {
      nextApproval = false;
      approvalBy = null;
    } else if (requestedApproval === true) {
      if (!canApproveUnderMinimum(req.authContext?.roleSlug)) {
        res.status(403).json([{ message: 'Only managers, admins, or owners can approve under 15 reviews' }]);
        return;
      }
      if (!actorId) {
        res.status(403).json([{ message: 'Unable to approve under minimum without an authenticated user' }]);
        return;
      }
      nextApproval = true;
      approvalBy = actorId;
    } else if (requestedApproval === false) {
      nextApproval = false;
      approvalBy = null;
    }

    payload.underMinimumApproved = nextApproval;
    payload.underMinimumApprovedBy = approvalBy;

    const created = await ReviewCounterEntry.create(payload);
    const withUser = await ReviewCounterEntry.findByPk(created.id, {
      include: [
        { model: User, as: 'user', attributes: ['id', 'firstName', 'lastName'] },
        { model: User, as: 'underMinimumApprovedByUser', attributes: ['id', 'firstName', 'lastName'] },
      ],
    });

    res.status(201).json([{ data: withUser ? [formatEntryRecord(withUser as ReviewCounterEntry & { user?: User | null })] : [] }]);
  } catch (error) {
    console.error('Failed to create review counter entry', error);
    res.status(500).json([{ message: (error as Error).message }]);
  }
};

export const updateReviewCounterEntry = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const counterId = Number(req.params.id);
    const entryId = Number(req.params.entryId);
    if (!Number.isInteger(counterId) || counterId <= 0 || !Number.isInteger(entryId) || entryId <= 0) {
      res.status(400).json([{ message: 'Invalid ids provided' }]);
      return;
    }

    const existing = await ReviewCounterEntry.findOne({ where: { id: entryId, counterId } });
    if (!existing) {
      res.status(404).json([{ message: 'Entry not found' }]);
      return;
    }

    const actorId = getActorId(req);
    const payload = await sanitizeEntryPayload({ ...existing.get(), ...req.body });
    payload.updatedBy = actorId;
    const requestedApproval = resolveApprovalFlag(req.body ?? {});
    const nextRawCount = toNumber(payload.rawCount ?? existing.rawCount ?? 0);
    let nextApproval = Boolean(existing.underMinimumApproved);
    let approvalBy: number | null = existing.underMinimumApprovedBy ?? null;

    if (nextRawCount >= MINIMUM_REVIEWS_FOR_PAYMENT) {
      nextApproval = false;
      approvalBy = null;
    } else if (requestedApproval === true) {
      if (!canApproveUnderMinimum(req.authContext?.roleSlug)) {
        res.status(403).json([{ message: 'Only managers, admins, or owners can approve under 15 reviews' }]);
        return;
      }
      if (!actorId) {
        res.status(403).json([{ message: 'Unable to approve under minimum without an authenticated user' }]);
        return;
      }
      nextApproval = true;
      approvalBy = actorId;
    } else if (requestedApproval === false) {
      nextApproval = false;
      approvalBy = null;
    }

    payload.underMinimumApproved = nextApproval;
    payload.underMinimumApprovedBy = approvalBy;

    await ReviewCounterEntry.update(payload, { where: { id: entryId, counterId } });

    const refreshed = await ReviewCounterEntry.findByPk(entryId, {
      include: [
        { model: User, as: 'user', attributes: ['id', 'firstName', 'lastName'] },
        { model: User, as: 'underMinimumApprovedByUser', attributes: ['id', 'firstName', 'lastName'] },
      ],
    });

    res.status(200).json([{ data: refreshed ? [formatEntryRecord(refreshed as ReviewCounterEntry & { user?: User | null })] : [] }]);
  } catch (error) {
    console.error('Failed to update review counter entry', error);
    res.status(500).json([{ message: (error as Error).message }]);
  }
};

export const deleteReviewCounterEntry = async (req: Request, res: Response): Promise<void> => {
  try {
    const counterId = Number(req.params.id);
    const entryId = Number(req.params.entryId);
    if (!Number.isInteger(counterId) || counterId <= 0 || !Number.isInteger(entryId) || entryId <= 0) {
      res.status(400).json([{ message: 'Invalid ids provided' }]);
      return;
    }

    const deleted = await ReviewCounterEntry.destroy({ where: { id: entryId, counterId } });
    if (!deleted) {
      res.status(404).json([{ message: 'Entry not found' }]);
      return;
    }

    res.status(204).send();
  } catch (error) {
    console.error('Failed to delete review counter entry', error);
    res.status(500).json([{ message: 'Failed to delete entry' }]);
  }
};

export const getReviewCounterAnalytics = async (req: Request, res: Response): Promise<void> => {
  try {
    const { startDate: startParam, endDate: endParam, platform } = req.query;
    const groupBy = parseGroupByParam(req.query.groupBy);
    const platformFilter =
      typeof platform === 'string' && platform.trim().length > 0 ? platform.trim() : null;

    const defaultEnd = dayjs().endOf('day');
    const defaultStart = defaultEnd.subtract(DEFAULT_ANALYTICS_WINDOW_DAYS, 'day').startOf('day');

    const start = typeof startParam === 'string' && startParam ? dayjs(startParam).startOf('day') : defaultStart;
    const end = typeof endParam === 'string' && endParam ? dayjs(endParam).endOf('day') : defaultEnd;

    if (!start.isValid() || !end.isValid() || end.isBefore(start)) {
      res.status(400).json([{ message: 'Provide a valid startDate and endDate range' }]);
      return;
    }

    const whereClause: Record<string, unknown> = {
      periodStart: {
        [Op.between]: [start.format('YYYY-MM-DD'), end.format('YYYY-MM-DD')],
      },
    };
    if (platformFilter) {
      whereClause.platform = platformFilter;
    }

    const counters = await ReviewCounter.findAll({
      where: whereClause,
      include: [{ model: ReviewCounterEntry, as: 'entries' }],
      order: [
        ['periodStart', 'ASC'],
        ['platform', 'ASC'],
      ],
    });

    if (counters.length === 0) {
      res.status(200).json([
        {
          data: [
            {
              range: {
                startDate: start.format('YYYY-MM-DD'),
                endDate: end.format('YYYY-MM-DD'),
                groupBy,
                platform: platformFilter,
              },
              totals: {
                totalReviews: 0,
                badReviews: 0,
                noNameReviews: 0,
                counters: 0,
                platforms: 0,
                contributors: 0,
              },
              platforms: [],
              timeline: [],
              topContributors: [],
            },
          ],
          columns: [],
        },
      ]);
      return;
    }

    const totals = {
      totalReviews: 0,
      badReviews: 0,
      noNameReviews: 0,
      counters: 0,
    };
    const platformTotals = new Map<string, PlatformAggregate>();
    const timelineMap = new Map<string, TimelineBucket>();
    const contributorMap = new Map<string, ContributorAggregate>();
    const platformsSeen = new Set<string>();

    counters.forEach((counter) => {
      totals.counters += 1;
      const counterTotal = toNumber(counter.totalReviews);
      const counterBad = toNumber(counter.badReviewCount);
      const counterNoName = toNumber(counter.noNameReviewCount);

      totals.totalReviews += counterTotal;
      totals.badReviews += counterBad;
      totals.noNameReviews += counterNoName;
      platformsSeen.add(counter.platform);

      const platformKey = counter.platform;
      if (!platformTotals.has(platformKey)) {
        platformTotals.set(platformKey, {
          platform: platformKey,
          totalReviews: 0,
          badReviews: 0,
          noNameReviews: 0,
          counters: 0,
        });
      }
      const platformAggregate = platformTotals.get(platformKey)!;
      platformAggregate.totalReviews += counterTotal;
      platformAggregate.badReviews += counterBad;
      platformAggregate.noNameReviews += counterNoName;
      platformAggregate.counters += 1;

      const { key, label, startDate } = buildTimelineKey(counter.periodStart, groupBy);
      if (!timelineMap.has(key)) {
        timelineMap.set(key, {
          key,
          label,
          startDate,
          totalReviews: 0,
          badReviews: 0,
          noNameReviews: 0,
        });
      }
      const bucket = timelineMap.get(key)!;
      bucket.totalReviews += counterTotal;
      bucket.badReviews += counterBad;
      bucket.noNameReviews += counterNoName;

      (counter.entries ?? []).forEach((entry) => {
        if (entry.category !== 'staff') {
          return;
        }
        const contributorKey =
          entry.userId != null ? `user:${entry.userId}` : `anon:${entry.displayName ?? 'Unknown'}`;
        if (!contributorMap.has(contributorKey)) {
          contributorMap.set(contributorKey, {
            userId: entry.userId ?? null,
            displayName: entry.displayName ?? `User #${entry.userId ?? 'N/A'}`,
            rawCount: 0,
            roundedCount: 0,
            counters: 0,
          });
        }
        const contributor = contributorMap.get(contributorKey)!;
        contributor.rawCount += toNumber(entry.rawCount);
        contributor.roundedCount += toNumber(entry.roundedCount);
        contributor.counters += 1;
      });
    });

    const platforms = Array.from(platformTotals.values()).sort((a, b) => b.totalReviews - a.totalReviews);
    const timeline = Array.from(timelineMap.values()).sort((a, b) => a.startDate.localeCompare(b.startDate));
    const topContributors = Array.from(contributorMap.values())
      .sort((a, b) => b.rawCount - a.rawCount)
      .slice(0, 10);

    res.status(200).json([
      {
        data: [
          {
            range: {
              startDate: start.format('YYYY-MM-DD'),
              endDate: end.format('YYYY-MM-DD'),
              groupBy,
              platform: platformFilter,
            },
            totals: {
              totalReviews: totals.totalReviews,
              badReviews: totals.badReviews,
              noNameReviews: totals.noNameReviews,
              counters: totals.counters,
              platforms: platformsSeen.size,
              contributors: contributorMap.size,
            },
            platforms,
            timeline,
            topContributors,
          },
        ],
        columns: [],
      },
    ]);
  } catch (error) {
    console.error('Failed to build review analytics', error);
    res.status(500).json([{ message: 'Failed to load review analytics' }]);
  }
};

const formatApprovalStatus = (
  record: ReviewCounterMonthlyApproval | undefined,
  mode: 'payment' | 'incentive' | 'base',
): MonthlyApprovalStatus => {
  if (!record) {
    return { approved: false, approvedAt: null, approvedByName: null };
  }
  if (mode === 'payment') {
    return {
      approved: Boolean(record.paymentApproved),
      approvedAt: record.paymentApproved && record.paymentApprovedAt ? dayjs(record.paymentApprovedAt).toISOString() : null,
      approvedByName:
        record.paymentApproved && record.paymentApprovedByUser
          ? formatUserDisplayName(record.paymentApprovedByUser)
          : null,
    };
  }
  if (mode === 'incentive') {
    return {
      approved: Boolean(record.incentiveApproved),
      approvedAt: record.incentiveApproved && record.incentiveApprovedAt ? dayjs(record.incentiveApprovedAt).toISOString() : null,
      approvedByName:
        record.incentiveApproved && record.incentiveApprovedByUser
          ? formatUserDisplayName(record.incentiveApprovedByUser)
          : null,
    };
  }
  return {
    approved: Boolean(record.baseOverrideApproved),
    approvedAt: record.baseOverrideApproved && record.baseOverrideApprovedAt ? dayjs(record.baseOverrideApprovedAt).toISOString() : null,
    approvedByName:
      record.baseOverrideApproved && record.baseOverrideApprovedByUser
        ? formatUserDisplayName(record.baseOverrideApprovedByUser)
        : null,
  };
};

const buildStaffSummaryForPeriod = async (periodStart: dayjs.Dayjs): Promise<StaffSummaryPayload> => {
  const start = periodStart.startOf('month');
  const end = start.endOf('month');
  const startValue = start.format('YYYY-MM-DD');
  const endValue = end.format('YYYY-MM-DD');

  const counters = await ReviewCounter.findAll({
    where: {
      periodStart: {
        [Op.between]: [startValue, endValue],
      },
    },
    include: [
      {
        model: ReviewCounterEntry,
        as: 'entries',
        include: [{ model: User, as: 'user', attributes: ['id', 'firstName', 'lastName', 'userTypeId'] }],
      },
    ],
    order: [
      ['platform', 'ASC'],
      ['periodStart', 'ASC'],
    ],
  });

type StaffBucket = {
  userId: number;
  displayName: string;
  userTypeId: number | null;
  totalReviews: number;
  platforms: StaffPlatformSummary[];
};

  const staffMap = new Map<number, StaffBucket>();

  counters.forEach((counter) => {
    (counter.entries ?? []).forEach((entry) => {
      if (entry.category !== 'staff' || entry.userId == null) {
        return;
      }
      const amount = toNumber(entry.rawCount);
      const roundedAmount = Number.isFinite(Number(entry.roundedCount)) ? Number(entry.roundedCount) : roundReviewCredit(amount);
      const bucket =
        staffMap.get(entry.userId) ??
        (() => {
          const nextBucket: StaffBucket = {
            userId: entry.userId!,
            displayName: formatUserDisplayName(entry.user ?? null, entry.displayName),
            userTypeId: entry.user?.userTypeId ?? null,
            totalReviews: 0,
            platforms: [],
          };
          staffMap.set(entry.userId!, nextBucket);
          return nextBucket;
        })();

      if (bucket.userTypeId == null && entry.user?.userTypeId != null) {
        bucket.userTypeId = entry.user.userTypeId;
      }

      bucket.totalReviews += amount;
      bucket.platforms.push({
        counterId: entry.counterId,
        platform: counter.platform,
        rawCount: amount,
        roundedCount: roundedAmount,
      });
    });
  });

  const userIds = Array.from(staffMap.keys());

  const approvals = userIds.length
    ? await ReviewCounterMonthlyApproval.findAll({
        where: {
          userId: { [Op.in]: userIds },
          periodStart: startValue,
        },
        include: [
          { model: User, as: 'paymentApprovedByUser', attributes: ['id', 'firstName', 'lastName'] },
          { model: User, as: 'incentiveApprovedByUser', attributes: ['id', 'firstName', 'lastName'] },
          { model: User, as: 'baseOverrideApprovedByUser', attributes: ['id', 'firstName', 'lastName'] },
        ],
      })
    : [];

  const approvalMap = new Map<number, ReviewCounterMonthlyApproval>();
  approvals.forEach((approval) => {
    approvalMap.set(approval.userId, approval);
  });

  const userTypeIds = Array.from(
    new Set(
      Array.from(staffMap.values())
        .map((bucket) => bucket.userTypeId)
        .filter((value): value is number => value != null),
    ),
  );

  const userAssignments = userIds.length
    ? await CompensationComponentAssignment.findAll({
        where: {
          targetScope: 'user',
          userId: { [Op.in]: userIds },
          isActive: true,
        },
        include: [
          {
            model: CompensationComponent,
            as: 'component',
            required: true,
            where: {
              isActive: true,
            },
            attributes: ['id', 'name', 'slug', 'config', 'category'],
          },
        ],
      })
    : [];

  const staffProfiles =
    userIds.length === 0
      ? []
      : await StaffProfile.findAll({
          where: {
            userId: { [Op.in]: userIds },
            active: true,
          },
          attributes: ['userId', 'staffType'],
        });

  const staffTypeByUserId = new Map<number, StaffProfile['staffType']>();
  staffProfiles.forEach((profile) => {
    if (profile.staffType) {
      staffTypeByUserId.set(profile.userId, profile.staffType);
    }
  });

  const userTypeAssignments = userTypeIds.length
    ? await CompensationComponentAssignment.findAll({
        where: {
          targetScope: 'user_type',
          userTypeId: { [Op.in]: userTypeIds },
          isActive: true,
        },
        include: [
          {
            model: CompensationComponent,
            as: 'component',
            required: true,
            where: {
              isActive: true,
            },
            attributes: ['id', 'name', 'slug', 'config', 'category'],
          },
        ],
      })
    : [];

  const staffTypes = Array.from(new Set(staffProfiles.map((profile) => profile.staffType).filter((value): value is StaffProfile['staffType'] => Boolean(value))));

  const staffTypeAssignments = staffTypes.length
    ? await CompensationComponentAssignment.findAll({
        where: {
          targetScope: 'staff_type',
          staffType: { [Op.in]: staffTypes },
          isActive: true,
        },
        include: [
          {
            model: CompensationComponent,
            as: 'component',
            required: true,
            where: {
              isActive: true,
            },
            attributes: ['id', 'name', 'slug', 'config', 'category'],
          },
        ],
      })
    : [];

  const userShiftRoles =
    userIds.length === 0
      ? []
      : await UserShiftRole.findAll({
          where: { userId: { [Op.in]: userIds } },
          attributes: ['userId', 'shiftRoleId'],
        });

  const shiftRoleIds = Array.from(
    new Set(
      userShiftRoles
        .map((record) => record.shiftRoleId)
        .filter((value): value is number => value != null),
    ),
  );

  const shiftRoleAssignments = shiftRoleIds.length
    ? await CompensationComponentAssignment.findAll({
        where: {
          targetScope: 'shift_role',
          shiftRoleId: { [Op.in]: shiftRoleIds },
          isActive: true,
        },
        include: [
          {
            model: CompensationComponent,
            as: 'component',
            required: true,
            where: {
              isActive: true,
            },
            attributes: ['id', 'name', 'slug', 'config', 'category'],
          },
        ],
      })
    : [];

  const globalAssignments = await CompensationComponentAssignment.findAll({
    where: {
      targetScope: 'global',
      isActive: true,
    },
    include: [
      {
        model: CompensationComponent,
        as: 'component',
        required: true,
        where: {
          isActive: true,
        },
        attributes: ['id', 'name', 'slug', 'config', 'category'],
      },
    ],
  });

  const buildComponentSummary = (
    assignment: CompensationComponentAssignment,
  ): StaffReviewComponentSummary | null => {
    const componentId = assignment.component?.id ?? assignment.componentId;
    if (!componentId) {
      return null;
    }
    return {
      componentId,
      name: assignment.component?.name ?? `Component #${componentId}`,
      scope: assignment.targetScope,
    };
  };

  const addComponentToCollection = <T>(
    collection: Map<T, Map<number, StaffReviewComponentSummary>>,
    key: T | null | undefined,
    summary: StaffReviewComponentSummary,
  ) => {
    if (key == null) {
      return;
    }
    const existing = collection.get(key);
    if (existing) {
      existing.set(summary.componentId, summary);
      return;
    }
    const next = new Map<number, StaffReviewComponentSummary>();
    next.set(summary.componentId, summary);
    collection.set(key, next);
  };

  const assignmentRequiresReviews = (assignment: CompensationComponentAssignment): boolean => {
    if (!assignment.component) {
      return false;
    }
    const componentRequirement = readMinReviewsFromConfig(assignment.component.config ?? null);
    const assignmentRequirement = readMinReviewsFromConfig(assignment.config ?? null);
    if (assignment.component.category === 'review') {
      return true;
    }
    return Boolean(componentRequirement || assignmentRequirement);
  };

  const userShiftRoleMap = new Map<number, Set<number>>();
  userShiftRoles.forEach((record) => {
    if (record.userId == null || record.shiftRoleId == null) {
      return;
    }
    const current = userShiftRoleMap.get(record.userId) ?? new Set<number>();
    current.add(record.shiftRoleId);
    userShiftRoleMap.set(record.userId, current);
  });

  const reviewComponentsByUser = new Map<number, Map<number, StaffReviewComponentSummary>>();
  userAssignments.forEach((assignment) => {
    if (!assignmentRequiresReviews(assignment)) {
      return;
    }
    const summary = buildComponentSummary(assignment);
    if (!summary) {
      return;
    }
    addComponentToCollection(reviewComponentsByUser, assignment.userId, summary);
  });

  const reviewComponentsByUserType = new Map<number, Map<number, StaffReviewComponentSummary>>();
  userTypeAssignments.forEach((assignment) => {
    if (!assignmentRequiresReviews(assignment)) {
      return;
    }
    const summary = buildComponentSummary(assignment);
    if (!summary) {
      return;
    }
    addComponentToCollection(reviewComponentsByUserType, assignment.userTypeId, summary);
  });

  const reviewComponentsByStaffType = new Map<
    StaffProfile['staffType'],
    Map<number, StaffReviewComponentSummary>
  >();
  staffTypeAssignments.forEach((assignment) => {
    if (!assignmentRequiresReviews(assignment)) {
      return;
    }
    const summary = buildComponentSummary(assignment);
    if (!summary) {
      return;
    }
    addComponentToCollection(reviewComponentsByStaffType, assignment.staffType, summary);
  });

  const reviewComponentsByShiftRole = new Map<number, Map<number, StaffReviewComponentSummary>>();
  shiftRoleAssignments.forEach((assignment) => {
    if (!assignmentRequiresReviews(assignment)) {
      return;
    }
    const summary = buildComponentSummary(assignment);
    if (!summary) {
      return;
    }
    addComponentToCollection(reviewComponentsByShiftRole, assignment.shiftRoleId ?? null, summary);
  });

  const globalReviewComponents = globalAssignments
    .map((assignment) => {
      if (!assignmentRequiresReviews(assignment)) {
        return null;
      }
      return buildComponentSummary(assignment);
    })
    .filter((value): value is StaffReviewComponentSummary => value != null);

  const collectReviewComponentsForBucket = (bucket: StaffBucket) => {
    const aggregated = new Map<number, StaffReviewComponentSummary>();
    const merge = (source?: Map<number, StaffReviewComponentSummary>) => {
      if (!source) {
        return;
      }
      source.forEach((value, key) => aggregated.set(key, value));
    };
    globalReviewComponents.forEach((component) => {
      aggregated.set(component.componentId, component);
    });
    merge(reviewComponentsByUser.get(bucket.userId));
    if (bucket.userTypeId != null) {
      merge(reviewComponentsByUserType.get(bucket.userTypeId));
    }
    const staffType = staffTypeByUserId.get(bucket.userId);
    if (staffType) {
      merge(reviewComponentsByStaffType.get(staffType));
    }
    const shiftRoleIdsForUser = userShiftRoleMap.get(bucket.userId);
    if (shiftRoleIdsForUser && shiftRoleIdsForUser.size > 0) {
      shiftRoleIdsForUser.forEach((shiftRoleId) => {
        merge(reviewComponentsByShiftRole.get(shiftRoleId));
      });
    }
    return Array.from(aggregated.values()).sort((a, b) => a.name.localeCompare(b.name));
  };

  const staff: StaffMonthlySummary[] = Array.from(staffMap.values())
    .map((bucket) => {
      bucket.platforms.sort((a, b) => a.platform.localeCompare(b.platform) || a.counterId - b.counterId);
      const needsMinimum = bucket.totalReviews < MINIMUM_REVIEWS_FOR_PAYMENT;
      const reviewComponents = collectReviewComponentsForBucket(bucket);
      const eligibleForIncentive = reviewComponents.length > 0;
      const approvalRecord = approvalMap.get(bucket.userId);
      const canApproveIncentive = eligibleForIncentive;

      return {
        userId: bucket.userId,
        displayName: bucket.displayName,
        totalReviews: bucket.totalReviews,
        totalRoundedReviews: roundReviewCredit(bucket.totalReviews),
        needsMinimum,
        eligibleForIncentive,
        canApproveIncentive,
        paymentApproval: formatApprovalStatus(approvalRecord, 'payment'),
        incentiveApproval: formatApprovalStatus(approvalRecord, 'incentive'),
        baseOverrideApproval: formatApprovalStatus(approvalRecord, 'base'),
        platforms: bucket.platforms,
        reviewComponents,
      };
    })
    .sort((a, b) => {
      if (Math.abs(b.totalReviews - a.totalReviews) > FLOAT_TOLERANCE) {
        return b.totalReviews - a.totalReviews;
      }
      return a.displayName.localeCompare(b.displayName);
    });

  return {
    periodStart: startValue,
    periodEnd: endValue,
    minimumReviews: MINIMUM_REVIEWS_FOR_PAYMENT,
    staff,
  };
};

export const getReviewCounterStaffSummary = async (req: Request, res: Response): Promise<void> => {
  try {
    const period =
      parsePeriodInput(req.query.periodStart) ??
      parsePeriodInput(req.query.period) ??
      parsePeriodInput(req.query.startDate) ??
      dayjs().startOf('month');
    const payload = await buildStaffSummaryForPeriod(period.startOf('month'));
    res.status(200).json([{ data: [payload], columns: [] }]);
  } catch (error) {
    console.error('Failed to load staff review summary', error);
    res.status(500).json([{ message: 'Failed to load review staff summary' }]);
  }
};

export const updateReviewCounterMonthlyApproval = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isFinite(userId)) {
      res.status(400).json([{ message: 'Provide a valid userId parameter' }]);
      return;
    }
    const actorId = getActorId(req);
    if (!actorId) {
      res.status(403).json([{ message: 'Authentication required to approve reviews' }]);
      return;
    }
    const rawPeriod =
      parsePeriodInput(req.body?.periodStart) ??
      parsePeriodInput(req.body?.period) ??
      parsePeriodInput(req.body?.startDate) ??
      dayjs().startOf('month');
    const period = rawPeriod.startOf('month');
    const { paymentApproved, incentiveApproved, componentId, baseOverrideApproved } = req.body ?? {};
    if (
      typeof paymentApproved !== 'boolean' &&
      typeof incentiveApproved !== 'boolean' &&
      typeof baseOverrideApproved !== 'boolean'
    ) {
      res.status(400).json([{ message: 'Provide paymentApproved or incentiveApproved flags to update' }]);
      return;
    }

    const summary = await buildStaffSummaryForPeriod(period);
    const staffRecord = summary.staff.find((entry) => entry.userId === userId);
    if (!staffRecord) {
      res.status(404).json([{ message: 'No review counters found for the selected period' }]);
      return;
    }

    if (incentiveApproved === true && !staffRecord.canApproveIncentive) {
      res.status(400).json([{ message: 'Staff member is not eligible for incentive approval in this period' }]);
      return;
    }

    const periodStart = period.format('YYYY-MM-DD');
    const now = new Date();
    const existing = await ReviewCounterMonthlyApproval.findOne({ where: { userId, periodStart } });

    if (typeof componentId === 'number' && incentiveApproved === true) {
      console.info('Review component approval requested', { userId, componentId, periodStart });
    }

    const nextValues: Partial<ReviewCounterMonthlyApproval> = {};
    if (typeof paymentApproved === 'boolean') {
      nextValues.paymentApproved = paymentApproved;
      nextValues.paymentApprovedAt = paymentApproved ? now : null;
      nextValues.paymentApprovedBy = paymentApproved ? actorId : null;
    }
    if (typeof incentiveApproved === 'boolean') {
      nextValues.incentiveApproved = incentiveApproved;
      nextValues.incentiveApprovedAt = incentiveApproved ? now : null;
      nextValues.incentiveApprovedBy = incentiveApproved ? actorId : null;
    }
    if (typeof baseOverrideApproved === 'boolean') {
      nextValues.baseOverrideApproved = baseOverrideApproved;
      nextValues.baseOverrideApprovedAt = baseOverrideApproved ? now : null;
      nextValues.baseOverrideApprovedBy = baseOverrideApproved ? actorId : null;
    }

    if (existing) {
      await existing.update(nextValues);
    } else {
      await ReviewCounterMonthlyApproval.create({
        userId,
        periodStart,
        paymentApproved: typeof paymentApproved === 'boolean' ? paymentApproved : false,
        paymentApprovedAt: typeof paymentApproved === 'boolean' && paymentApproved ? now : null,
        paymentApprovedBy: typeof paymentApproved === 'boolean' && paymentApproved ? actorId : null,
        incentiveApproved: typeof incentiveApproved === 'boolean' ? incentiveApproved : false,
        incentiveApprovedAt: typeof incentiveApproved === 'boolean' && incentiveApproved ? now : null,
        incentiveApprovedBy: typeof incentiveApproved === 'boolean' && incentiveApproved ? actorId : null,
        baseOverrideApproved: typeof baseOverrideApproved === 'boolean' ? baseOverrideApproved : false,
        baseOverrideApprovedAt: typeof baseOverrideApproved === 'boolean' && baseOverrideApproved ? now : null,
        baseOverrideApprovedBy: typeof baseOverrideApproved === 'boolean' && baseOverrideApproved ? actorId : null,
      });
    }

    const refreshed = await buildStaffSummaryForPeriod(period);
    res.status(200).json([{ data: [refreshed], columns: [] }]);
  } catch (error) {
    console.error('Failed to update review counter monthly approval', error);
    res.status(500).json([{ message: 'Failed to update monthly approval' }]);
  }
};
const createDefaultEntriesForCounter = async (counterId: number, actorId: number | null) => {
  const roleAssignments = await UserShiftRole.findAll({
    attributes: ['userId'],
    raw: true,
  });
  const roleUserIds = Array.from(
    new Set(
      roleAssignments
        .map((assignment: { userId?: number | null }) => assignment.userId)
        .filter((userId): userId is number => typeof userId === 'number'),
    ),
  );

  const activeUsers =
    roleUserIds.length === 0
      ? []
      : await User.findAll({
          where: { status: true, id: { [Op.in]: roleUserIds } },
          attributes: ['id', 'firstName', 'lastName'],
          order: [
            ['firstName', 'ASC'],
            ['lastName', 'ASC'],
          ],
        });

  const buildDisplayName = (user: { firstName?: string | null; lastName?: string | null; id: number }) => {
    const composed = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
    return composed.length > 0 ? composed : `User #${user.id}`;
  };

  const entryPayloads: Array<Partial<ReviewCounterEntry>> = [
    ...activeUsers.map((user) => ({
      counterId,
      userId: user.id,
      displayName: buildDisplayName(user),
      category: 'staff' as ReviewCounterEntryCategory,
      rawCount: 0,
      roundedCount: 0,
      underMinimumApproved: false,
      underMinimumApprovedBy: null,
      createdBy: actorId,
      updatedBy: actorId,
    })),
    {
      counterId,
      userId: null,
      displayName: 'No Name',
      category: 'no_name',
      rawCount: 0,
      roundedCount: 0,
      underMinimumApproved: false,
      underMinimumApprovedBy: null,
      createdBy: actorId,
      updatedBy: actorId,
    },
    {
      counterId,
      userId: null,
      displayName: 'Bad Review',
      category: 'bad',
      rawCount: 0,
      roundedCount: 0,
      underMinimumApproved: false,
      underMinimumApprovedBy: null,
      createdBy: actorId,
      updatedBy: actorId,
    },
  ];

  if (entryPayloads.length > 0) {
    await ReviewCounterEntry.bulkCreate(entryPayloads);
  }
};
