import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';
import { Op, UniqueConstraintError, type Transaction } from 'sequelize';
import HttpError from '../errors/HttpError.js';
import AssistantManagerTaskLog from '../models/AssistantManagerTaskLog.js';
import AssistantManagerTaskTemplate from '../models/AssistantManagerTaskTemplate.js';
import AuditLog from '../models/AuditLog.js';
import type SocialMediaContent from '../models/SocialMediaContent.js';
import StaffPayoutCollectionLog from '../models/StaffPayoutCollectionLog.js';
import StaffPayoutLedger from '../models/StaffPayoutLedger.js';
import User from '../models/User.js';
import VolunteerFundEntry from '../finance/models/VolunteerFundEntry.js';
import { getConfigValue } from './configService.js';
import { isStaffPayoutReimbursementCollection } from './staffPayoutCollectionClassificationService.js';
import {
  applyManagerTaskOverride,
  buildAssistantManagerTaskGenerationSourceKey,
} from './assistantManagerTaskLogManagementService.js';
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
  allowCrossUserCompletion?: boolean;
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

type PublishedTaskDateReassignmentParams = {
  content: SocialMediaContent;
  actorId: number;
  publishedDate: string;
  transaction: Transaction;
};

export type SocialMediaTaskDateReassignmentResult = {
  previousTaskLogId: number;
  taskCompletion: SocialMediaTaskCompletionResult;
  publishedAt: Date;
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

const candidateInclude = [{
  model: AssistantManagerTaskTemplate,
  as: 'template',
  attributes: ['id', 'name', 'scheduleConfig'],
  required: true,
}];

const isPublishEnabled = (log: CandidateLog): boolean =>
  resolveCompleteOnSocialMediaPublish(log.meta, log.template?.scheduleConfig);

const assertCrossUserCompletionAllowed = (
  log: CandidateLog,
  actorId: number,
  allowCrossUserCompletion: boolean,
): void => {
  if (log.userId !== actorId && !allowCrossUserCompletion) {
    throw new SocialMediaPublishTaskConflictError(
      'Only an authorized manager can publish content that completes another user\'s Task Planner task.',
    );
  }
};

const chooseUniqueTaskForUser = (
  candidates: CandidateLog[],
  userId: number,
  contentId: number,
  label: string,
): CandidateLog | null => {
  const userCandidates = candidates.filter((log) => log.userId === userId && isPublishEnabled(log));
  const eligible = userCandidates.filter((log) => {
    const linkedContentId = getStoredSocialMediaContentId(log.meta);
    return linkedContentId == null || linkedContentId === contentId;
  });

  if (eligible.length > 1) {
    throw new SocialMediaPublishTaskConflictError(
      `More than one publish-enabled Social Media task matches ${label} today. Link this idea to the correct task before publishing.`,
    );
  }
  if (eligible.length === 1) return eligible[0];

  if (userCandidates.some((log) => getStoredSocialMediaContentId(log.meta) != null)) {
    throw new SocialMediaPublishTaskConflictError(
      `The publish-enabled Social Media task for ${label} today is already linked to another idea.`,
    );
  }
  return null;
};

const assertPublicationRescheduleAllowed = (
  log: CandidateLog,
  publicationDate: string,
): void => {
  const sourceDate = String(log.taskDate);
  // Staff payouts are write-enabled only for full calendar months. Staying in
  // the publication month permits late same-month completion while crossing
  // backward into an earlier month would rewrite a closed payout source.
  if (
    sourceDate < publicationDate
    && sourceDate.slice(0, 7) !== publicationDate.slice(0, 7)
  ) {
    throw new SocialMediaPublishTaskConflictError(
      'The linked Social Media task belongs to a previous closed payroll month and cannot be moved automatically. Ask a manager to resolve that historical task before publishing.',
    );
  }
};

const waiveSupersededTask = async (
  log: CandidateLog,
  replacement: CandidateLog,
  params: PublishTaskParams,
  taskDate: string,
): Promise<void> => {
  assertPublicationRescheduleAllowed(log, taskDate);
  const supersededMeta = {
    ...(log.meta ?? {}),
    socialMediaPublishSupersession: {
      version: 1,
      contentId: params.content.id,
      supersededByTaskLogId: replacement.id,
      previousTaskDate: String(log.taskDate),
      previousStatus: log.status,
      publicationDate: taskDate,
      appliedAt: params.publishedAt.toISOString(),
      appliedBy: params.actorId,
    },
  } as Record<string, unknown>;
  const supersededNote =
    `Waived because Social Media content #${params.content.id} was published through `
    + `the existing ${taskDate} task #${replacement.id}.`;
  await log.update({
    status: 'waived',
    completedAt: null,
    notes: fitNotesWithBlock(log.notes?.trim() ?? '', supersededNote),
    meta: supersededMeta,
    updatedBy: params.actorId,
  }, { transaction: params.transaction });
};

const completeCandidateTask = async (
  log: CandidateLog,
  params: PublishTaskParams,
  taskDate: string,
): Promise<SocialMediaTaskCompletionResult> => {
  const existingLink = getStoredSocialMediaContentId(log.meta);
  if (existingLink != null && existingLink !== params.content.id) {
    throw new SocialMediaPublishTaskConflictError(
      'The matching Social Media task is linked to another idea.',
    );
  }

  const previousTaskDate = String(log.taskDate);
  let nextMeta = { ...(log.meta ?? {}) } as Record<string, unknown>;
  if (previousTaskDate !== taskDate) {
    assertPublicationRescheduleAllowed(log, taskDate);
    const collision = await AssistantManagerTaskLog.findOne({
      where: {
        id: { [Op.ne]: log.id },
        templateId: log.templateId,
        userId: log.userId,
        taskDate,
      },
      include: candidateInclude,
      transaction: params.transaction,
      lock: params.transaction.LOCK.UPDATE,
    }) as CandidateLog | null;
    if (collision) {
      const collisionContentId = getStoredSocialMediaContentId(collision.meta);
      if (
        collision.status === 'pending'
        && isPublishEnabled(collision)
        && (collisionContentId == null || collisionContentId === params.content.id)
      ) {
        // The generated same-day task already occupies the unique key. It is
        // the correct row for today's completion, while the older linked row
        // must be waived so it cannot later become a missed duplicate.
        await waiveSupersededTask(log, collision, params, taskDate);
        return completeCandidateTask(collision, params, taskDate);
      }
      throw new SocialMediaPublishTaskConflictError(
        'The linked Social Media task cannot use the publication date because another non-eligible task from the same template already exists for that user today.',
      );
    }
    if (!Boolean(nextMeta.manual)) {
      nextMeta = applyManagerTaskOverride(
        nextMeta,
        buildAssistantManagerTaskGenerationSourceKey(log.templateId, log.userId, previousTaskDate),
        params.actorId,
        params.publishedAt.toISOString(),
      );
    }
    nextMeta.socialMediaPublishReschedule = {
      version: 1,
      previousTaskDate,
      publicationDate: taskDate,
      previousStatus: log.status,
      appliedAt: params.publishedAt.toISOString(),
      appliedBy: params.actorId,
    };
  }

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

  try {
    await log.update({
      ...(previousTaskDate !== taskDate ? { taskDate } : {}),
      status: 'completed',
      completedAt: params.publishedAt,
      notes: appendManagedEvidenceOnce(log.notes, params.content, params.platformLinks),
      meta: nextMeta,
      updatedBy: params.actorId,
    }, { transaction: params.transaction });
  } catch (error) {
    if (previousTaskDate !== taskDate && error instanceof UniqueConstraintError) {
      throw new SocialMediaPublishTaskConflictError(
        'A publication-date task was created at the same time. Try publishing again so the existing task can be used safely.',
      );
    }
    throw error;
  }

  return taskResult(log);
};

/**
 * Completes exactly one publish-enabled Task Planner log for the responsible
 * user. A privileged publisher may complete the creator's explicitly linked
 * or same-day task, but ambiguity never changes compensation percentages.
 */
export async function completeTaskForSocialMediaPublication(
  params: PublishTaskParams,
): Promise<SocialMediaTaskCompletionResult> {
  const allowCrossUserCompletion = params.allowCrossUserCompletion === true;
  if (params.content.publishedTaskLogId) {
    const existing = await AssistantManagerTaskLog.findByPk(
      params.content.publishedTaskLogId,
      { transaction: params.transaction, lock: params.transaction.LOCK.SHARE },
    );
    if (
      existing
      && existing.status === 'completed'
      && getStoredSocialMediaContentId(existing.meta) === params.content.id
    ) {
      assertCrossUserCompletionAllowed(existing, params.actorId, allowCrossUserCompletion);
      return taskResult(existing);
    }
    throw new SocialMediaPublishTaskConflictError(
      'This publication is already linked to a different Task Planner result.',
    );
  }

  const timezoneName = normalizeTimezone();
  const taskDate = dayjs(params.publishedAt).tz(timezoneName).format('YYYY-MM-DD');
  const creatorId = Number(params.content.createdBy);
  const hasCreator = Number.isInteger(creatorId) && creatorId > 0;
  const relevantUserIds = Array.from(new Set([
    params.actorId,
    ...(hasCreator && (creatorId === params.actorId || allowCrossUserCompletion) ? [creatorId] : []),
  ]));

  // An explicit task-to-content link is authoritative. It may have been
  // created on the planned date, so locate it before applying today's date
  // fallback and move it atomically to the actual publication date. Only the
  // publisher and, for an authorized cross-user publication, the creator are
  // eligible; another staff member cannot claim or block this content by
  // linking it from their own task.
  const linkedCandidates = (await AssistantManagerTaskLog.findAll({
    where: {
      userId: { [Op.in]: relevantUserIds },
      status: { [Op.in]: ['pending', 'missed'] },
      meta: {
        [Op.contains]: { [SOCIAL_MEDIA_CONTENT_ID_META_KEY]: params.content.id },
      },
    },
    include: candidateInclude,
    order: [['taskDate', 'ASC'], ['id', 'ASC']],
    transaction: params.transaction,
    lock: params.transaction.LOCK.UPDATE,
  })) as CandidateLog[];
  const exactLinked = linkedCandidates.filter((log) =>
    getStoredSocialMediaContentId(log.meta) === params.content.id
    && (
      log.status === 'pending'
      || (log.status === 'missed' && String(log.taskDate) < taskDate)
    ));
  if (exactLinked.length > 1) {
    const sameDayLinked = exactLinked.filter(
      (log) => String(log.taskDate) === taskDate && isPublishEnabled(log),
    );
    const allLinkedArePublishEnabled = exactLinked.every(isPublishEnabled);
    const publicationDayTask = sameDayLinked[0];
    const allLinkedAreTheSameObligation = publicationDayTask != null && exactLinked.every(
      (log) =>
        log.userId === publicationDayTask.userId
        && log.templateId === publicationDayTask.templateId,
    );
    if (
      publicationDayTask != null
      && sameDayLinked.length === 1
      && allLinkedArePublishEnabled
      && allLinkedAreTheSameObligation
    ) {
      exactLinked.forEach((log) =>
        assertCrossUserCompletionAllowed(log, params.actorId, allowCrossUserCompletion));
      for (const olderTask of exactLinked) {
        if (olderTask.id !== publicationDayTask.id) {
          await waiveSupersededTask(olderTask, publicationDayTask, params, taskDate);
        }
      }
      return completeCandidateTask(publicationDayTask, params, taskDate);
    }
    throw new SocialMediaPublishTaskConflictError(
      'More than one Task Planner task is linked to this Social Media item. Keep only the correct link before publishing.',
    );
  }
  if (exactLinked.length === 1) {
    const linked = exactLinked[0];
    if (!isPublishEnabled(linked)) {
      throw new SocialMediaPublishTaskConflictError(
        'The Task Planner task linked to this content is not enabled for automatic completion when published.',
      );
    }
    assertCrossUserCompletionAllowed(linked, params.actorId, allowCrossUserCompletion);
    return completeCandidateTask(linked, params, taskDate);
  }

  const sameDayCandidates = (await AssistantManagerTaskLog.findAll({
    where: {
      userId: { [Op.in]: relevantUserIds },
      taskDate,
      status: 'pending',
    },
    include: candidateInclude,
    order: [['id', 'ASC']],
    transaction: params.transaction,
    lock: params.transaction.LOCK.UPDATE,
  })) as CandidateLog[];

  if (hasCreator && (creatorId === params.actorId || allowCrossUserCompletion)) {
    const creatorTask = chooseUniqueTaskForUser(
      sameDayCandidates,
      creatorId,
      params.content.id,
      creatorId === params.actorId ? 'you' : 'the content creator',
    );
    if (creatorTask) {
      assertCrossUserCompletionAllowed(creatorTask, params.actorId, allowCrossUserCompletion);
      return completeCandidateTask(creatorTask, params, taskDate);
    }
  }

  if (!hasCreator || creatorId !== params.actorId) {
    const actorTask = chooseUniqueTaskForUser(
      sameDayCandidates,
      params.actorId,
      params.content.id,
      'you',
    );
    if (actorTask) return completeCandidateTask(actorTask, params, taskDate);
  }

  if (hasCreator && creatorId !== params.actorId && !allowCrossUserCompletion) {
    throw new SocialMediaPublishTaskConflictError(
      'No pending publish-enabled Social Media task exists for you today. Only an authorized manager can publish on behalf of the content creator.',
    );
  }
  throw new SocialMediaPublishTaskConflictError(
    'No pending publish-enabled Social Media task exists for the responsible user today. Generate or assign the task, then link this idea before publishing.',
  );
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const removePublicationEvidence = (
  existing: string | null,
  content: SocialMediaContent,
  publication: Record<string, unknown>,
): string | null => {
  let notes = existing ?? '';
  for (const correction of [false, true]) {
    const markers = evidenceMarkers(content.id, correction);
    let startIndex = notes.indexOf(markers.start);
    while (startIndex >= 0) {
      const endIndex = notes.indexOf(markers.end, startIndex + markers.start.length);
      if (endIndex < 0) {
        throw new SocialMediaPublishTaskConflictError(
          'The original task has incomplete publication notes. Repair its evidence block before changing the publish date.',
        );
      }
      notes = [
        notes.slice(0, startIndex).trimEnd(),
        notes.slice(endIndex + markers.end.length).trimStart(),
      ].filter(Boolean).join('\n\n');
      startIndex = notes.indexOf(markers.start);
    }
  }

  // Older publications predate managed markers. Remove only the exact generated
  // text proven by the stored snapshot; never delete individual matching lines
  // that may belong to someone's own notes.
  if (typeof publication.title === 'string' && typeof publication.idea === 'string') {
    const legacyContent = {
      ...content,
      ...publication,
      id: content.id,
    } as unknown as SocialMediaContent;
    const legacyLinks = asRecord(publication.originalPlatformLinks ?? publication.platformLinks);
    const links = Object.fromEntries(Object.entries(legacyLinks).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ));
    const legacyBlock = buildTaskNotes(legacyContent, links);
    const legacyIndex = notes.indexOf(legacyBlock);
    if (legacyIndex >= 0) {
      notes = [
        notes.slice(0, legacyIndex).trimEnd(),
        notes.slice(legacyIndex + legacyBlock.length).trimStart(),
      ].filter(Boolean).join('\n\n');
    }
  }
  return notes || null;
};

const assertPublicationTaskPayrollIsUnsettled = async (
  userId: number,
  taskDates: string[],
  transaction: Transaction,
): Promise<void> => {
  const dateRanges = taskDates.map((date) => ({
    rangeStart: { [Op.lte]: date }, rangeEnd: { [Op.gte]: date },
  }));
  // Pays takes the same user lock before recording settlements. A past month
  // is editable until money has actually been settled; a preview snapshot
  // alone is not a closed payroll period.
  const user = await User.findByPk(userId, {
    attributes: ['id'], transaction, lock: transaction.LOCK.UPDATE,
  });
  if (!user) {
    throw new SocialMediaPublishTaskConflictError('The responsible task assignee no longer exists.');
  }
  const paidLedger = await StaffPayoutLedger.findOne({
    where: {
      staffUserId: userId,
      paidAmountMinor: { [Op.ne]: 0 },
      // Later payments can have consumed the carry from either edited month.
      rangeEnd: { [Op.gte]: [...taskDates].sort()[0] },
    },
    attributes: ['id'], transaction, lock: transaction.LOCK.UPDATE,
  });
  const collections = await StaffPayoutCollectionLog.findAll({
    where: {
      staffProfileId: userId, direction: 'payable', amountMinor: { [Op.ne]: 0 }, [Op.or]: dateRanges,
    },
    attributes: ['id', 'note'], transaction, lock: transaction.LOCK.UPDATE,
  });
  const allocations = await VolunteerFundEntry.findAll({
    where: {
      attributedStaffUserId: userId,
      entryType: 'allocation',
      [Op.or]: taskDates.map((date) => ({
        periodStart: { [Op.lte]: date }, periodEnd: { [Op.gte]: date },
      })),
    },
    attributes: ['id', 'amountMinor'], transaction, lock: transaction.LOCK.UPDATE,
  });
  const reversals = allocations.length > 0 ? await VolunteerFundEntry.findAll({
    where: { entryType: 'reversal', reversalOfEntryId: { [Op.in]: allocations.map((entry) => entry.id) } },
    attributes: ['reversalOfEntryId', 'amountMinor'], transaction, lock: transaction.LOCK.UPDATE,
  }) : [];
  const hasSettledAllocation = allocations.some((allocation) => {
    const reversed = reversals.filter((entry) => String(entry.reversalOfEntryId) === String(allocation.id))
      .reduce((sum, entry) => sum + Number(entry.amountMinor), 0);
    return Number(allocation.amountMinor) + reversed > 0;
  });
  if (
    paidLedger
    || collections.some((entry) => !isStaffPayoutReimbursementCollection(entry))
    || hasSettledAllocation
  ) {
    throw new SocialMediaPublishTaskConflictError(
      'The old or new task date affects an already settled payout or its carried balance for this person. Resolve the affected settlement in Pays before changing the publish date.',
    );
  }
};

/**
 * Corrects a publication date by transferring its completion to an existing
 * task for the same assignee. The caller must lock/save the content in this
 * transaction and authorize the manager before calling this service.
 */
export async function reassignPublishedSocialMediaTaskDate(
  params: PublishedTaskDateReassignmentParams,
): Promise<SocialMediaTaskDateReassignmentResult> {
  const { content, actorId, transaction, publishedDate } = params;
  const timezoneName = normalizeTimezone();
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(publishedDate)
    || !dayjs(publishedDate, 'YYYY-MM-DD', true).isValid()
  ) {
    throw new HttpError(400, 'publishedDate must be a valid YYYY-MM-DD date');
  }
  if (publishedDate > dayjs().tz(timezoneName).format('YYYY-MM-DD')) {
    throw new HttpError(400, 'The publish date cannot be in the future');
  }
  if (
    content.status !== 'published'
    || !content.publishedAt
    || !dayjs(content.publishedAt).isValid()
    || !content.publishedBy
    || !content.publishedTaskLogId
  ) {
    throw new SocialMediaPublishTaskConflictError(
      'A verified published item and its completed Task Planner task are required to change the publish date.',
    );
  }

  const source = await AssistantManagerTaskLog.findByPk(content.publishedTaskLogId, {
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  const previousPublication = asRecord(source?.meta?.[PUBLICATION_META_KEY]);
  const previousSnapshot = asRecord(source?.meta?.[SOCIAL_MEDIA_CONTENT_SNAPSHOT_META_KEY]);
  if (
    !source
    || source.status !== 'completed'
    || getStoredSocialMediaContentId(source.meta) !== content.id
    || (previousPublication.contentId != null && previousPublication.contentId !== content.id)
    || (previousSnapshot.id != null && previousSnapshot.id !== content.id)
  ) {
    throw new SocialMediaPublishTaskConflictError(
      'The original completed Task Planner publication could not be verified. Refresh the item before changing its publish date.',
    );
  }
  const previousDate = dayjs(content.publishedAt).tz(timezoneName).format('YYYY-MM-DD');
  if (previousDate === publishedDate && String(source.taskDate) === publishedDate) {
    return {
      previousTaskLogId: source.id,
      taskCompletion: taskResult(source),
      publishedAt: content.publishedAt,
    };
  }

  await assertPublicationTaskPayrollIsUnsettled(source.userId, [String(source.taskDate), publishedDate], transaction);

  const candidates = (await AssistantManagerTaskLog.findAll({
    where: { userId: source.userId, taskDate: publishedDate, id: { [Op.ne]: source.id } },
    include: candidateInclude,
    order: [['id', 'ASC']],
    transaction,
    lock: transaction.LOCK.UPDATE,
  })) as CandidateLog[];
  const publishTasks = candidates.filter((log) =>
    log.userId === source.userId && String(log.taskDate) === publishedDate && isPublishEnabled(log));
  const linked = publishTasks.filter((log) => getStoredSocialMediaContentId(log.meta) === content.id);
  const available = publishTasks.filter((log) =>
    getStoredSocialMediaContentId(log.meta) == null && ['pending', 'missed'].includes(log.status));
  const matches = linked.length > 0 ? linked : available;
  if (matches.length > 1) {
    throw new SocialMediaPublishTaskConflictError(
      'More than one publish-enabled task matches this person on the new date. Link the idea to the correct task first.',
    );
  }
  const target = matches[0];
  if (!target) {
    throw new SocialMediaPublishTaskConflictError(
      publishTasks.length > 0
        ? 'The publish-enabled task on the new date is already completed, waived, or linked to another idea.'
        : 'Assign a publish-enabled Social Media task to the same person on the new date before changing the publish date.',
    );
  }
  const targetPublication = asRecord(target.meta?.[PUBLICATION_META_KEY]);
  const targetSnapshot = asRecord(target.meta?.[SOCIAL_MEDIA_CONTENT_SNAPSHOT_META_KEY]);
  if (
    !['pending', 'missed'].includes(target.status)
    || (targetPublication.contentId != null && targetPublication.contentId !== content.id)
    || (targetSnapshot.id != null && targetSnapshot.id !== content.id)
    || (
      target.meta?.[SOCIAL_MEDIA_CONTENT_ID_META_KEY] != null
      && getStoredSocialMediaContentId(target.meta) !== content.id
    )
  ) {
    throw new SocialMediaPublishTaskConflictError(
      'The matching task on the new date is already completed, waived, or contains another publication. Choose an available task first.',
    );
  }

  const publishedAt = dayjs.tz(
    `${publishedDate}T${dayjs(content.publishedAt).tz(timezoneName).format('HH:mm:ss.SSS')}`,
    timezoneName,
  ).toDate();
  const editedAt = new Date().toISOString();
  const sourceNotes = removePublicationEvidence(source.notes, content, previousPublication);
  const targetNotes = [
    removePublicationEvidence(target.notes, content, targetPublication)?.trimEnd(),
    buildManagedEvidenceBlock(content, content.platformLinks),
  ].filter(Boolean).join('\n\n');
  if (targetNotes.length > MAX_TASK_NOTES_LENGTH) {
    throw new SocialMediaPublishTaskConflictError(
      'The destination task does not have enough note space for the publication. Shorten its notes before changing the publish date.',
    );
  }

  const sourceMeta = { ...(source.meta ?? {}) };
  delete sourceMeta[SOCIAL_MEDIA_CONTENT_ID_META_KEY];
  delete sourceMeta[SOCIAL_MEDIA_CONTENT_SNAPSHOT_META_KEY];
  delete sourceMeta[PUBLICATION_META_KEY];
  delete sourceMeta[AUTO_COMPLETION_META_KEY];
  delete sourceMeta.socialMediaPublishReschedule;
  delete sourceMeta.socialMediaPublishSupersession;
  const dateEdit = {
    editedAt,
    editedBy: actorId,
    previousPublishedAt: content.publishedAt.toISOString(),
    publishedAt: publishedAt.toISOString(),
    previousTaskLogId: source.id,
    taskLogId: target.id,
    userId: source.userId,
  };
  const previousDateHistory = Array.isArray(previousPublication.publishDateEditHistory)
    ? previousPublication.publishDateEditHistory
    : [];
  const targetMeta = {
    ...(target.meta ?? {}),
    [SOCIAL_MEDIA_CONTENT_ID_META_KEY]: content.id,
    [SOCIAL_MEDIA_CONTENT_SNAPSHOT_META_KEY]: buildAssistantManagerTaskSocialMediaSnapshot(content),
    [AUTO_COMPLETION_META_KEY]: true,
    [PUBLICATION_META_KEY]: {
      ...previousPublication,
      version: 2,
      contentId: content.id,
      publishedBy: previousPublication.publishedBy ?? content.publishedBy,
      publishedAt: publishedAt.toISOString(),
      originalPublishedAt: previousPublication.originalPublishedAt ?? content.publishedAt.toISOString(),
      title: content.title,
      idea: content.idea,
      onVideoCaptions: content.onVideoCaptions,
      platformCaption: content.platformCaption,
      hashtags: content.hashtags,
      driveProjectUrl: content.driveProjectUrl,
      scheduledAt: content.scheduledAt,
      platformLinks: content.platformLinks,
      publishDateEditHistory: [...previousDateHistory, dateEdit],
    },
  };

  await source.update({
    status: 'pending', completedAt: null, notes: sourceNotes, meta: sourceMeta, updatedBy: actorId,
  }, { transaction });
  await target.update({
    status: 'completed', completedAt: publishedAt, notes: targetNotes, meta: targetMeta, updatedBy: actorId,
  }, { transaction });
  // A cached Pays preview may already contain settlement intents based on the
  // old completion. Clear unpaid authority for affected and subsequent carry
  // periods so those intents cannot settle until Pays recalculates them.
  await StaffPayoutLedger.update({ settlementSnapshot: null }, {
    where: {
      staffUserId: source.userId,
      paidAmountMinor: 0,
      rangeEnd: { [Op.gte]: [String(source.taskDate), publishedDate].sort()[0] },
    },
    transaction,
  });
  await AuditLog.create({
    actorId,
    action: 'social_media.publish_date_changed',
    entity: 'social_media_content',
    entityId: String(content.id),
    metaJson: { ...dateEdit, previousPublication },
  }, { transaction });
  return { previousTaskLogId: source.id, taskCompletion: taskResult(target), publishedAt };
}

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
    // Preserve publisher attribution while reflecting any manager-corrected
    // publication date on the content record.
    publishedBy: previousPublication.publishedBy ?? params.content.publishedBy,
    publishedAt: params.content.publishedAt.toISOString(),
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
