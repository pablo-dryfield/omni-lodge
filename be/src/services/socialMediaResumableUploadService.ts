import crypto from 'crypto';
import type { drive_v3 } from 'googleapis';
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

export type InitiateSocialMediaResumableUploadOptions = {
  /**
   * A browser origin that OmniLodge has explicitly trusted. Google associates
   * this with the resumable session so the browser can read the final upload
   * response instead of reporting an ambiguous network/CORS failure.
   */
  browserOrigin?: string | null;
};

export type InitiateSocialMediaResumableUploadResult = {
  uploadUrl: string;
  uploadToken: string;
  chunkSizeBytes: number;
};

export type FinalizeSocialMediaResumableUploadParams = CommonUploadMetadata & {
  driveFileId?: string | null;
  uploadToken: string;
};

export type FinalizeSocialMediaResumableUploadResult = {
  driveFileId: string;
  webViewUrl: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
};

export class SocialMediaResumableUploadPendingError extends Error {
  constructor(message = 'Google Drive has not exposed the completed upload yet. Try again shortly.') {
    super(message);
    this.name = 'SocialMediaResumableUploadPendingError';
  }
}

const TRUSTED_BROWSER_UPLOAD_ORIGINS = new Set([
  'https://omni-lodge.com',
  'http://localhost:3000',
]);

export const resolveTrustedSocialMediaUploadOrigin = (
  origin: string | null | undefined,
  referer?: string | null,
): string => {
  for (const candidate of [origin, referer]) {
    const raw = candidate?.trim();
    if (!raw) continue;
    try {
      const parsed = new URL(raw);
      if (TRUSTED_BROWSER_UPLOAD_ORIGINS.has(parsed.origin)) return parsed.origin;
    } catch {
      // Ignore malformed/untrusted request headers and use the canonical app
      // origin below. Never reflect an arbitrary Origin back to Google.
    }
  }
  return process.env.NODE_ENV === 'production'
    ? 'https://omni-lodge.com'
    : 'http://localhost:3000';
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

const escapeDriveQueryValue = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const DRIVE_FILE_FIELDS =
  'id,name,mimeType,size,parents,appProperties,webViewLink,trashed';

const validateCompletedDriveFile = (
  file: drive_v3.Schema$File,
  params: CommonUploadMetadata,
  expectedFolderId: string,
  expectedUploadToken?: string,
): FinalizeSocialMediaResumableUploadResult | null => {
  const appProperties = file.appProperties ?? {};
  const actualSize = Number(file.size);
  const storedUploadToken = appProperties.omniSocialUploadToken;
  if (
    !file.id
    || file.trashed === true
    || !file.parents?.includes(expectedFolderId)
    || appProperties.omniSocialContentId !== String(params.contentId)
    || appProperties.omniSocialAssetKind !== params.kind
    || typeof storedUploadToken !== 'string'
    || !storedUploadToken.trim()
    || (expectedUploadToken != null && !safeTokenMatch(expectedUploadToken, storedUploadToken))
    || !safeTokenMatch(buildMetadataHash(params), appProperties.omniSocialMetadataHash)
    || !Number.isSafeInteger(actualSize)
    || actualSize !== params.sizeBytes
  ) {
    return null;
  }

  const expectedMimeType = normalizeMimeType(params.mimeType);
  if ((file.mimeType ?? 'application/octet-stream') !== expectedMimeType) {
    return null;
  }

  return {
    driveFileId: file.id,
    webViewUrl: file.webViewLink ?? driveFileUrl(file.id),
    originalName: sanitizeSocialMediaAssetOriginalName(params.originalName),
    mimeType: expectedMimeType,
    sizeBytes: actualSize,
  };
};

const findCompletedDriveFiles = async (
  params: CommonUploadMetadata,
  expectedFolderId: string,
  uploadToken?: string,
): Promise<FinalizeSocialMediaResumableUploadResult[]> => {
  const metadataHash = buildMetadataHash(params);
  const query = [
    'trashed = false',
    `'${escapeDriveQueryValue(expectedFolderId)}' in parents`,
    `appProperties has { key='omniSocialContentId' and value='${escapeDriveQueryValue(String(params.contentId))}' }`,
    `appProperties has { key='omniSocialAssetKind' and value='${escapeDriveQueryValue(params.kind)}' }`,
    `appProperties has { key='omniSocialMetadataHash' and value='${escapeDriveQueryValue(metadataHash)}' }`,
    ...(uploadToken
      ? [`appProperties has { key='omniSocialUploadToken' and value='${escapeDriveQueryValue(uploadToken)}' }`]
      : []),
  ].join(' and ');
  const drive = await getDriveClient();
  const response = await drive.files.list({
    q: query,
    fields: `files(${DRIVE_FILE_FIELDS})`,
    orderBy: 'createdTime desc',
    pageSize: uploadToken ? 2 : 20,
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
  });

  return (response.data.files ?? [])
    .map((file) => validateCompletedDriveFile(file, params, expectedFolderId, uploadToken))
    .filter((file): file is FinalizeSocialMediaResumableUploadResult => file !== null);
};

/**
 * Finds completed app-created uploads that were never registered locally (for
 * example when the browser could not read Google's final CORS response). The
 * caller still decides whether a matching Drive file is already registered.
 */
export async function findRecoverableSocialMediaResumableUploads(
  params: CommonUploadMetadata,
): Promise<FinalizeSocialMediaResumableUploadResult[]> {
  validateCommonMetadata(params);
  const expectedFolderId = await resolveAssetFolder(params);
  return findCompletedDriveFiles(params, expectedFolderId);
}

/**
 * Creates an authorized Drive resumable session. The returned capability URL
 * lets the browser upload chunks directly to Drive without exposing OAuth
 * credentials or sending large bodies through OmniLodge/Cloudflare.
 */
export async function initiateSocialMediaResumableUpload(
  params: InitiateSocialMediaResumableUploadParams,
  options: InitiateSocialMediaResumableUploadOptions = {},
): Promise<InitiateSocialMediaResumableUploadResult> {
  validateCommonMetadata(params);
  const assetFolderId = await resolveAssetFolder(params);
  const uploadToken = crypto.randomUUID();
  const originalName = sanitizeSocialMediaAssetOriginalName(params.originalName);
  const mimeType = normalizeMimeType(params.mimeType);
  const browserOrigin = resolveTrustedSocialMediaUploadOrigin(options.browserOrigin);
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
      Origin: browserOrigin,
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
  const driveFileId = params.driveFileId?.trim() ?? '';
  const uploadToken = params.uploadToken.trim();
  if (!uploadToken) {
    throw new SocialMediaAssetStorageValidationError('The resumable upload receipt is incomplete.');
  }
  const expectedFolderId = await resolveAssetFolder(params);
  let matches: FinalizeSocialMediaResumableUploadResult[];
  if (driveFileId) {
    const drive = await getDriveClient();
    const response = await drive.files.get({
      fileId: driveFileId,
      fields: DRIVE_FILE_FIELDS,
      supportsAllDrives: true,
    });
    const verified = validateCompletedDriveFile(
      response.data,
      params,
      expectedFolderId,
      uploadToken,
    );
    matches = verified ? [verified] : [];
  } else {
    matches = await findCompletedDriveFiles(params, expectedFolderId, uploadToken);
    if (matches.length === 0) {
      throw new SocialMediaResumableUploadPendingError();
    }
    if (matches.length > 1) {
      throw new SocialMediaAssetStorageValidationError(
        'More than one Google Drive file matches this Social Media upload receipt.',
      );
    }
  }

  if (matches.length !== 1) {
    throw new SocialMediaAssetStorageValidationError(
      'The completed Google Drive file does not match this Social Media upload session.',
    );
  }
  return matches[0];
}
