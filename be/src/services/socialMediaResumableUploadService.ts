import crypto from 'crypto';
import {
  type SocialMediaContentAssetKind,
} from '../models/SocialMediaContentAsset.js';
import { getDriveAuthClient, getDriveClient } from './googleDrive.js';
import {
  buildSocialMediaStoredFileName,
  ensureGoogleDriveChildFolder,
  ensureSocialMediaProjectFolder,
  sanitizeSocialMediaAssetOriginalName,
  SocialMediaAssetStorageValidationError,
} from './socialMediaAssetStorageService.js';

const MAX_ASSET_SIZE_BYTES = 2 * 1024 * 1024 * 1024;
export const SOCIAL_MEDIA_RESUMABLE_CHUNK_SIZE_BYTES = 8 * 1024 * 1024;

const ASSET_FOLDER_NAMES: Record<SocialMediaContentAssetKind, string> = {
  final_video: 'Final Video',
  raw_material: 'Raw Material',
  project_file: 'Project Files',
};

type CommonUploadMetadata = {
  contentId: number;
  title: string;
  folderId: string;
  kind: SocialMediaContentAssetKind;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
};

export type InitiateSocialMediaResumableUploadParams = CommonUploadMetadata;

export type InitiateSocialMediaResumableUploadResult = {
  uploadUrl: string;
  uploadToken: string;
  chunkSizeBytes: number;
};

export type FinalizeSocialMediaResumableUploadParams = CommonUploadMetadata & {
  driveFileId: string;
  uploadToken: string;
};

export type FinalizeSocialMediaResumableUploadResult = {
  driveFileId: string;
  webViewUrl: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
};

const driveFileUrl = (fileId: string): string =>
  `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;

const normalizeMimeType = (value: string): string =>
  value.trim().slice(0, 255) || 'application/octet-stream';

const buildMetadataHash = (params: CommonUploadMetadata): string =>
  crypto.createHash('sha256').update(JSON.stringify([
    String(params.contentId),
    params.kind,
    sanitizeSocialMediaAssetOriginalName(params.originalName),
    normalizeMimeType(params.mimeType),
    String(params.sizeBytes),
  ])).digest('hex');

const validateCommonMetadata = (params: CommonUploadMetadata): void => {
  if (!Number.isInteger(params.contentId) || params.contentId <= 0) {
    throw new SocialMediaAssetStorageValidationError('Social Media content ID must be a positive integer.');
  }
  if (!Number.isSafeInteger(params.sizeBytes) || params.sizeBytes <= 0) {
    throw new SocialMediaAssetStorageValidationError('Social Media assets cannot be empty.');
  }
  if (params.sizeBytes > MAX_ASSET_SIZE_BYTES) {
    throw new SocialMediaAssetStorageValidationError('Social Media files cannot be larger than 2 GB.');
  }
  if (!params.folderId.trim()) {
    throw new SocialMediaAssetStorageValidationError('Create the Drive project folder before uploading assets.');
  }
};

const resolveAssetFolder = async (params: CommonUploadMetadata): Promise<string> => {
  const projectFolder = await ensureSocialMediaProjectFolder({
    contentId: params.contentId,
    title: params.title,
    existingFolderId: params.folderId,
  });
  const drive = await getDriveClient();
  return (await ensureGoogleDriveChildFolder(
    drive,
    ASSET_FOLDER_NAMES[params.kind],
    projectFolder.folderId,
  )).id;
};

const readLocationHeader = (headers: unknown): string | null => {
  if (headers && typeof headers === 'object' && 'get' in headers) {
    const get = (headers as { get?: unknown }).get;
    if (typeof get === 'function') {
      const value = get.call(headers, 'location');
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }
  if (headers && typeof headers === 'object') {
    const record = headers as Record<string, unknown>;
    const value = record.location ?? record.Location;
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (Array.isArray(value) && typeof value[0] === 'string') return value[0].trim();
  }
  return null;
};

const safeTokenMatch = (expected: string, actual: string | null | undefined): boolean => {
  if (!actual) return false;
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return expectedBuffer.length === actualBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
};

/**
 * Creates an authorized Drive resumable session. The returned capability URL
 * lets the browser upload chunks directly to Drive without exposing OAuth
 * credentials or sending large bodies through OmniLodge/Cloudflare.
 */
export async function initiateSocialMediaResumableUpload(
  params: InitiateSocialMediaResumableUploadParams,
): Promise<InitiateSocialMediaResumableUploadResult> {
  validateCommonMetadata(params);
  const assetFolderId = await resolveAssetFolder(params);
  const uploadToken = crypto.randomUUID();
  const originalName = sanitizeSocialMediaAssetOriginalName(params.originalName);
  const mimeType = normalizeMimeType(params.mimeType);
  const authClient = getDriveAuthClient();
  const response = await authClient.request({
    url: 'https://www.googleapis.com/upload/drive/v3/files',
    method: 'POST',
    params: {
      uploadType: 'resumable',
      supportsAllDrives: 'true',
      fields: 'id,name,mimeType,size,parents,appProperties,webViewLink,trashed',
    },
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mimeType,
      'X-Upload-Content-Length': String(params.sizeBytes),
    },
    data: {
      name: buildSocialMediaStoredFileName(originalName),
      mimeType,
      parents: [assetFolderId],
      appProperties: {
        omniSocialContentId: String(params.contentId),
        omniSocialAssetKind: params.kind,
        omniSocialUploadToken: uploadToken,
        omniSocialMetadataHash: buildMetadataHash(params),
      },
    },
  });
  const uploadUrl = readLocationHeader(response.headers);
  let uploadHost = '';
  try {
    const parsed = new URL(uploadUrl ?? '');
    if (parsed.protocol === 'https:') uploadHost = parsed.hostname.toLowerCase();
  } catch {
    uploadHost = '';
  }
  if (!uploadUrl || (uploadHost !== 'googleapis.com' && !uploadHost.endsWith('.googleapis.com'))) {
    throw new Error('Google Drive did not return a secure resumable upload session.');
  }
  return {
    uploadUrl,
    uploadToken,
    chunkSizeBytes: SOCIAL_MEDIA_RESUMABLE_CHUNK_SIZE_BYTES,
  };
}

/**
 * Verifies a browser-completed file against private Drive app properties and
 * its expected folder before it can become workflow evidence.
 */
export async function finalizeSocialMediaResumableUpload(
  params: FinalizeSocialMediaResumableUploadParams,
): Promise<FinalizeSocialMediaResumableUploadResult> {
  validateCommonMetadata(params);
  const driveFileId = params.driveFileId.trim();
  const uploadToken = params.uploadToken.trim();
  if (!driveFileId || !uploadToken) {
    throw new SocialMediaAssetStorageValidationError('The resumable upload receipt is incomplete.');
  }
  const expectedFolderId = await resolveAssetFolder(params);
  const drive = await getDriveClient();
  const response = await drive.files.get({
    fileId: driveFileId,
    fields: 'id,name,mimeType,size,parents,appProperties,webViewLink,trashed',
    supportsAllDrives: true,
  });
  const file = response.data;
  const appProperties = file.appProperties ?? {};
  const actualSize = Number(file.size);
  if (
    !file.id
    || file.trashed === true
    || !file.parents?.includes(expectedFolderId)
    || appProperties.omniSocialContentId !== String(params.contentId)
    || appProperties.omniSocialAssetKind !== params.kind
    || !safeTokenMatch(uploadToken, appProperties.omniSocialUploadToken)
    || !safeTokenMatch(buildMetadataHash(params), appProperties.omniSocialMetadataHash)
    || !Number.isSafeInteger(actualSize)
    || actualSize !== params.sizeBytes
  ) {
    throw new SocialMediaAssetStorageValidationError(
      'The completed Google Drive file does not match this Social Media upload session.',
    );
  }
  const expectedMimeType = normalizeMimeType(params.mimeType);
  if ((file.mimeType ?? 'application/octet-stream') !== expectedMimeType) {
    throw new SocialMediaAssetStorageValidationError(
      'The completed Google Drive file type does not match the selected file.',
    );
  }

  return {
    driveFileId: file.id,
    webViewUrl: file.webViewLink ?? driveFileUrl(file.id),
    originalName: sanitizeSocialMediaAssetOriginalName(params.originalName),
    mimeType: expectedMimeType,
    sizeBytes: actualSize,
  };
}
