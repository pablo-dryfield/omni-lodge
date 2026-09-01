import path from 'path';
import { Readable } from 'stream';
import { ensureFolderPath, getDriveClient, uploadBuffer } from './googleDrive.js';
import slugify from '../utils/slugify.js';

const SOCIAL_MEDIA_ROOT = 'Social Media';
const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
]);

type StoreSocialMediaThumbnailParams = {
  contentId: number;
  title: string;
  originalName: string;
  mimeType: string;
  data: Buffer;
};

export type StoreSocialMediaThumbnailResult = {
  driveFileId: string;
  thumbnailUrl: string;
  originalName: string;
  mimeType: string;
};

export class SocialMediaThumbnailValidationError extends Error {}
export class SocialMediaThumbnailUnsafeContentError extends Error {}

function normalizeSupportedMimeType(mimeType: string): string | null {
  const normalized = mimeType.trim().toLowerCase();
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'image/jpeg';
  if (normalized === 'image/png') return 'image/png';
  if (normalized === 'image/webp') return 'image/webp';
  if (normalized === 'image/gif') return 'image/gif';
  return null;
}

function extensionFromMime(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case 'image/jpeg':
    case 'image/jpg':
      return '.jpg';
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    case 'image/gif':
      return '.gif';
    default:
      return '';
  }
}

function sanitizedTitle(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100) || 'Untitled';
}

function ensureValidThumbnail(data: Buffer, mimeType: string): void {
  if (!Buffer.isBuffer(data) || data.length === 0) {
    throw new SocialMediaThumbnailValidationError('Cannot upload an empty thumbnail.');
  }
  if (data.length > MAX_THUMBNAIL_BYTES) {
    throw new SocialMediaThumbnailValidationError('Thumbnail files cannot be larger than 5 MB.');
  }
  if (!ALLOWED_MIME_TYPES.has(mimeType.toLowerCase())) {
    throw new SocialMediaThumbnailValidationError('Only JPG, PNG, WEBP, and GIF thumbnails are supported.');
  }
  const normalizedMimeType = mimeType.toLowerCase();
  const hasValidSignature =
    ((normalizedMimeType === 'image/jpeg' || normalizedMimeType === 'image/jpg') &&
      data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) ||
    (normalizedMimeType === 'image/png' &&
      data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ||
    (normalizedMimeType === 'image/gif' &&
      data.length >= 6 && ['GIF87a', 'GIF89a'].includes(data.subarray(0, 6).toString('ascii'))) ||
    (normalizedMimeType === 'image/webp' &&
      data.length >= 12 &&
      data.subarray(0, 4).toString('ascii') === 'RIFF' &&
      data.subarray(8, 12).toString('ascii') === 'WEBP');
  if (!hasValidSignature) {
    throw new SocialMediaThumbnailValidationError(
      'The thumbnail contents do not match the selected image format.',
    );
  }
}

function buildFileName(originalName: string, mimeType: string): string {
  const parsed = path.parse(originalName);
  const baseName = slugify(parsed.name) || 'thumbnail';
  const requestedExtension = parsed.ext.toLowerCase();
  const extension = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(requestedExtension)
    ? requestedExtension
    : extensionFromMime(mimeType);
  return `${baseName}-${Date.now()}${extension || '.bin'}`;
}

export async function storeSocialMediaThumbnail(
  params: StoreSocialMediaThumbnailParams,
): Promise<StoreSocialMediaThumbnailResult> {
  ensureValidThumbnail(params.data, params.mimeType);
  const normalizedMimeType = normalizeSupportedMimeType(params.mimeType);
  if (!normalizedMimeType) {
    // Kept as a defensive invariant even though ensureValidThumbnail rejects it.
    throw new SocialMediaThumbnailValidationError(
      'Only JPG, PNG, WEBP, and GIF thumbnails are supported.',
    );
  }

  const folder = await ensureFolderPath(
    `${SOCIAL_MEDIA_ROOT}/${sanitizedTitle(`${params.contentId} - ${params.title}`)}/Thumbnails`,
  );
  const uploaded = await uploadBuffer({
    name: buildFileName(params.originalName, normalizedMimeType),
    mimeType: normalizedMimeType,
    buffer: params.data,
    parents: [folder.id],
  });

  return {
    driveFileId: uploaded.id,
    thumbnailUrl: `/api/social-media/content/${params.contentId}/thumbnail`,
    originalName: params.originalName.slice(0, 255),
    mimeType: normalizedMimeType,
  };
}

export async function openSocialMediaThumbnailStream(
  fileId: string,
): Promise<{ stream: Readable; mimeType: string }> {
  if (!fileId.trim()) {
    throw new Error('Missing thumbnail file identifier.');
  }

  const drive = await getDriveClient();
  const metadata = await drive.files.get({
    fileId,
    fields: 'mimeType',
    supportsAllDrives: true,
  });
  const mimeType = normalizeSupportedMimeType(metadata.data.mimeType ?? '');
  if (!mimeType) {
    throw new SocialMediaThumbnailUnsafeContentError(
      'Stored thumbnail has an unsupported image format.',
    );
  }
  const response = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'stream' },
  );

  return {
    stream: response.data as unknown as Readable,
    mimeType,
  };
}

export async function deleteSocialMediaThumbnail(fileId: string): Promise<void> {
  if (!fileId.trim()) {
    return;
  }
  const drive = await getDriveClient();
  await drive.files.delete({ fileId, supportsAllDrives: true });
}
