import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';
import type { Transaction } from 'sequelize';
import AssistantManagerTaskLog from '../models/AssistantManagerTaskLog.js';
import AssistantManagerTaskTemplate from '../models/AssistantManagerTaskTemplate.js';
import type SocialMediaContent from '../models/SocialMediaContent.js';
import { getConfigValue } from './configService.js';
import {
  SOCIAL_MEDIA_CONTENT_ID_META_KEY,
  SOCIAL_MEDIA_CONTENT_SNAPSHOT_META_KEY,
  buildAssistantManagerTaskSocialMediaSnapshot,
  getStoredSocialMediaContentId,
  resolveCompleteOnSocialMediaPublish,
} from './assistantManagerTaskSocialMediaRuleService.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

const DEFAULT_TIMEZONE = 'Europe/Warsaw';
const PUBLICATION_META_KEY = 'socialMediaPublicationSnapshot';
const AUTO_COMPLETION_META_KEY = 'completedBySocialMediaPublish';

export type SocialMediaTaskCompletionResult = {
  taskLogId: number;
  userId: number;
  taskDate: string;
  status: 'completed';
};

export class SocialMediaPublishTaskConflictError extends Error {}

type PublishTaskParams = {
  content: SocialMediaContent;
  actorId: number;
  publishedAt: Date;
  platformLinks: Record<string, string>;
  transaction: Transaction;
};

type CandidateLog = AssistantManagerTaskLog & {
  template?: AssistantManagerTaskTemplate | null;
};

const normalizeTimezone = (): string =>
  (getConfigValue('SCHED_TZ') as string | null) || DEFAULT_TIMEZONE;

const buildTaskNotes = (
  content: SocialMediaContent,
  platformLinks: Record<string, string>,
): string => {
  const hashtags = (Array.isArray(content.hashtags) ? content.hashtags : [])
    .map((tag) => `#${String(tag).replace(/^#+/u, '')}`)
    .join(' ');
  const platformLabels: Record<string, string> = {
    instagram: 'Instagram',
    tiktok: 'TikTok',
  };
  const links = Object.entries(platformLinks)
    .map(([platform, url]) => `${platformLabels[platform] ?? platform}: ${url}`)
    .join('\n');
  return [
    `Social Media publication: ${content.title}`,
    `Idea: ${content.idea}`,
    `On-video captions: ${content.onVideoCaptions}`,
    `Platform caption: ${content.platformCaption}`,
    hashtags ? `Hashtags: ${hashtags}` : null,
    content.driveProjectUrl ? `Drive folder: ${content.driveProjectUrl}` : null,
    links || null,
  ].filter((line): line is string => Boolean(line)).join('\n');
};

const appendNotesOnce = (existing: string | null, publicationNotes: string): string => {
  const marker = publicationNotes.split('\n')[0];
  if (existing?.includes(marker)) return existing;
  return [existing?.trim(), publicationNotes].filter(Boolean).join('\n\n').slice(0, 100_000);
};

const taskResult = (log: AssistantManagerTaskLog): SocialMediaTaskCompletionResult => ({
  taskLogId: log.id,
  userId: log.userId,
  taskDate: String(log.taskDate),
  status: 'completed',
});

/**
 * Completes exactly one publish-enabled Task Planner log for the authenticated
 * publisher. This is intentionally stricter than the generic social-plan gate:
 * an ambiguous task must never change compensation completion percentages.
 */
export async function completeTaskForSocialMediaPublication(
  params: PublishTaskParams,
): Promise<SocialMediaTaskCompletionResult> {
  if (params.content.publishedTaskLogId) {
    const existing = await AssistantManagerTaskLog.findByPk(
      params.content.publishedTaskLogId,
      { transaction: params.transaction, lock: params.transaction.LOCK.SHARE },
    );
    if (
      existing
      && existing.userId === params.actorId
      && existing.status === 'completed'
      && getStoredSocialMediaContentId(existing.meta) === params.content.id
    ) {
      return taskResult(existing);
    }
    throw new SocialMediaPublishTaskConflictError(
      'This publication is already linked to a different Task Planner result.',
    );
  }

  const timezoneName = normalizeTimezone();
  const taskDate = dayjs(params.publishedAt).tz(timezoneName).format('YYYY-MM-DD');
  const candidates = await AssistantManagerTaskLog.findAll({
    where: {
      userId: params.actorId,
      taskDate,
      status: 'pending',
    },
    include: [{
      model: AssistantManagerTaskTemplate,
      as: 'template',
      attributes: ['id', 'name', 'scheduleConfig'],
      required: true,
    }],
    order: [['id', 'ASC']],
    transaction: params.transaction,
    lock: params.transaction.LOCK.UPDATE,
  }) as CandidateLog[];

  const enabled = candidates.filter((log) =>
    resolveCompleteOnSocialMediaPublish(log.meta, log.template?.scheduleConfig),
  );
  const linked = enabled.filter(
    (log) => getStoredSocialMediaContentId(log.meta) === params.content.id,
  );
  const unlinked = enabled.filter((log) => getStoredSocialMediaContentId(log.meta) == null);
  const eligible = linked.length > 0 ? linked : unlinked;

  if (eligible.length === 0) {
    throw new SocialMediaPublishTaskConflictError(
      'No pending publish-enabled Social Media task exists for you today. Generate or assign the task, then link this idea before publishing.',
    );
  }
  if (eligible.length > 1) {
    throw new SocialMediaPublishTaskConflictError(
      'More than one publish-enabled Social Media task matches today. Link this idea to the correct task before publishing.',
    );
  }

  const log = eligible[0];
  const existingLink = getStoredSocialMediaContentId(log.meta);
  if (existingLink != null && existingLink !== params.content.id) {
    throw new SocialMediaPublishTaskConflictError(
      'The matching Social Media task is linked to another idea.',
    );
  }

  const nextMeta = { ...(log.meta ?? {}) } as Record<string, unknown>;
  nextMeta[SOCIAL_MEDIA_CONTENT_ID_META_KEY] = params.content.id;
  nextMeta[SOCIAL_MEDIA_CONTENT_SNAPSHOT_META_KEY] = buildAssistantManagerTaskSocialMediaSnapshot({
    id: params.content.id,
    title: params.content.title,
    status: 'published',
    targetPlatforms: params.content.targetPlatforms,
    scheduledAt: params.content.scheduledAt,
    thumbnailUrl: params.content.thumbnailUrl,
  });
  nextMeta[PUBLICATION_META_KEY] = {
    version: 1,
    contentId: params.content.id,
    publishedBy: params.actorId,
    publishedAt: params.publishedAt.toISOString(),
    title: params.content.title,
    idea: params.content.idea,
    onVideoCaptions: params.content.onVideoCaptions,
    platformCaption: params.content.platformCaption,
    hashtags: params.content.hashtags,
    driveProjectUrl: params.content.driveProjectUrl,
    platformLinks: params.platformLinks,
  };
  nextMeta[AUTO_COMPLETION_META_KEY] = true;

  await log.update({
    status: 'completed',
    completedAt: params.publishedAt,
    notes: appendNotesOnce(log.notes, buildTaskNotes(params.content, params.platformLinks)),
    meta: nextMeta,
    updatedBy: params.actorId,
  }, { transaction: params.transaction });

  return taskResult(log);
}
