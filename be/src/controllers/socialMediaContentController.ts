import type { Response } from 'express';
import { Op, type Includeable } from 'sequelize';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import SocialMediaContent, {
  SOCIAL_MEDIA_CONTENT_STATUSES,
  type SocialMediaContentStatus,
} from '../models/SocialMediaContent.js';
import SocialMediaContentAsset from '../models/SocialMediaContentAsset.js';
import User from '../models/User.js';
import {
  deleteSocialMediaThumbnail,
  openSocialMediaThumbnailStream,
  SocialMediaThumbnailUnsafeContentError,
  SocialMediaThumbnailValidationError,
  storeSocialMediaThumbnail,
} from '../services/socialMediaThumbnailStorageService.js';
import logger from '../utils/logger.js';

const TASK_READY_STATUSES: SocialMediaContentStatus[] = [
  'planned',
  'in_production',
  'ready',
  'published',
];
const STATUS_ORDER = new Map<SocialMediaContentStatus, number>(
  SOCIAL_MEDIA_CONTENT_STATUSES.map((status, index) => [status, index]),
);
const THUMBNAIL_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']);
const DEFAULT_TARGET_PLATFORMS = ['instagram', 'tiktok'];
const WORKFLOW_CONTROLLED_FIELDS = new Set([
  'status',
  'targetPlatforms',
  'scheduledAt',
  'publishedAt',
  'driveProjectUrl',
  'driveUrl',
  'platformLinks',
]);
const USER_INCLUDE = [
  { model: User, as: 'createdByUser', attributes: ['id', 'firstName', 'lastName', 'username'] },
  { model: User, as: 'updatedByUser', attributes: ['id', 'firstName', 'lastName', 'username'] },
];
const CONTENT_INCLUDE: Includeable[] = [
  ...USER_INCLUDE,
  {
    model: SocialMediaContentAsset,
    as: 'assets',
    separate: true,
    order: [['createdAt', 'ASC']],
  },
];

class SocialMediaContentValidationError extends Error {}

type UserSummary = Pick<User, 'id' | 'firstName' | 'lastName' | 'username'>;

type NormalizedContentPayload = {
  values: {
    title: string;
    idea: string;
    onVideoCaptions: string;
    platformCaption: string;
    hashtags: string[];
    targetPlatforms: string[];
    status: SocialMediaContentStatus;
    scheduledAt: string | null;
    publishedAt: Date | null;
    driveProjectUrl: string | null;
    platformLinks: Record<string, string>;
    thumbnailUrl: string | null;
    thumbnailDriveFileId: string | null;
    thumbnailOriginalName: string | null;
    thumbnailMimeType: string | null;
    archivedAt: Date | null;
  };
  storedThumbnailToDelete: string | null;
};

const hasOwn = (value: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const normalizeRequiredText = (value: unknown, label: string, maxLength?: number): string => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new SocialMediaContentValidationError(`${label} is required.`);
  }
  if (maxLength && normalized.length > maxLength) {
    throw new SocialMediaContentValidationError(`${label} cannot be longer than ${maxLength} characters.`);
  }
  return normalized;
};

const normalizeOptionalText = (value: unknown, label: string, maxLength?: number): string => {
  if (value == null) {
    return '';
  }
  if (typeof value !== 'string') {
    throw new SocialMediaContentValidationError(`${label} must be text.`);
  }
  const normalized = value.trim();
  if (maxLength && normalized.length > maxLength) {
    throw new SocialMediaContentValidationError(`${label} cannot be longer than ${maxLength} characters.`);
  }
  return normalized;
};

const normalizeStringList = (
  value: unknown,
  label: string,
  options: { hashtag?: boolean; maxItems?: number } = {},
): string[] => {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(options.hashtag ? /[,\s]+/u : ',')
      : [];
  if (!Array.isArray(value) && typeof value !== 'string' && value != null) {
    throw new SocialMediaContentValidationError(`${label} must be a list of text values.`);
  }

  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of source) {
    if (typeof item !== 'string') {
      throw new SocialMediaContentValidationError(`${label} must contain only text values.`);
    }
    let normalized = item.trim();
    if (!normalized) continue;
    if (options.hashtag) {
      normalized = normalized.replace(/#+/gu, '').trim().toLowerCase();
      if (!normalized) continue;
    } else {
      normalized = normalized.toLowerCase().replace(/[\s-]+/gu, '_');
    }
    if (normalized.length > 64) {
      throw new SocialMediaContentValidationError(`${label} values cannot be longer than 64 characters.`);
    }
    const key = normalized.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(normalized);
    }
  }
  if (result.length > (options.maxItems ?? 30)) {
    throw new SocialMediaContentValidationError(`${label} cannot contain more than ${options.maxItems ?? 30} values.`);
  }
  return result;
};

const normalizeStatus = (value: unknown): SocialMediaContentStatus => {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!SOCIAL_MEDIA_CONTENT_STATUSES.includes(normalized as SocialMediaContentStatus)) {
    throw new SocialMediaContentValidationError(
      `Status must be one of: ${SOCIAL_MEDIA_CONTENT_STATUSES.join(', ')}.`,
    );
  }
  return normalized as SocialMediaContentStatus;
};

const normalizeDate = (value: unknown, label: string): Date | null => {
  if (value == null || value === '') {
    return null;
  }
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new SocialMediaContentValidationError(`${label} must be a valid date and time.`);
  }
  return parsed;
};

const normalizeDateOnly = (value: unknown, label: string): string | null => {
  if (value == null || value === '') return null;
  const normalized = typeof value === 'string' ? value.trim().slice(0, 10) : '';
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(normalized)) {
    throw new SocialMediaContentValidationError(`${label} must be a valid calendar date.`);
  }
  const [year, month, day] = normalized.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    throw new SocialMediaContentValidationError(`${label} must be a valid calendar date.`);
  }
  return normalized;
};

const normalizeUrl = (value: unknown, label: string): string | null => {
  if (value == null || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    throw new SocialMediaContentValidationError(`${label} must be a URL.`);
  }
  const trimmed = value.trim();
  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Unsupported protocol');
    }
  } catch {
    throw new SocialMediaContentValidationError(`${label} must be a valid http or https URL.`);
  }
  if (trimmed.length > 4096) {
    throw new SocialMediaContentValidationError(`${label} cannot be longer than 4096 characters.`);
  }
  return trimmed;
};

const normalizePlatformLinks = (value: unknown): Record<string, string> => {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new SocialMediaContentValidationError('Platform links must be an object keyed by platform.');
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 12) {
    throw new SocialMediaContentValidationError('Platform links cannot contain more than 12 platforms.');
  }
  return Object.fromEntries(entries.map(([rawPlatform, rawUrl]) => {
    const platform = rawPlatform.trim().toLowerCase().replace(/[\s-]+/gu, '_');
    if (!platform || platform.length > 64) {
      throw new SocialMediaContentValidationError('Platform link keys must be valid platform names.');
    }
    const url = normalizeUrl(rawUrl, `${rawPlatform} platform link`);
    if (!url) {
      throw new SocialMediaContentValidationError(`${rawPlatform} platform link cannot be empty.`);
    }
    return [platform, url];
  }));
};

const validatePlanningGate = (values: NormalizedContentPayload['values']): void => {
  const linkPlatforms = Object.keys(values.platformLinks);
  const unselectedLinkPlatforms = linkPlatforms.filter(
    (platform) => !values.targetPlatforms.includes(platform),
  );
  if (unselectedLinkPlatforms.length > 0) {
    throw new SocialMediaContentValidationError(
      `Platform links can only be added for selected target platforms: ${unselectedLinkPlatforms.join(', ')}.`,
    );
  }
  if (!TASK_READY_STATUSES.includes(values.status)) {
    return;
  }
  const missing: string[] = [];
  if (!values.onVideoCaptions) missing.push('on-video captions');
  if (!values.platformCaption) missing.push('platform caption');
  if (values.hashtags.length === 0) missing.push('hashtags');
  if (values.targetPlatforms.length === 0) missing.push('target platforms');
  if (missing.length > 0) {
    throw new SocialMediaContentValidationError(
      `Complete ${missing.join(', ')} before moving this idea to ${values.status.replace('_', ' ')}.`,
    );
  }
  if (
    values.status === 'published' &&
    linkPlatforms.length === 0
  ) {
    throw new SocialMediaContentValidationError(
      'Add at least one published platform link before marking this content as published.',
    );
  }
};

const normalizePayload = (
  bodyValue: unknown,
  existing?: SocialMediaContent,
): NormalizedContentPayload => {
  const body = bodyValue && typeof bodyValue === 'object'
    ? bodyValue as Record<string, unknown>
    : {};
  const bodyOrExisting = (key: string, fallback: unknown): unknown => hasOwn(body, key) ? body[key] : fallback;
  const onVideoCaptions = bodyOrExisting('onVideoCaptions', existing?.onVideoCaptions ?? '');
  const scheduledAt = bodyOrExisting('scheduledAt', existing?.scheduledAt ?? null);
  const publishedAt = bodyOrExisting('publishedAt', existing?.publishedAt ?? null);
  const driveProjectUrl = hasOwn(body, 'driveProjectUrl')
    ? body.driveProjectUrl
    : hasOwn(body, 'driveUrl')
      ? body.driveUrl
      : existing?.driveProjectUrl ?? null;
  const status = normalizeStatus(bodyOrExisting('status', existing?.status ?? 'idea'));

  let thumbnailUrl = existing?.thumbnailUrl ?? null;
  let thumbnailDriveFileId = existing?.thumbnailDriveFileId ?? null;
  let thumbnailOriginalName = existing?.thumbnailOriginalName ?? null;
  let thumbnailMimeType = existing?.thumbnailMimeType ?? null;
  let storedThumbnailToDelete: string | null = null;
  if (hasOwn(body, 'thumbnailUrl')) {
    const rawThumbnailUrl = body.thumbnailUrl;
    const existingInternalUrl = existing?.thumbnailDriveFileId
      ? `/api/social-media/content/${existing.id}/thumbnail`
      : null;
    if (typeof rawThumbnailUrl === 'string' && rawThumbnailUrl.trim().startsWith('/api/')) {
      if (!existingInternalUrl || rawThumbnailUrl.trim() !== existingInternalUrl) {
        throw new SocialMediaContentValidationError('Internal thumbnail URLs cannot be assigned manually.');
      }
      thumbnailUrl = existingInternalUrl;
    } else {
      thumbnailUrl = normalizeUrl(rawThumbnailUrl, 'Thumbnail URL');
      storedThumbnailToDelete = thumbnailDriveFileId;
      thumbnailDriveFileId = null;
      thumbnailOriginalName = null;
      thumbnailMimeType = null;
    }
  }

  const values: NormalizedContentPayload['values'] = {
    title: normalizeRequiredText(bodyOrExisting('title', existing?.title), 'Title', 180),
    idea: normalizeRequiredText(bodyOrExisting('idea', existing?.idea), 'Idea'),
    onVideoCaptions: normalizeOptionalText(onVideoCaptions, 'On-video captions'),
    platformCaption: normalizeOptionalText(
      bodyOrExisting('platformCaption', existing?.platformCaption ?? ''),
      'Platform caption',
      10_000,
    ),
    hashtags: normalizeStringList(bodyOrExisting('hashtags', existing?.hashtags ?? []), 'Hashtags', {
      hashtag: true,
      maxItems: 30,
    }),
    targetPlatforms: normalizeStringList(
      bodyOrExisting('targetPlatforms', existing?.targetPlatforms ?? []),
      'Target platforms',
      { maxItems: 12 },
    ),
    status,
    scheduledAt: normalizeDateOnly(scheduledAt, 'Scheduled date'),
    publishedAt: normalizeDate(publishedAt, 'Published date'),
    driveProjectUrl: normalizeUrl(driveProjectUrl, 'Drive project file or folder URL'),
    platformLinks: normalizePlatformLinks(bodyOrExisting('platformLinks', existing?.platformLinks ?? {})),
    thumbnailUrl,
    thumbnailDriveFileId,
    thumbnailOriginalName,
    thumbnailMimeType,
    archivedAt: status === 'archived' ? existing?.archivedAt ?? new Date() : null,
  };
  if (values.status === 'published' && !values.publishedAt) {
    values.publishedAt = new Date();
  }
  validatePlanningGate(values);
  return { values, storedThumbnailToDelete };
};

const displayName = (user?: UserSummary | null): string | null => {
  if (!user) return null;
  return `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.username || null;
};

const isoDate = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export const isSocialMediaContentTaskReady = (content: Pick<SocialMediaContent, 'status'>): boolean =>
  TASK_READY_STATUSES.includes(content.status);

export const serializeSocialMediaContent = (content: SocialMediaContent) => ({
  id: content.id,
  title: content.title,
  idea: content.idea,
  onVideoCaptions: content.onVideoCaptions,
  platformCaption: content.platformCaption,
  hashtags: Array.isArray(content.hashtags) ? content.hashtags : [],
  targetPlatforms: Array.isArray(content.targetPlatforms) ? content.targetPlatforms : [],
  status: content.status,
  scheduledAt: content.scheduledAt ?? null,
  productionStartedAt: isoDate(content.productionStartedAt),
  readyAt: isoDate(content.readyAt),
  publishedAt: isoDate(content.publishedAt),
  driveProjectUrl: content.driveProjectUrl,
  platformLinks: content.platformLinks && typeof content.platformLinks === 'object' ? content.platformLinks : {},
  thumbnailUrl: content.thumbnailUrl,
  assets: (content.assets ?? []).map((asset) => ({
    id: asset.id,
    contentId: asset.contentId,
    kind: asset.kind,
    originalName: asset.originalName,
    mimeType: asset.mimeType,
    sizeBytes: Number(asset.sizeBytes),
    webViewUrl: asset.webViewUrl,
    uploadedBy: asset.uploadedBy,
    createdAt: isoDate(asset.createdAt),
    updatedAt: isoDate(asset.updatedAt),
  })),
  archivedAt: isoDate(content.archivedAt),
  createdBy: content.createdBy,
  updatedBy: content.updatedBy,
  publishedBy: content.publishedBy,
  publishedTaskLogId: content.publishedTaskLogId,
  createdByName: displayName(content.createdByUser as UserSummary | null | undefined),
  updatedByName: displayName(content.updatedByUser as UserSummary | null | undefined),
  createdAt: isoDate(content.createdAt),
  updatedAt: isoDate(content.updatedAt),
});

export const loadSocialMediaContent = (id: number): Promise<SocialMediaContent | null> =>
  SocialMediaContent.findByPk(id, { include: CONTENT_INCLUDE });

const parseId = (value: unknown): number => {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new SocialMediaContentValidationError('Content ID must be a positive integer.');
  }
  return id;
};

const respondError = (res: Response, error: unknown, fallback: string): void => {
  if (
    error instanceof SocialMediaContentValidationError ||
    error instanceof SocialMediaThumbnailValidationError
  ) {
    res.status(400).json({ message: error.message });
    return;
  }
  logger.error(`${fallback}: ${error instanceof Error ? error.message : String(error)}`);
  res.status(500).json({ message: fallback });
};

const safelyDeleteStoredThumbnail = async (fileId: string | null): Promise<void> => {
  if (!fileId) return;
  try {
    await deleteSocialMediaThumbnail(fileId);
  } catch (error) {
    logger.warn(`Unable to delete a replaced Social Media thumbnail: ${(error as Error).message}`);
  }
};

export const listSocialMediaContent = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const platform = typeof req.query.platform === 'string'
      ? req.query.platform.trim().toLowerCase().replace(/[\s-]+/gu, '_')
      : '';
    const statusQuery = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    const includeArchived = String(req.query.includeArchived ?? '').toLowerCase() === 'true';
    const where: Record<PropertyKey, unknown> = {};

    if (statusQuery && statusQuery !== 'all') {
      where.status = normalizeStatus(statusQuery);
    } else if (!includeArchived) {
      where.status = { [Op.ne]: 'archived' };
    }
    if (platform) {
      where.targetPlatforms = { [Op.contains]: [platform] };
    }
    if (search) {
      where[Op.or] = [
        { title: { [Op.iLike]: `%${search}%` } },
        { idea: { [Op.iLike]: `%${search}%` } },
        { platformCaption: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const rows = await SocialMediaContent.findAll({
      where,
      include: CONTENT_INCLUDE,
      order: [['updatedAt', 'DESC'], ['id', 'DESC']],
    });
    rows.sort((left, right) => {
      const statusDifference = (STATUS_ORDER.get(left.status) ?? 99) - (STATUS_ORDER.get(right.status) ?? 99);
      if (statusDifference !== 0) return statusDifference;
      const leftSchedule = left.scheduledAt
        ? Date.parse(`${left.scheduledAt}T00:00:00.000Z`)
        : Number.MAX_SAFE_INTEGER;
      const rightSchedule = right.scheduledAt
        ? Date.parse(`${right.scheduledAt}T00:00:00.000Z`)
        : Number.MAX_SAFE_INTEGER;
      if (leftSchedule !== rightSchedule) return leftSchedule - rightSchedule;
      return right.updatedAt.getTime() - left.updatedAt.getTime();
    });

    const counts = Object.fromEntries(SOCIAL_MEDIA_CONTENT_STATUSES.map((status) => [status, 0])) as Record<
      SocialMediaContentStatus,
      number
    >;
    for (const row of rows) counts[row.status] += 1;
    res.status(200).json({ items: rows.map(serializeSocialMediaContent), counts, total: rows.length });
  } catch (error) {
    respondError(res, error, 'Failed to load Social Media content.');
  }
};

export const listSelectableSocialMediaContent = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const where: Record<PropertyKey, unknown> = { status: { [Op.ne]: 'archived' } };
    if (search) {
      where[Op.or] = [
        { title: { [Op.iLike]: `%${search}%` } },
        { idea: { [Op.iLike]: `%${search}%` } },
      ];
    }
    const rows = await SocialMediaContent.findAll({
      where,
      attributes: [
        'id',
        'title',
        'idea',
        'status',
        'targetPlatforms',
        'thumbnailUrl',
        'scheduledAt',
        'updatedAt',
      ],
      order: [['updatedAt', 'DESC']],
    });
    res.status(200).json({
      items: rows.map((row) => ({
        id: row.id,
        title: row.title,
        idea: row.idea,
        status: row.status,
        targetPlatforms: Array.isArray(row.targetPlatforms) ? row.targetPlatforms : [],
        thumbnailUrl: row.thumbnailUrl,
        scheduledAt: row.scheduledAt ?? null,
        isTaskReady: isSocialMediaContentTaskReady(row),
      })),
    });
  } catch (error) {
    respondError(res, error, 'Failed to load selectable Social Media content.');
  }
};

export const getSocialMediaContent = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const content = await loadSocialMediaContent(parseId(req.params.id));
    if (!content) {
      res.status(404).json({ message: 'Social Media content was not found.' });
      return;
    }
    res.status(200).json({ item: serializeSocialMediaContent(content) });
  } catch (error) {
    respondError(res, error, 'Failed to load Social Media content.');
  }
};

export const createSocialMediaContent = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const actorId = req.authContext?.id ?? null;
    const body = req.body && typeof req.body === 'object'
      ? req.body as Record<string, unknown>
      : {};
    const { values } = normalizePayload({
      ...body,
      targetPlatforms: DEFAULT_TARGET_PLATFORMS,
      status: 'idea',
      scheduledAt: null,
      publishedAt: null,
      driveProjectUrl: null,
      platformLinks: {},
    });
    const created = await SocialMediaContent.create({
      ...values,
      createdBy: actorId,
      updatedBy: actorId,
    });
    const content = await loadSocialMediaContent(created.id) ?? created;
    res.status(201).json({ item: serializeSocialMediaContent(content) });
  } catch (error) {
    respondError(res, error, 'Failed to create Social Media content.');
  }
};

export const updateSocialMediaContent = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const content = await loadSocialMediaContent(parseId(req.params.id));
    if (!content) {
      res.status(404).json({ message: 'Social Media content was not found.' });
      return;
    }
    if (content.status === 'published' || content.publishedAt || content.publishedTaskLogId) {
      throw new SocialMediaContentValidationError(
        'Published Social Media content cannot be edited because its brief is part of the completed task audit.',
      );
    }
    const body = req.body && typeof req.body === 'object'
      ? req.body as Record<string, unknown>
      : {};
    const controlledField = Object.keys(body).find((key) => WORKFLOW_CONTROLLED_FIELDS.has(key));
    if (controlledField) {
      throw new SocialMediaContentValidationError(
        'Use the guided workflow actions to change stage, dates, Drive folder, or publication links.',
      );
    }
    const { values, storedThumbnailToDelete } = normalizePayload(req.body, content);
    await content.update({ ...values, updatedBy: req.authContext?.id ?? null });
    await safelyDeleteStoredThumbnail(storedThumbnailToDelete);
    const updated = await loadSocialMediaContent(content.id) ?? content;
    res.status(200).json({ item: serializeSocialMediaContent(updated) });
  } catch (error) {
    respondError(res, error, 'Failed to update Social Media content.');
  }
};

export const archiveSocialMediaContent = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const content = await loadSocialMediaContent(parseId(req.params.id));
    if (!content) {
      res.status(404).json({ message: 'Social Media content was not found.' });
      return;
    }
    if (content.status !== 'archived') {
      await content.update({
        status: 'archived',
        archivedAt: new Date(),
        updatedBy: req.authContext?.id ?? null,
      });
    }
    const archived = await loadSocialMediaContent(content.id) ?? content;
    res.status(200).json({ item: serializeSocialMediaContent(archived) });
  } catch (error) {
    respondError(res, error, 'Failed to archive Social Media content.');
  }
};

export const uploadSocialMediaThumbnail = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  let newlyUploadedFileId: string | null = null;
  try {
    const content = await loadSocialMediaContent(parseId(req.params.id));
    if (!content) {
      res.status(404).json({ message: 'Social Media content was not found.' });
      return;
    }
    if (!req.file) {
      throw new SocialMediaContentValidationError('Choose a thumbnail file to upload.');
    }
    if (!THUMBNAIL_MIME_TYPES.has(req.file.mimetype.toLowerCase())) {
      throw new SocialMediaContentValidationError('Only JPG, PNG, WEBP, and GIF thumbnails are supported.');
    }
    const previousFileId = content.thumbnailDriveFileId;
    const stored = await storeSocialMediaThumbnail({
      contentId: content.id,
      title: content.title,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      data: req.file.buffer,
    });
    newlyUploadedFileId = stored.driveFileId;
    await content.update({
      thumbnailDriveFileId: stored.driveFileId,
      thumbnailUrl: stored.thumbnailUrl,
      thumbnailOriginalName: stored.originalName,
      thumbnailMimeType: stored.mimeType,
      updatedBy: req.authContext?.id ?? null,
    });
    newlyUploadedFileId = null;
    if (previousFileId && previousFileId !== stored.driveFileId) {
      await safelyDeleteStoredThumbnail(previousFileId);
    }
    const updated = await loadSocialMediaContent(content.id) ?? content;
    res.status(200).json({ item: serializeSocialMediaContent(updated) });
  } catch (error) {
    await safelyDeleteStoredThumbnail(newlyUploadedFileId);
    respondError(res, error, 'Failed to upload the Social Media thumbnail.');
  }
};

export const removeSocialMediaThumbnail = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const content = await loadSocialMediaContent(parseId(req.params.id));
    if (!content) {
      res.status(404).json({ message: 'Social Media content was not found.' });
      return;
    }
    const storedFileId = content.thumbnailDriveFileId;
    await content.update({
      thumbnailDriveFileId: null,
      thumbnailUrl: null,
      thumbnailOriginalName: null,
      thumbnailMimeType: null,
      updatedBy: req.authContext?.id ?? null,
    });
    await safelyDeleteStoredThumbnail(storedFileId);
    const updated = await loadSocialMediaContent(content.id) ?? content;
    res.status(200).json({ item: serializeSocialMediaContent(updated) });
  } catch (error) {
    respondError(res, error, 'Failed to remove the Social Media thumbnail.');
  }
};

export const streamSocialMediaThumbnail = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const content = await SocialMediaContent.findByPk(parseId(req.params.id), {
      attributes: ['id', 'thumbnailDriveFileId'],
    });
    if (!content?.thumbnailDriveFileId) {
      res.status(404).json({ message: 'Thumbnail was not found.' });
      return;
    }
    const { stream, mimeType } = await openSocialMediaThumbnailStream(content.thumbnailDriveFileId);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    stream.on('error', () => {
      if (!res.headersSent) {
        res.status(500).json({ message: 'Unable to read the Social Media thumbnail.' });
      } else {
        res.end();
      }
    });
    stream.pipe(res);
  } catch (error) {
    if (error instanceof SocialMediaThumbnailUnsafeContentError) {
      res.status(415).json({ message: error.message });
      return;
    }
    const code = (error as { code?: number })?.code;
    if (code === 404) {
      res.status(404).json({ message: 'Thumbnail was not found.' });
      return;
    }
    respondError(res, error, 'Failed to load the Social Media thumbnail.');
  }
};
