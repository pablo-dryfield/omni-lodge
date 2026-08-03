import type { Response } from 'express';
import { Op } from 'sequelize';
import sequelize from '../config/database.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import ReviewArchive from '../models/ReviewArchive.js';
import ReviewAssignment from '../models/ReviewAssignment.js';
import ReviewSyncRun from '../models/ReviewSyncRun.js';
import ReviewManualCredit from '../models/ReviewManualCredit.js';
import ReviewDailySnapshot from '../models/ReviewDailySnapshot.js';
import User from '../models/User.js';

const actor = (req: AuthenticatedRequest) => {
  const id = req.authContext?.id;
  if (!id) throw new Error('Authentication required');
  return id;
};
const fail = (res: Response, error: unknown) =>
  res.status(400).json([{ message: error instanceof Error ? error.message : 'Unknown error' }]);
const numericRating = (value: unknown) => {
  if (typeof value === 'number') return value;
  const named = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 }[String(value).toUpperCase() as 'ONE'];
  return named ?? Number(value) ?? 0;
};

export async function startReviewSync(req: AuthenticatedRequest, res: Response) {
  try {
    const platform = String(req.body.platform ?? '').toLowerCase();
    if (!platform) throw new Error('platform is required');
    const run = await ReviewSyncRun.create({ platform, status: 'running', seenCount: 0, deletedCount: 0, startedAt: new Date(), completedAt: null, createdBy: actor(req) });
    res.status(201).json({ run });
  } catch (error) { fail(res, error); }
}

export async function ingestReviewSyncPage(req: AuthenticatedRequest, res: Response) {
  try {
    const run = await ReviewSyncRun.findByPk(Number(req.params.runId));
    if (!run || run.status !== 'running') throw new Error('Active sync run not found');
    const reviews = Array.isArray(req.body.reviews) ? req.body.reviews : [];
    const now = new Date();
    await sequelize.transaction(async transaction => {
      for (const raw of reviews) {
        const sourceReviewId = String(raw.reviewId ?? raw.name ?? '').trim();
        if (!sourceReviewId) continue;
        const values = {
          platform: run.platform, sourceReviewId,
          reviewerName: String(raw.reviewer?.displayName ?? raw.reviewerName ?? 'Unknown'),
          reviewerPhotoUrl: raw.reviewer?.profilePhotoUrl ?? null,
          comment: raw.comment ?? raw.Description ?? null,
          rating: numericRating(raw.starRating ?? raw.score),
          reviewCreatedAt: new Date(raw.createTime ?? raw.date ?? now),
          reviewUpdatedAt: raw.updateTime ? new Date(raw.updateTime) : null,
          isDeleted: false, deletedDetectedAt: null, lastSeenAt: now, lastSeenRunId: run.id, rawPayload: raw,
        };
        const existing = await ReviewArchive.findOne({ where: { platform: run.platform, sourceReviewId }, transaction });
        if (existing) await existing.update(values, { transaction });
        else await ReviewArchive.create({ ...values, firstSeenAt: now }, { transaction });
      }
      await run.increment('seenCount', { by: reviews.length, transaction });
    });
    res.json({ ingested: reviews.length });
  } catch (error) { fail(res, error); }
}

export async function completeReviewSync(req: AuthenticatedRequest, res: Response) {
  try {
    const run = await ReviewSyncRun.findByPk(Number(req.params.runId));
    if (!run || run.status !== 'running') throw new Error('Active sync run not found');
    const now = new Date();
    const partial = req.body.partial === true;
    const deleted = partial ? [0] : await ReviewArchive.update(
      { isDeleted: true, deletedDetectedAt: now },
      { where: { platform: run.platform, [Op.or]: [{ lastSeenRunId: { [Op.ne]: run.id } }, { lastSeenRunId: null }], isDeleted: false } },
    );
    await run.update({ status: 'completed', deletedCount: deleted[0], completedAt: now });
    const [archivedCount, activeCount, newReviewsCount] = await Promise.all([
      ReviewArchive.count({ where: { platform: run.platform } }),
      ReviewArchive.count({ where: { platform: run.platform, isDeleted: false } }),
      ReviewArchive.count({ where: { platform: run.platform, firstSeenAt: { [Op.gte]: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) } } }),
    ]);
    const snapshotDate = now.toISOString().slice(0, 10);
    await ReviewDailySnapshot.upsert({
      platform: run.platform, snapshotDate,
      sourceTotalCount: req.body.sourceTotalCount == null ? null : Number(req.body.sourceTotalCount),
      averageRating: req.body.averageRating == null ? null : Number(req.body.averageRating),
      archivedCount, activeCount, deletedCount: archivedCount - activeCount, newReviewsCount, syncRunId: run.id,
    });
    res.json({ run, snapshotDate, archivedCount, activeCount, partial });
  } catch (error) { fail(res, error); }
}

export async function completeFastReviewSync(req: AuthenticatedRequest, res: Response) {
  req.body = { ...req.body, partial: true };
  await completeReviewSync(req, res);
}

export async function listArchivedReviews(req: AuthenticatedRequest, res: Response) {
  try {
    const platform = String(req.query.platform ?? '').toLowerCase();
    const deleted = String(req.query.deleted ?? 'all');
    const search = String(req.query.search ?? '').trim();
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 24));
    const page = Math.max(1, Number(req.query.page) || 1);
    const where: any = {};
    if (platform) where.platform = platform;
    if (deleted !== 'all') where.isDeleted = deleted === 'true';
    if (search) where[Op.or] = [{ reviewerName: { [Op.like]: `%${search}%` } }, { comment: { [Op.like]: `%${search}%` } }];
    const { rows: reviews, count: total } = await ReviewArchive.findAndCountAll({ where, order: [['reviewCreatedAt', 'DESC']], limit: pageSize, offset: (page - 1) * pageSize });
    const ids = reviews.map(review => review.id);
    const assignments = ids.length ? await ReviewAssignment.findAll({ where: { reviewId: ids } }) : [];
    const byReview = new Map<number, number[]>();
    for (const assignment of assignments) byReview.set(assignment.reviewId, [...(byReview.get(assignment.reviewId) ?? []), assignment.userId]);
    const users = await User.findAll({ attributes: ['id', 'firstName', 'lastName', 'username'], order: [['firstName', 'ASC']] });
    res.json({
      reviews: reviews.map(review => {
        const assignedUserIds = byReview.get(review.id) ?? [];
        return { ...review.toJSON(), assignedUserIds, credit: assignedUserIds.length ? 1 / assignedUserIds.length : 0 };
      }),
      users,
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    });
  } catch (error) { fail(res, error); }
}

export async function getReviewTrends(req: AuthenticatedRequest, res: Response) {
  try {
    const days = Math.min(730, Math.max(7, Number(req.query.days) || 90));
    const platform = String(req.query.platform ?? '').toLowerCase();
    const since = new Date(); since.setUTCDate(since.getUTCDate() - days + 1);
    const where: any = { snapshotDate: { [Op.gte]: since.toISOString().slice(0, 10) } };
    if (platform) where.platform = platform;
    const snapshots = await ReviewDailySnapshot.findAll({ where, order: [['snapshotDate', 'ASC'], ['platform', 'ASC']] });
    res.json({ snapshots });
  } catch (error) { fail(res, error); }
}

export async function replaceReviewAssignments(req: AuthenticatedRequest, res: Response) {
  try {
    const reviewId = Number(req.params.id);
    if (!await ReviewArchive.count({ where: { id: reviewId } })) throw new Error('Review not found');
    const userIds = Array.from(new Set((Array.isArray(req.body.userIds) ? req.body.userIds : []).map(Number).filter(Number.isInteger))) as number[];
    if (userIds.length && await User.count({ where: { id: userIds } }) !== userIds.length) throw new Error('One or more users were not found');
    await sequelize.transaction(async transaction => {
      await ReviewAssignment.destroy({ where: { reviewId }, transaction });
      if (userIds.length) await ReviewAssignment.bulkCreate(userIds.map(userId => ({ reviewId, userId, assignedBy: actor(req) })), { transaction });
    });
    res.json({ reviewId, userIds, creditPerUser: userIds.length ? 1 / userIds.length : 0 });
  } catch (error) { fail(res, error); }
}

export async function updateReviewFlags(req: AuthenticatedRequest, res: Response) {
  try {
    const review = await ReviewArchive.findByPk(Number(req.params.id));
    if (!review) throw new Error('Review not found');
    const changes: { isNoName?: boolean; isBadReview?: boolean } = {};
    if (typeof req.body.isNoName === 'boolean') changes.isNoName = req.body.isNoName;
    if (typeof req.body.isBadReview === 'boolean') changes.isBadReview = req.body.isBadReview;
    if (!Object.keys(changes).length) throw new Error('Provide isNoName or isBadReview');
    await review.update(changes);
    res.json({ review });
  } catch (error) { fail(res, error); }
}

export async function createManualReviewCredit(req: AuthenticatedRequest, res: Response) {
  try {
    const category = ['staff', 'no_name', 'bad'].includes(String(req.body.category)) ? String(req.body.category) : 'staff';
    const userId = category === 'staff' ? Number(req.body.userId) : null;
    if (category === 'staff' && (!Number.isInteger(userId) || !await User.count({ where: { id: userId } }))) throw new Error('A valid user is required for staff credit');
    const row = await ReviewManualCredit.create({ userId, category, platform: String(req.body.platform ?? 'manual'), date: String(req.body.date), credit: Number(req.body.credit ?? 1), notes: req.body.notes ?? null, createdBy: actor(req) });
    res.status(201).json({ credit: row });
  } catch (error) { fail(res, error); }
}

export async function getReviewCreditSummary(req: AuthenticatedRequest, res: Response) {
  try {
    const start = String(req.query.start ?? '0001-01-01'), end = String(req.query.end ?? '9999-12-31');
    const reviews = await ReviewArchive.findAll({ where: { reviewCreatedAt: { [Op.between]: [new Date(start), new Date(`${end}T23:59:59Z`)] } } });
    const ids = reviews.map(review => review.id);
    const assignments = ids.length ? await ReviewAssignment.findAll({ where: { reviewId: ids } }) : [];
    const manual = await ReviewManualCredit.findAll({ where: { date: { [Op.between]: [start, end] } } });
    const totals = new Map<number, { assigned: number; manual: number; reviewCount: number }>();
    for (const review of reviews) {
      const rows = assignments.filter(assignment => assignment.reviewId === review.id);
      for (const assignment of rows) {
        const current = totals.get(assignment.userId) ?? { assigned: 0, manual: 0, reviewCount: 0 };
        current.assigned += 1 / rows.length; current.reviewCount++; totals.set(assignment.userId, current);
      }
    }
    for (const credit of manual) {
      const userId = credit.userId;
      if (credit.category !== 'staff' || userId == null) continue;
      const current = totals.get(userId) ?? { assigned: 0, manual: 0, reviewCount: 0 };
      current.manual += Number(credit.credit); totals.set(userId, current);
    }
    const users = totals.size ? await User.findAll({ where: { id: Array.from(totals.keys()) }, attributes: ['id', 'firstName', 'lastName', 'username'] }) : [];
    res.json({ staff: users.map(user => ({ userId: user.id, name: `${user.firstName} ${user.lastName}`.trim() || user.username, ...totals.get(user.id)!, total: (totals.get(user.id)?.assigned ?? 0) + (totals.get(user.id)?.manual ?? 0) })), reviewCount: reviews.length, deletedCount: reviews.filter(review => review.isDeleted).length, unassignedCount: reviews.filter(review => !assignments.some(assignment => assignment.reviewId === review.id)).length, manualCategoryTotals: { noName: manual.filter(row => row.category === 'no_name').reduce((sum, row) => sum + Number(row.credit), 0), bad: manual.filter(row => row.category === 'bad').reduce((sum, row) => sum + Number(row.credit), 0) } });
  } catch (error) { fail(res, error); }
}
