import type { Request, Response } from 'express';
import { Op } from 'sequelize';
import sequelize from '../config/database.js';
import ReviewArchive from '../models/ReviewArchive.js';
import ReviewDailySnapshot from '../models/ReviewDailySnapshot.js';
import ReviewSyncRun from '../models/ReviewSyncRun.js';
import { getAirbnbReviews, getAllGoogleReviews, getTripAdvisorReviews } from '../controllers/reviewController.js';

type Platform = 'google' | 'tripadvisor' | 'airbnb';
type SourcePayload = { data?: any[]; columns?: any[] };
const handlers = { google: getAllGoogleReviews, tripadvisor: getTripAdvisorReviews, airbnb: getAirbnbReviews };
const rating = (value: unknown) => ({ ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 }[String(value).toUpperCase() as 'ONE'] ?? Number(value) ?? 0);

const fetchPage = async (platform: Platform, query: Record<string, string | number>): Promise<SourcePayload> =>
  new Promise((resolve, reject) => {
    let statusCode = 200;
    const response = {
      status(code: number) { statusCode = code; return this; },
      json(body: any) {
        if (statusCode >= 400) reject(new Error(body?.details ?? body?.error ?? `Review source returned ${statusCode}`));
        else resolve(body?.[0] ?? { data: [], columns: [] });
        return this;
      },
    } as unknown as Response;
    Promise.resolve(handlers[platform]({ query } as unknown as Request, response)).catch(reject);
  });

export async function runFullReviewSync(platform: Platform): Promise<{ seen: number; deleted: number }> {
  const run = await ReviewSyncRun.create({ platform, status: 'running', seenCount: 0, deletedCount: 0, startedAt: new Date(), completedAt: null, createdBy: null });
  let token: string | undefined, cursor: string | undefined, offset = 0, seen = 0;
  let sourceTotalCount: number | null = null, averageRating: number | null = null;
  try {
    for (let pageNumber = 0; pageNumber < 250; pageNumber++) {
      const query: Record<string, string | number> = platform === 'google' ? (token ? { pageToken: token } : {}) : platform === 'tripadvisor' ? (offset ? { offset } : {}) : (cursor ? { cursor } : {});
      const payload = await fetchPage(platform, query);
      const reviews = payload.data ?? [], meta = payload.columns?.[0] ?? {};
      const now = new Date();
      await sequelize.transaction(async transaction => {
        for (const raw of reviews) {
          const sourceReviewId = String(raw.reviewId ?? raw.name ?? '').trim();
          if (!sourceReviewId) continue;
          const values = { platform, sourceReviewId, reviewerName: String(raw.reviewer?.displayName ?? raw.reviewerName ?? 'Unknown'), reviewerPhotoUrl: raw.reviewer?.profilePhotoUrl ?? null, comment: raw.comment ?? raw.Description ?? null, rating: rating(raw.starRating ?? raw.score), reviewCreatedAt: new Date(raw.createTime ?? raw.date ?? now), reviewUpdatedAt: raw.updateTime ? new Date(raw.updateTime) : null, isDeleted: false, deletedDetectedAt: null, lastSeenAt: now, lastSeenRunId: run.id, rawPayload: raw };
          const existing = await ReviewArchive.findOne({ where: { platform, sourceReviewId }, transaction });
          if (existing) await existing.update(values, { transaction });
          else await ReviewArchive.create({ ...values, firstSeenAt: now }, { transaction });
        }
      });
      seen += reviews.length;
      if (platform === 'google') {
        token = meta.nextPageToken || undefined; sourceTotalCount = Number(meta.totalCount ?? sourceTotalCount); averageRating = Number(meta.averageRating ?? averageRating);
        if (!token) break;
      } else if (platform === 'tripadvisor') {
        sourceTotalCount = Number(meta.totalCount ?? sourceTotalCount); if (!meta.hasMore) break; offset = Number(meta.nextOffset);
      } else {
        sourceTotalCount = Number(meta.totalCount ?? sourceTotalCount); if (!meta.hasMore || !meta.endCursor) break; cursor = String(meta.endCursor);
      }
    }
    await run.update({ seenCount: seen });
    const now = new Date();
    const [deleted] = await ReviewArchive.update({ isDeleted: true, deletedDetectedAt: now }, { where: { platform, [Op.or]: [{ lastSeenRunId: { [Op.ne]: run.id } }, { lastSeenRunId: null }], isDeleted: false } });
    await run.update({ status: 'completed', deletedCount: deleted, completedAt: now });
    const [archivedCount, activeCount, newReviewsCount] = await Promise.all([ReviewArchive.count({ where: { platform } }), ReviewArchive.count({ where: { platform, isDeleted: false } }), ReviewArchive.count({ where: { platform, firstSeenAt: { [Op.gte]: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) } } })]);
    await ReviewDailySnapshot.upsert({ platform, snapshotDate: now.toISOString().slice(0, 10), sourceTotalCount, averageRating, archivedCount, activeCount, deletedCount: archivedCount - activeCount, newReviewsCount, syncRunId: run.id });
    return { seen, deleted };
  } catch (error) {
    await run.update({ status: 'failed', completedAt: new Date() });
    throw error;
  }
}

export async function runAllFullReviewSyncs(): Promise<Array<{ platform: Platform; seen?: number; deleted?: number; error?: string }>> {
  const results: Array<{ platform: Platform; seen?: number; deleted?: number; error?: string }> = [];
  for (const platform of ['google', 'tripadvisor', 'airbnb'] as Platform[]) {
    try { results.push({ platform, ...await runFullReviewSync(platform) }); }
    catch (error) { results.push({ platform, error: error instanceof Error ? error.message : 'Unknown sync error' }); }
  }
  return results;
}
