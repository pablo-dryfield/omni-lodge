import { promises as fs } from 'fs';
import path from 'path';
import type { Response } from 'express';
import { UniqueConstraintError, type Transaction } from 'sequelize';
import SocialMediaContent from '../models/SocialMediaContent.js';
import SocialMediaContentAsset, {
  SOCIAL_MEDIA_CONTENT_ASSET_KINDS,
  type SocialMediaContentAssetKind,
} from '../models/SocialMediaContentAsset.js';
import {
  loadSocialMediaContent,
  serializeSocialMediaContent,
} from './socialMediaContentController.js';
import {
  deleteSocialMediaAsset,
  ensureSocialMediaProjectFolder,
  SocialMediaAssetStorageValidationError,
  storeSocialMediaAsset,
} from '../services/socialMediaAssetStorageService.js';
import {
  completeTaskForSocialMediaPublication,
  SocialMediaPublishTaskConflictError,
  type SocialMediaTaskCompletionResult,
} from '../services/socialMediaPublishTaskService.js';
import {
  finalizeSocialMediaResumableUpload,
  initiateSocialMediaResumableUpload,
} from '../services/socialMediaResumableUploadService.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import logger from '../utils/logger.js';

const REQUIRED_ASSET_KINDS = new Set<SocialMediaContentAssetKind>([
  'final_video',
  'raw_material',
  'project_file',
]);
const BLOCKED_UPLOAD_EXTENSIONS = new Set([
  '.bat', '.cmd', '.com', '.cpl', '.exe', '.hta', '.html', '.htm', '.js', '.jse',
  '.msi', '.msp', '.pif', '.ps1', '.scr', '.svg', '.vbs', '.vbe', '.wsf',
]);
const FINAL_VIDEO_EXTENSIONS = new Set([
  '.avi', '.m4v', '.mkv', '.mov', '.mp4', '.mpeg', '.mpg', '.webm',
]);
const FINAL_VIDEO_UNIQUE_INDEX = 'social_media_content_assets_one_final_video_uq';

class SocialMediaWorkflowError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

const parseId = (value: unknown, label = 'Content ID'): number => {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new SocialMediaWorkflowError(`${label} must be a positive integer.`);
  }
  return id;
};

const requireActorId = (req: AuthenticatedRequest): number => {
  const actorId = req.authContext?.id;
  if (!actorId) throw new SocialMediaWorkflowError('Authentication is required.', 401);
  return actorId;
};

const parseDateOnly = (value: unknown): string => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(normalized)) {
    throw new SocialMediaWorkflowError('Choose a valid planned date.');
  }
  const [year, month, day] = normalized.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    throw new SocialMediaWorkflowError('Choose a valid planned date.');
  }
  return normalized;
};

const normalizeUrl = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new SocialMediaWorkflowError(`${label} is required.`);
  }
  const normalized = value.trim();
  try {
    const parsed = new URL(normalized);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Unsupported protocol');
  } catch {
    throw new SocialMediaWorkflowError(`${label} must be a valid http or https URL.`);
  }
  if (normalized.length > 4096) {
    throw new SocialMediaWorkflowError(`${label} cannot be longer than 4096 characters.`);
  }
  return normalized;
};

const normalizePublishLinks = (value: unknown): Record<string, string> => {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    instagram: normalizeUrl(source.instagram, 'Instagram link'),
    tiktok: normalizeUrl(source.tiktok, 'TikTok link'),
  };
};

const assertPlanningBrief = (content: SocialMediaContent): void => {
  const missing = [
    !content.onVideoCaptions?.trim() ? 'on-video captions' : null,
    !content.platformCaption?.trim() ? 'platform caption' : null,
    !Array.isArray(content.hashtags) || content.hashtags.length === 0 ? 'hashtags' : null,
  ].filter((value): value is string => Boolean(value));
  if (missing.length > 0) {
    throw new SocialMediaWorkflowError(
      `Complete ${missing.join(', ')} before moving this idea to Planned.`,
    );
  }
};

const assertStatus = (
  content: SocialMediaContent,
  expected: SocialMediaContent['status'],
  action: string,
): void => {
  if (content.status !== expected) {
    throw new SocialMediaWorkflowError(
      `Only ${expected.replace('_', ' ')} content can ${action}. Refresh the board and try again.`,
      409,
    );
  }
};

const isFinalVideoUniqueConflict = (error: unknown): boolean => {
  if (!(error instanceof UniqueConstraintError)) return false;
  const databaseError = error as UniqueConstraintError & {
    parent?: { constraint?: string };
    original?: { constraint?: string };
  };
  const constraint = databaseError.parent?.constraint ?? databaseError.original?.constraint;
  // Some Sequelize dialect/test adapters omit the originating constraint. A
  // unique error while inserting a final video is still safest to present as
  // the single-final-video conflict instead of leaking a database error.
  return !constraint || constraint === FINAL_VIDEO_UNIQUE_INDEX;
};

const loadLockedContent = async (
  contentId: number,
  transaction: Transaction,
): Promise<SocialMediaContent> => {
  const content = await SocialMediaContent.findByPk(contentId, {
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (!content) throw new SocialMediaWorkflowError('Social Media content was not found.', 404);
  return content;
};

const requireSequelize = () => {
  if (!SocialMediaContent.sequelize) {
    throw new SocialMediaWorkflowError('Database connection is unavailable.', 500);
  }
  return SocialMediaContent.sequelize;
};

const respondWithItem = async (res: Response, contentId: number): Promise<void> => {
  const content = await loadSocialMediaContent(contentId);
  if (!content) throw new SocialMediaWorkflowError('Social Media content was not found.', 404);
  res.status(200).json({ item: serializeSocialMediaContent(content) });
};

const respondError = (res: Response, error: unknown, fallback: string): void => {
  if (
    error instanceof SocialMediaWorkflowError
    || error instanceof SocialMediaAssetStorageValidationError
    || error instanceof SocialMediaPublishTaskConflictError
  ) {
    const status = error instanceof SocialMediaWorkflowError
      ? error.status
      : error instanceof SocialMediaPublishTaskConflictError
        ? 409
        : 400;
    res.status(status).json({ message: error.message });
    return;
  }
  logger.error(`${fallback}: ${error instanceof Error ? error.message : String(error)}`);
  res.status(500).json({ message: fallback });
};

export const planSocialMediaContent = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const contentId = parseId(req.params.id);
    const actorId = requireActorId(req);
    const scheduledAt = parseDateOnly(req.body?.scheduledDate);
    await requireSequelize().transaction(async (transaction) => {
      const content = await loadLockedContent(contentId, transaction);
      if (content.status === 'planned' && content.scheduledAt === scheduledAt) {
        return;
      }
      assertStatus(content, 'idea', 'be planned');
      assertPlanningBrief(content);
      await content.update({
        status: 'planned',
        scheduledAt,
        updatedBy: actorId,
      }, { transaction });
    });
    await respondWithItem(res, contentId);
  } catch (error) {
    respondError(res, error, 'Failed to plan the Social Media idea.');
  }
};

export const startSocialMediaProduction = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const contentId = parseId(req.params.id);
    const actorId = requireActorId(req);
    await requireSequelize().transaction(async (transaction) => {
      const content = await loadLockedContent(contentId, transaction);
      if (content.status === 'in_production') {
        return;
      }
      assertStatus(content, 'planned', 'start production');
      await content.update({
        status: 'in_production',
        productionStartedAt: new Date(),
        updatedBy: actorId,
      }, { transaction });
    });
    await respondWithItem(res, contentId);
  } catch (error) {
    respondError(res, error, 'Failed to start Social Media production.');
  }
};

export const createSocialMediaProjectFolder = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const contentId = parseId(req.params.id);
    const actorId = requireActorId(req);
    await requireSequelize().transaction(async (transaction) => {
      const content = await loadLockedContent(contentId, transaction);
      assertStatus(content, 'in_production', 'create a project folder');
      // Keep the content row locked while Drive resolves/creates the stable
      // folder. That serializes this external side effect with Ready/publish
      // transitions and concurrent folder requests.
      const folder = await ensureSocialMediaProjectFolder({
        contentId,
        title: content.title,
        existingFolderId: content.driveProjectFolderId,
      });
      await content.update({
        driveProjectFolderId: folder.folderId,
        driveProjectUrl: folder.driveProjectUrl,
        updatedBy: actorId,
      }, { transaction });
    });
    await respondWithItem(res, contentId);
  } catch (error) {
    respondError(res, error, 'Failed to create the Social Media Drive folder.');
  }
};

const validateAssetFile = (
  file: Express.Multer.File,
  kind: SocialMediaContentAssetKind,
): void => {
  if (!file.path || !file.size) {
    throw new SocialMediaWorkflowError('Choose a non-empty file to upload.');
  }
  const extension = path.extname(file.originalname).toLowerCase();
  if (BLOCKED_UPLOAD_EXTENSIONS.has(extension)) {
    throw new SocialMediaWorkflowError('That file type is not allowed in Social Media projects.');
  }
  if (
    kind === 'final_video'
    && !file.mimetype.toLowerCase().startsWith('video/')
    && !FINAL_VIDEO_EXTENSIONS.has(extension)
  ) {
    throw new SocialMediaWorkflowError('The final video must be a supported video file.');
  }
};

type AssetUploadMetadata = {
  kind: SocialMediaContentAssetKind;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
};

const parseAssetUploadMetadata = (body: unknown): AssetUploadMetadata => {
  const source = body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
  const kind = typeof source.assetType === 'string'
    ? source.assetType.trim() as SocialMediaContentAssetKind
    : '' as SocialMediaContentAssetKind;
  if (!SOCIAL_MEDIA_CONTENT_ASSET_KINDS.includes(kind)) {
    throw new SocialMediaWorkflowError('Choose a valid asset type.');
  }
  const originalName = typeof source.originalName === 'string' ? source.originalName.trim() : '';
  if (!originalName) throw new SocialMediaWorkflowError('The file name is required.');
  const mimeType = typeof source.mimeType === 'string'
    ? source.mimeType.trim().slice(0, 255)
    : '';
  const sizeBytes = Number(source.sizeBytes);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    throw new SocialMediaWorkflowError('Choose a non-empty file to upload.');
  }
  if (sizeBytes > 2 * 1024 * 1024 * 1024) {
    throw new SocialMediaWorkflowError('Social Media files cannot be larger than 2 GB.');
  }
  const extension = path.extname(originalName).toLowerCase();
  if (BLOCKED_UPLOAD_EXTENSIONS.has(extension)) {
    throw new SocialMediaWorkflowError('That file type is not allowed in Social Media projects.');
  }
  if (
    kind === 'final_video'
    && !mimeType.toLowerCase().startsWith('video/')
    && !FINAL_VIDEO_EXTENSIONS.has(extension)
  ) {
    throw new SocialMediaWorkflowError('The final video must be a supported video file.');
  }
  return {
    kind,
    originalName,
    mimeType: mimeType || 'application/octet-stream',
    sizeBytes,
  };
};

const assertFinalVideoAvailable = async (
  contentId: number,
  kind: SocialMediaContentAssetKind,
  transaction: Transaction,
): Promise<void> => {
  if (kind !== 'final_video') return;
  const existingFinal = await SocialMediaContentAsset.findOne({
    where: { contentId, kind: 'final_video' },
    transaction,
  });
  if (existingFinal) {
    throw new SocialMediaWorkflowError(
      'A final video is already uploaded. Remove it before uploading a replacement.',
      409,
    );
  }
};

const assertRegisteredAssetMatches = (
  existing: SocialMediaContentAsset,
  stored: Awaited<ReturnType<typeof finalizeSocialMediaResumableUpload>>,
  expectedKind: SocialMediaContentAssetKind,
): void => {
  if (
    existing.kind !== expectedKind
    || existing.originalName !== stored.originalName
    || existing.mimeType !== stored.mimeType
    || Number(existing.sizeBytes) !== stored.sizeBytes
  ) {
    throw new SocialMediaWorkflowError(
      'This Google Drive file is already registered with different upload metadata.',
      409,
    );
  }
};

export const initiateSocialMediaAssetUpload = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const contentId = parseId(req.params.id);
    requireActorId(req);
    const metadata = parseAssetUploadMetadata(req.body);
    const result = await requireSequelize().transaction(async (transaction) => {
      const content = await loadLockedContent(contentId, transaction);
      assertStatus(content, 'in_production', 'receive production assets');
      if (!content.driveProjectFolderId || !content.driveProjectUrl) {
        throw new SocialMediaWorkflowError('Create the Drive project folder before uploading assets.');
      }
      await assertFinalVideoAvailable(contentId, metadata.kind, transaction);
      return initiateSocialMediaResumableUpload({
        contentId,
        title: content.title,
        folderId: content.driveProjectFolderId,
        kind: metadata.kind,
        originalName: metadata.originalName,
        mimeType: metadata.mimeType,
        sizeBytes: metadata.sizeBytes,
      });
    });
    res.setHeader('Cache-Control', 'no-store');
    res.status(201).json(result);
  } catch (error) {
    respondError(res, error, 'Failed to start the Social Media asset upload.');
  }
};

export const finalizeSocialMediaAssetUpload = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  let driveFileIdToClean: string | null = null;
  try {
    const contentId = parseId(req.params.id);
    const actorId = requireActorId(req);
    const metadata = parseAssetUploadMetadata(req.body);
    const driveFileId = typeof req.body?.driveFileId === 'string'
      ? req.body.driveFileId.trim()
      : '';
    const uploadToken = typeof req.body?.uploadToken === 'string'
      ? req.body.uploadToken.trim()
      : '';
    if (!driveFileId || !uploadToken) {
      throw new SocialMediaWorkflowError('The resumable upload receipt is incomplete.');
    }

    try {
      await requireSequelize().transaction(async (transaction) => {
        const content = await loadLockedContent(contentId, transaction);
        if (!content.driveProjectFolderId || !content.driveProjectUrl) {
          throw new SocialMediaWorkflowError('Create the Drive project folder before uploading assets.');
        }
        const stored = await finalizeSocialMediaResumableUpload({
          contentId,
          title: content.title,
          folderId: content.driveProjectFolderId,
          kind: metadata.kind,
          originalName: metadata.originalName,
          mimeType: metadata.mimeType,
          sizeBytes: metadata.sizeBytes,
          driveFileId,
          uploadToken,
        });
        // Verify the private Drive receipt before considering a retry
        // idempotent. The lookup is also inside the parent row lock so two
        // concurrent completions cannot both miss it.
        const existing = await SocialMediaContentAsset.findOne({
          where: { contentId, driveFileId },
          transaction,
        });
        if (existing) {
          assertRegisteredAssetMatches(existing, stored, metadata.kind);
          return;
        }
        driveFileIdToClean = stored.driveFileId;
        assertStatus(content, 'in_production', 'receive production assets');
        await assertFinalVideoAvailable(contentId, metadata.kind, transaction);
        await SocialMediaContentAsset.create({
          contentId,
          kind: metadata.kind,
          originalName: stored.originalName,
          mimeType: stored.mimeType,
          sizeBytes: stored.sizeBytes,
          driveFileId: stored.driveFileId,
          webViewUrl: stored.webViewUrl,
          uploadedBy: actorId,
        }, { transaction });
        await content.update({ updatedBy: actorId }, { transaction });
      });
    } catch (error) {
      if (metadata.kind === 'final_video' && isFinalVideoUniqueConflict(error)) {
        throw new SocialMediaWorkflowError(
          'A final video is already uploaded. Remove it before uploading a replacement.',
          409,
        );
      }
      throw error;
    }
    driveFileIdToClean = null;
    await respondWithItem(res, contentId);
  } catch (error) {
    if (driveFileIdToClean) {
      try {
        await deleteSocialMediaAsset(driveFileIdToClean);
      } catch (cleanupError) {
        logger.warn(
          `Unable to remove an unregistered resumable Social Media upload: ${
            cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
          }`,
        );
      }
    }
    respondError(res, error, 'Failed to finish the Social Media asset upload.');
  }
};

export const uploadSocialMediaAsset = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  let uploadedDriveFileId: string | null = null;
  const tempPath = req.file?.path ?? null;
  try {
    const contentId = parseId(req.params.id);
    const actorId = requireActorId(req);
    const kind = typeof req.body?.assetType === 'string'
      ? req.body.assetType.trim() as SocialMediaContentAssetKind
      : '' as SocialMediaContentAssetKind;
    if (!SOCIAL_MEDIA_CONTENT_ASSET_KINDS.includes(kind)) {
      throw new SocialMediaWorkflowError('Choose a valid asset type.');
    }
    const uploadFile = req.file;
    if (!uploadFile) throw new SocialMediaWorkflowError('Choose a file to upload.');
    validateAssetFile(uploadFile, kind);

    try {
      await requireSequelize().transaction(async (transaction) => {
        const content = await loadLockedContent(contentId, transaction);
        assertStatus(content, 'in_production', 'receive production assets');
        if (!content.driveProjectFolderId || !content.driveProjectUrl) {
          throw new SocialMediaWorkflowError('Create the Drive project folder before uploading assets.');
        }
        if (kind === 'final_video') {
          const existingFinal = await SocialMediaContentAsset.findOne({
            where: { contentId, kind: 'final_video' },
            transaction,
          });
          if (existingFinal) {
            throw new SocialMediaWorkflowError(
              'A final video is already uploaded. Remove it before uploading a replacement.',
              409,
            );
          }
        }

        // Keep the parent row lock through the streamed upload and metadata
        // insert so Ready cannot race past an in-flight upload.
        const stored = await storeSocialMediaAsset({
          contentId,
          title: content.title,
          folderId: content.driveProjectFolderId,
          kind,
          tempPath: uploadFile.path,
          originalName: uploadFile.originalname,
          mimeType: uploadFile.mimetype,
          sizeBytes: uploadFile.size,
        });
        uploadedDriveFileId = stored.driveFileId;
        await SocialMediaContentAsset.create({
          contentId,
          kind,
          originalName: stored.originalName,
          mimeType: stored.mimeType,
          sizeBytes: stored.sizeBytes,
          driveFileId: stored.driveFileId,
          webViewUrl: stored.webViewUrl,
          uploadedBy: actorId,
        }, { transaction });
        await content.update({ updatedBy: actorId }, { transaction });
      });
    } catch (error) {
      if (kind === 'final_video' && isFinalVideoUniqueConflict(error)) {
        throw new SocialMediaWorkflowError(
          'A final video is already uploaded. Remove it before uploading a replacement.',
          409,
        );
      }
      throw error;
    }
    uploadedDriveFileId = null;
    await respondWithItem(res, contentId);
  } catch (error) {
    if (uploadedDriveFileId) {
      try {
        await deleteSocialMediaAsset(uploadedDriveFileId);
      } catch (cleanupError) {
        logger.warn(`Unable to remove a failed Social Media Drive upload: ${(cleanupError as Error).message}`);
      }
    }
    respondError(res, error, 'Failed to upload the Social Media asset.');
  } finally {
    if (tempPath) {
      try {
        await fs.unlink(tempPath);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') logger.warn(`Unable to remove Social Media upload temp file: ${(error as Error).message}`);
      }
    }
  }
};

export const removeSocialMediaAsset = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  let driveFileIdToDelete: string | null = null;
  try {
    const contentId = parseId(req.params.id);
    const assetId = parseId(req.params.assetId, 'Asset ID');
    const actorId = requireActorId(req);
    await requireSequelize().transaction(async (transaction) => {
      const content = await loadLockedContent(contentId, transaction);
      assertStatus(content, 'in_production', 'remove production assets');
      const asset = await SocialMediaContentAsset.findOne({
        where: { id: assetId, contentId },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!asset) throw new SocialMediaWorkflowError('Social Media asset was not found.', 404);
      driveFileIdToDelete = asset.driveFileId;
      // Commit metadata removal first. If Drive cleanup later fails the only
      // inconsistency is an unreferenced orphan, never a DB row pointing to a
      // file that has already disappeared.
      await asset.destroy({ transaction });
      await content.update({ updatedBy: actorId }, { transaction });
    });
    if (driveFileIdToDelete) {
      try {
        await deleteSocialMediaAsset(driveFileIdToDelete);
      } catch (cleanupError) {
        logger.warn(
          `Unable to remove orphaned Social Media Drive asset ${driveFileIdToDelete}: ${
            cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
          }`,
        );
      }
    }
    await respondWithItem(res, contentId);
  } catch (error) {
    respondError(res, error, 'Failed to remove the Social Media asset.');
  }
};

export const markSocialMediaReady = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const contentId = parseId(req.params.id);
    const actorId = requireActorId(req);
    await requireSequelize().transaction(async (transaction) => {
      const content = await loadLockedContent(contentId, transaction);
      if (content.status === 'ready') {
        return;
      }
      assertStatus(content, 'in_production', 'be marked ready');
      if (!content.driveProjectFolderId || !content.driveProjectUrl) {
        throw new SocialMediaWorkflowError('Create the Drive project folder before marking this content ready.');
      }
      const assets = await SocialMediaContentAsset.findAll({
        where: { contentId },
        attributes: ['kind'],
        transaction,
        lock: transaction.LOCK.SHARE,
      });
      const availableKinds = new Set(assets.map((asset) => asset.kind));
      const missing = Array.from(REQUIRED_ASSET_KINDS).filter((kind) => !availableKinds.has(kind));
      if (missing.length > 0) {
        throw new SocialMediaWorkflowError(
          `Upload ${missing.map((kind) => kind.replace('_', ' ')).join(', ')} before marking this content ready.`,
        );
      }
      await content.update({
        status: 'ready',
        readyAt: new Date(),
        updatedBy: actorId,
      }, { transaction });
    });
    await respondWithItem(res, contentId);
  } catch (error) {
    respondError(res, error, 'Failed to mark the Social Media content ready.');
  }
};

export const publishSocialMediaContent = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const contentId = parseId(req.params.id);
    const actorId = requireActorId(req);
    const platformLinks = normalizePublishLinks(req.body?.platformLinks);
    let taskCompletion: SocialMediaTaskCompletionResult | null = null;
    await requireSequelize().transaction(async (transaction) => {
      const content = await SocialMediaContent.findByPk(contentId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!content) throw new SocialMediaWorkflowError('Social Media content was not found.', 404);

      if (content.status === 'published') {
        if (
          content.publishedBy !== actorId
          || content.platformLinks?.instagram !== platformLinks.instagram
          || content.platformLinks?.tiktok !== platformLinks.tiktok
        ) {
          throw new SocialMediaWorkflowError('This content has already been published.', 409);
        }
        taskCompletion = await completeTaskForSocialMediaPublication({
          content,
          actorId,
          publishedAt: content.publishedAt ?? new Date(),
          platformLinks,
          transaction,
        });
        return;
      }

      assertStatus(content, 'ready', 'be published');
      const publishedAt = new Date();
      taskCompletion = await completeTaskForSocialMediaPublication({
        content,
        actorId,
        publishedAt,
        platformLinks,
        transaction,
      });
      await content.update({
        status: 'published',
        publishedAt,
        publishedBy: actorId,
        publishedTaskLogId: taskCompletion.taskLogId,
        platformLinks,
        updatedBy: actorId,
      }, { transaction });
    });
    const content = await loadSocialMediaContent(contentId);
    if (!content) throw new SocialMediaWorkflowError('Social Media content was not found.', 404);
    res.status(200).json({
      item: serializeSocialMediaContent(content),
      taskCompletion,
    });
  } catch (error) {
    respondError(res, error, 'Failed to publish the Social Media content.');
  }
};
