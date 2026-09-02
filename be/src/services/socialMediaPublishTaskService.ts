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
const MAX_TASK_NOTES_LENGTH = 100_000;

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

type PublishedTaskEvidenceSyncParams = {
  content: SocialMediaContent;
  actorId: number;
  transaction: Transaction;
  linkEdit?: {
    editedAt: Date;
    previousPlatformLinks: Record<string, string>;
  };
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

const evidenceMarkers = (contentId: number, correction = false) => {
  const label = correction
    ? `Social Media publication link correction #${contentId}`
    : `Social Media publication evidence #${contentId}`;
  return {
    start: `[${label} - START]`,
    end: `[${label} - END]`,
  };
};

const buildManagedEvidenceBlock = (
  content: SocialMediaContent,
  platformLinks: Record<string, string>,
  options: { correction?: boolean; editedAt?: Date; editedBy?: number } = {},
): string => {
  const markers = evidenceMarkers(content.id, options.correction === true);
  const detail = options.correction
    ? [
      `Updated Instagram: ${platformLinks.instagram}`,
      `Updated TikTok: ${platformLinks.tiktok}`,
      options.editedAt && options.editedBy
        ? `Links corrected at ${options.editedAt.toISOString()} by user #${options.editedBy}.`
        : null,
    ].filter((line): line is string => Boolean(line)).join('\n')
    : [
      buildTaskNotes(content, platformLinks),
      options.editedAt && options.editedBy
        ? `Publication links updated at ${options.editedAt.toISOString()} by user #${options.editedBy}.`
        : null,
    ].filter((line): line is string => Boolean(line)).join('\n');
  return [markers.start, detail, markers.end].join('\n');
};

const fitNotesWithBlock = (prefix: string, block: string, suffix = ''): string => {
  const separatorBefore = prefix.trim() ? '\n\n' : '';
  const separatorAfter = suffix.trim() ? '\n\n' : '';
  const reserved = block.length + separatorBefore.length + separatorAfter.length + suffix.length;
  const allowedPrefixLength = Math.max(0, MAX_TASK_NOTES_LENGTH - reserved);
  const fittedPrefix = prefix.slice(0, allowedPrefixLength).trimEnd();
  return `${fittedPrefix}${fittedPrefix ? separatorBefore : ''}${block}${separatorAfter}${suffix}`
    .slice(0, MAX_TASK_NOTES_LENGTH);
};

const appendManagedEvidenceOnce = (
  existing: string | null,
  content: SocialMediaContent,
  platformLinks: Record<string, string>,
): string => {
  const markers = evidenceMarkers(content.id);
  if (existing?.includes(markers.start)) return existing;
  return fitNotesWithBlock(
    existing?.trim() ?? '',
    buildManagedEvidenceBlock(content, platformLinks),
  );
};

const replaceManagedEvidence = (
  existing: string | null,
  content: SocialMediaContent,
  platformLinks: Record<string, string>,
  editedAt: Date,
  editedBy: number,
): string => {
  const notes = existing ?? '';
  const fullMarkers = evidenceMarkers(content.id);
  const correctionMarkers = evidenceMarkers(content.id, true);
  const replaceBlock = (
    markers: ReturnType<typeof evidenceMarkers>,
    correction: boolean,
  ): string | null => {
    const startIndex = notes.indexOf(markers.start);
    if (startIndex < 0) return null;
    const endIndex = notes.indexOf(markers.end, startIndex + markers.start.length);
    if (endIndex < 0) return null;
    const suffixStart = endIndex + markers.end.length;
    return fitNotesWithBlock(
      notes.slice(0, startIndex).trimEnd(),
      buildManagedEvidenceBlock(content, platformLinks, {
        correction,
        editedAt,
        editedBy,
      }),
      notes.slice(suffixStart).trimStart(),
    );
  };

  return replaceBlock(fullMarkers, false)
    ?? replaceBlock(correctionMarkers, true)
    ?? fitNotesWithBlock(
      notes.trim(),
      buildManagedEvidenceBlock(content, platformLinks, {
        correction: true,
        editedAt,
        editedBy,
      }),
    );
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
    version: 2,
    contentId: params.content.id,
    publishedBy: params.actorId,
    publishedAt: params.publishedAt.toISOString(),
    title: params.content.title,
    idea: params.content.idea,
    onVideoCaptions: params.content.onVideoCaptions,
    platformCaption: params.content.platformCaption,
    hashtags: params.content.hashtags,
    driveProjectUrl: params.content.driveProjectUrl,
    scheduledAt: params.content.scheduledAt,
    platformLinks: params.platformLinks,
  };
  nextMeta[AUTO_COMPLETION_META_KEY] = true;

  await log.update({
    status: 'completed',
    completedAt: params.publishedAt,
    notes: appendManagedEvidenceOnce(log.notes, params.content, params.platformLinks),
    meta: nextMeta,
    updatedBy: params.actorId,
  }, { transaction: params.transaction });

  return taskResult(log);
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

/**
 * Refreshes the evidence stored on the already-completed Task Planner log.
 * Call this in the same transaction as an edit to published content so the
 * content and its compensation-affecting task evidence can never diverge.
 */
export async function syncPublishedSocialMediaTaskEvidence(
  params: PublishedTaskEvidenceSyncParams,
): Promise<SocialMediaTaskCompletionResult | null> {
  if (params.content.status !== 'published') {
    throw new SocialMediaPublishTaskConflictError(
      'Only published Social Media content can refresh publication evidence.',
    );
  }
  // Content created before Task Planner publication automation has no linked
  // evidence record. Its published fields can still be corrected safely.
  if (!params.content.publishedTaskLogId) return null;
  if (!params.content.publishedAt || !params.content.publishedBy) {
    throw new SocialMediaPublishTaskConflictError(
      'Published Social Media content is missing its Task Planner publication record.',
    );
  }

  const log = await AssistantManagerTaskLog.findByPk(
    params.content.publishedTaskLogId,
    { transaction: params.transaction, lock: params.transaction.LOCK.UPDATE },
  );
  if (
    !log
    || log.status !== 'completed'
    || log.userId !== params.content.publishedBy
    || getStoredSocialMediaContentId(log.meta) !== params.content.id
  ) {
    throw new SocialMediaPublishTaskConflictError(
      'The linked Task Planner publication evidence could not be verified.',
    );
  }

  const nextMeta = { ...(log.meta ?? {}) } as Record<string, unknown>;
  nextMeta[SOCIAL_MEDIA_CONTENT_SNAPSHOT_META_KEY] = buildAssistantManagerTaskSocialMediaSnapshot({
    id: params.content.id,
    title: params.content.title,
    status: 'published',
    targetPlatforms: params.content.targetPlatforms,
    scheduledAt: params.content.scheduledAt,
    thumbnailUrl: params.content.thumbnailUrl,
  });

  const previousPublication = asRecord(nextMeta[PUBLICATION_META_KEY]);
  const previousHistory = Array.isArray(previousPublication.platformLinkEditHistory)
    ? previousPublication.platformLinkEditHistory
    : [];
  const platformLinkEditHistory = params.linkEdit
    ? [
      ...previousHistory,
      {
        editedAt: params.linkEdit.editedAt.toISOString(),
        editedBy: params.actorId,
        previousPlatformLinks: params.linkEdit.previousPlatformLinks,
        platformLinks: params.content.platformLinks,
      },
    ]
    : previousHistory;
  nextMeta[PUBLICATION_META_KEY] = {
    ...previousPublication,
    version: 2,
    contentId: params.content.id,
    // These are the immutable original publication facts. Prefer the stored
    // values so evidence remains accurate even if legacy data is repaired.
    publishedBy: previousPublication.publishedBy ?? params.content.publishedBy,
    publishedAt:
      previousPublication.publishedAt ?? params.content.publishedAt.toISOString(),
    title: params.content.title,
    idea: params.content.idea,
    onVideoCaptions: params.content.onVideoCaptions,
    platformCaption: params.content.platformCaption,
    hashtags: params.content.hashtags,
    driveProjectUrl: params.content.driveProjectUrl,
    scheduledAt: params.content.scheduledAt,
    originalPlatformLinks:
      previousPublication.originalPlatformLinks
      ?? params.linkEdit?.previousPlatformLinks
      ?? previousPublication.platformLinks
      ?? params.content.platformLinks,
    platformLinks: params.content.platformLinks,
    ...(params.linkEdit
      ? {
        linksEditedAt: params.linkEdit.editedAt.toISOString(),
        linksEditedBy: params.actorId,
      }
      : {}),
    ...(platformLinkEditHistory.length > 0 ? { platformLinkEditHistory } : {}),
  };

  await log.update({
    notes: params.linkEdit
      ? replaceManagedEvidence(
        log.notes,
        params.content,
        params.content.platformLinks,
        params.linkEdit.editedAt,
        params.actorId,
      )
      : log.notes,
    meta: nextMeta,
    updatedBy: params.actorId,
  }, { transaction: params.transaction });

  return taskResult(log);
}
