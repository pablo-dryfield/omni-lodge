import { Op } from 'sequelize';
import type { Request, Response } from 'express';
import dayjs from 'dayjs';
import ReviewCounter from '../models/ReviewCounter.js';
import ReviewCounterEntry, { type ReviewCounterEntryCategory } from '../models/ReviewCounterEntry.js';
import User from '../models/User.js';
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
const createDefaultEntriesForCounter = async (counterId: number, actorId: number | null) => {
  const activeUsers = await User.findAll({
    where: { status: true },
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

