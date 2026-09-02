import crypto from 'crypto';
import { createReadStream, promises as fs } from 'fs';
import path from 'path';
import {
  SOCIAL_MEDIA_CONTENT_ASSET_KINDS,
  type SocialMediaContentAssetKind,
} from '../models/SocialMediaContentAsset.js';
import logger from '../utils/logger.js';
import slugify from '../utils/slugify.js';
import { getConfigValue } from './configService.js';
import { getDriveClient } from './googleDrive.js';

const SOCIAL_MEDIA_PARENT_CONFIG = 'GOOGLE_DRIVE_SOCIAL_MEDIA_PARENT_ID';
const SCHEDULES_PARENT_CONFIG = 'GOOGLE_DRIVE_SCHEDULES_PARENT_ID';
const SOCIAL_MEDIA_FALLBACK_ROOT = 'Social Media';

const ASSET_FOLDER_NAMES: Record<SocialMediaContentAssetKind, string> = {
  final_video: 'Final Video',
  raw_material: 'Raw Material',
  project_file: 'Project Files',
};

let warnedAboutSchedulesParentFallback = false;

export type EnsureSocialMediaProjectFolderParams = {
  contentId: number;
  title: string;
  existingFolderId?: string | null;
};

export type EnsureSocialMediaProjectFolderResult = {
  folderId: string;
  driveProjectUrl: string;
};

export type StoreSocialMediaAssetParams = {
  contentId: number;
  title: string;
  folderId: string;
  kind: SocialMediaContentAssetKind;
  tempPath: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
};

export type StoreSocialMediaAssetResult = {
  driveFileId: string;
  webViewUrl: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
};

export class SocialMediaAssetStorageValidationError extends Error {}

type DriveClient = Awaited<ReturnType<typeof getDriveClient>>;

const normalizeConfigString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const escapeDriveQueryValue = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const sanitizeFolderName = (value: string): string =>
  value
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'Untitled';

export const sanitizeSocialMediaAssetOriginalName = (value: string): string => {
  const baseName = path.basename(value || 'asset');
  return baseName
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 255) || 'asset';
};

export const buildSocialMediaStoredFileName = (originalName: string): string => {
  const safeOriginalName = sanitizeSocialMediaAssetOriginalName(originalName);
  const parsed = path.parse(safeOriginalName);
  const stem = (slugify(parsed.name) || 'asset').slice(0, 150);
  const extension = parsed.ext.replace(/[^.a-zA-Z0-9_-]/g, '').slice(0, 20);
  const suffix = crypto.randomUUID().slice(0, 8);
  return `${stem}-${Date.now()}-${suffix}${extension}`;
};

const driveFolderUrl = (folderId: string): string =>
  `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`;

const driveFileUrl = (fileId: string): string =>
  `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;

const assertPositiveContentId = (contentId: number): void => {
  if (!Number.isInteger(contentId) || contentId <= 0) {
    throw new SocialMediaAssetStorageValidationError('Social Media content ID must be a positive integer.');
  }
};

const loadFolder = async (
  drive: DriveClient,
  folderId: string,
): Promise<{ id: string; webViewLink: string | null }> => {
  const normalizedFolderId = folderId.trim();
  if (!normalizedFolderId) {
    throw new SocialMediaAssetStorageValidationError('Google Drive folder ID is required.');
  }

  const response = await drive.files.get({
    fileId: normalizedFolderId,
    fields: 'id,mimeType,trashed,webViewLink',
    supportsAllDrives: true,
  });
  const record = response.data;
  if (
    !record.id ||
    record.trashed === true ||
    record.mimeType !== 'application/vnd.google-apps.folder'
  ) {
    throw new SocialMediaAssetStorageValidationError(
      'The configured Google Drive resource is not an active folder.',
    );
  }

  return { id: record.id, webViewLink: record.webViewLink ?? null };
};

export const ensureGoogleDriveChildFolder = async (
  drive: DriveClient,
  name: string,
  parentId: string,
): Promise<{ id: string; webViewLink: string | null }> => {
  const safeName = sanitizeFolderName(name);
  const existing = await drive.files.list({
    q: [
      `name = '${escapeDriveQueryValue(safeName)}'`,
      "mimeType = 'application/vnd.google-apps.folder'",
      'trashed = false',
      `'${escapeDriveQueryValue(parentId)}' in parents`,
    ].join(' and '),
    fields: 'files(id,webViewLink)',
    pageSize: 1,
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
  });
  const existingFolder = existing.data.files?.[0];
  if (existingFolder?.id) {
    return {
      id: existingFolder.id,
      webViewLink: existingFolder.webViewLink ?? null,
    };
  }

  const created = await drive.files.create({
    requestBody: {
      name: safeName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id,webViewLink',
    supportsAllDrives: true,
  });
  if (!created.data.id) {
    throw new Error(`Google Drive did not return an ID for the ${safeName} folder.`);
  }
  return {
    id: created.data.id,
    webViewLink: created.data.webViewLink ?? null,
  };
};

const resolveSocialMediaRootFolder = async (drive: DriveClient): Promise<string> => {
  const dedicatedParent = normalizeConfigString(getConfigValue(SOCIAL_MEDIA_PARENT_CONFIG));
  if (dedicatedParent) {
    return (await loadFolder(drive, dedicatedParent)).id;
  }

  const schedulesParent = normalizeConfigString(getConfigValue(SCHEDULES_PARENT_CONFIG));
  if (!schedulesParent) {
    throw new Error(
      `Configure ${SOCIAL_MEDIA_PARENT_CONFIG} with a Google Drive folder before creating Social Media projects.`,
    );
  }

  if (!warnedAboutSchedulesParentFallback) {
    logger.warn(
      `${SOCIAL_MEDIA_PARENT_CONFIG} is not configured; Social Media projects will use a dedicated child folder under ${SCHEDULES_PARENT_CONFIG}.`,
    );
    warnedAboutSchedulesParentFallback = true;
  }
  const validSchedulesParent = await loadFolder(drive, schedulesParent);
  return (await ensureGoogleDriveChildFolder(drive, SOCIAL_MEDIA_FALLBACK_ROOT, validSchedulesParent.id)).id;
};

/**
 * Resolves one stable Drive folder per content item. Passing the persisted private
 * folder ID makes this idempotent even when the title later changes.
 */
export async function ensureSocialMediaProjectFolder(
  params: EnsureSocialMediaProjectFolderParams,
): Promise<EnsureSocialMediaProjectFolderResult> {
  assertPositiveContentId(params.contentId);
  const drive = await getDriveClient();

  const existingFolderId = normalizeConfigString(params.existingFolderId);
  if (existingFolderId) {
    const existing = await loadFolder(drive, existingFolderId);
    return {
      folderId: existing.id,
      driveProjectUrl: existing.webViewLink ?? driveFolderUrl(existing.id),
    };
  }

  const rootFolderId = await resolveSocialMediaRootFolder(drive);
  const projectFolder = await ensureGoogleDriveChildFolder(
    drive,
    `${params.contentId} - ${sanitizeFolderName(params.title)}`,
    rootFolderId,
  );
  return {
    folderId: projectFolder.id,
    driveProjectUrl: projectFolder.webViewLink ?? driveFolderUrl(projectFolder.id),
  };
}

/**
 * Streams a multer disk-backed temporary file into the content's Drive folder.
 * The caller owns cleanup of tempPath after this promise settles.
 */
export async function storeSocialMediaAsset(
  params: StoreSocialMediaAssetParams,
): Promise<StoreSocialMediaAssetResult> {
  assertPositiveContentId(params.contentId);
  if (!SOCIAL_MEDIA_CONTENT_ASSET_KINDS.includes(params.kind)) {
    throw new SocialMediaAssetStorageValidationError('Unsupported Social Media asset type.');
  }
  if (!Number.isSafeInteger(params.sizeBytes) || params.sizeBytes <= 0) {
    throw new SocialMediaAssetStorageValidationError('Social Media assets cannot be empty.');
  }

  const fileStat = await fs.stat(params.tempPath);
  if (!fileStat.isFile() || fileStat.size <= 0) {
    throw new SocialMediaAssetStorageValidationError('Social Media assets must be non-empty files.');
  }
  if (fileStat.size !== params.sizeBytes) {
    throw new SocialMediaAssetStorageValidationError(
      'The uploaded Social Media asset size does not match the received file.',
    );
  }

  const projectFolder = await ensureSocialMediaProjectFolder({
    contentId: params.contentId,
    title: params.title,
    existingFolderId: params.folderId,
  });
  const drive = await getDriveClient();
  const assetFolder = await ensureGoogleDriveChildFolder(
    drive,
    ASSET_FOLDER_NAMES[params.kind],
    projectFolder.folderId,
  );
  const originalName = sanitizeSocialMediaAssetOriginalName(params.originalName);
  const mimeType = params.mimeType.trim().slice(0, 255) || 'application/octet-stream';
  const uploaded = await drive.files.create({
    requestBody: {
      name: buildSocialMediaStoredFileName(originalName),
      mimeType,
      parents: [assetFolder.id],
    },
    media: {
      mimeType,
      body: createReadStream(params.tempPath),
    },
    fields: 'id,webViewLink',
    supportsAllDrives: true,
  });
  if (!uploaded.data.id) {
    throw new Error(`Google Drive did not return an ID for ${originalName}.`);
  }

  return {
    driveFileId: uploaded.data.id,
    webViewUrl: uploaded.data.webViewLink ?? driveFileUrl(uploaded.data.id),
    originalName,
    mimeType,
    sizeBytes: fileStat.size,
  };
}

export async function deleteSocialMediaAsset(fileId: string): Promise<void> {
  const normalizedFileId = fileId.trim();
  if (!normalizedFileId) {
    return;
  }

  const drive = await getDriveClient();
  try {
    await drive.files.delete({ fileId: normalizedFileId, supportsAllDrives: true });
  } catch (error) {
    const status = (error as { response?: { status?: number }; code?: number }).response?.status
      ?? (error as { code?: number }).code;
    if (status === 404) {
      return;
    }
    throw error;
  }
}
