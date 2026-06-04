import path from 'path';
import { Readable } from 'stream';
import type { CerebroEntryKind } from '../models/CerebroEntry.js';
import { ensureFolderPath, getDriveClient, uploadBuffer } from './googleDrive.js';
import slugify from '../utils/slugify.js';

const CEREBRO_ROOT = 'Cerebro';
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
]);

type StoreCerebroAssetParams = {
  sectionName: string;
  entryTitle: string;
  kind: CerebroEntryKind;
  originalName: string;
  mimeType: string;
  data: Buffer;
};

export type StoreCerebroAssetResult = {
  driveFileId: string;
  assetUrl: string;
  folderSegments: string[];
};

const KIND_LABELS: Record<CerebroEntryKind, string> = {
  faq: 'Article',
  tutorial: 'Tutorial',
  playbook: 'Playbook',
  policy: 'Policy',
};

function sanitizeFolderSegment(value: string, fallback: string): string {
  const normalized = value
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return fallback;
  }

  return normalized.slice(0, 100);
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

function ensureSupportedMimeType(mimeType: string): void {
  if (!ALLOWED_MIME_TYPES.has(mimeType.toLowerCase())) {
    throw new Error('Only JPG, PNG, WEBP, and GIF uploads are supported.');
  }
}

function buildFileName(originalName: string, mimeType: string): string {
  const parsed = path.parse(originalName);
  const baseName = slugify(parsed.name) || 'asset';
  const extension = parsed.ext ? parsed.ext.toLowerCase() : extensionFromMime(mimeType);
  return `${baseName}-${Date.now()}${extension || extensionFromMime(mimeType) || '.bin'}`;
}

export async function storeCerebroAsset(params: StoreCerebroAssetParams): Promise<StoreCerebroAssetResult> {
  const { sectionName, entryTitle, kind, originalName, mimeType, data } = params;

  if (!Buffer.isBuffer(data) || data.length === 0) {
    throw new Error('Cannot upload an empty file.');
  }

  ensureSupportedMimeType(mimeType);

  const folderPath = [
    CEREBRO_ROOT,
    sanitizeFolderSegment(sectionName, 'General'),
    sanitizeFolderSegment(`${KIND_LABELS[kind]} - ${entryTitle}`, 'Untitled'),
  ].join('/');

  const folder = await ensureFolderPath(folderPath);
  const fileName = buildFileName(originalName, mimeType);
  const upload = await uploadBuffer({
    name: fileName,
    mimeType,
    buffer: data,
    parents: [folder.id],
  });

  return {
    driveFileId: upload.id,
    assetUrl: `/api/cerebro/assets/${upload.id}`,
    folderSegments: folder.path.concat(fileName),
  };
}

export async function openCerebroAssetStream(fileId: string): Promise<{ stream: Readable; mimeType: string }> {
  if (!fileId.trim()) {
    throw new Error('Missing asset file id.');
  }

  const drive = await getDriveClient();
  const metadata = await drive.files.get({
    fileId,
    fields: 'mimeType',
    supportsAllDrives: true,
  });

  const response = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'stream' },
  );

  return {
    stream: response.data as unknown as Readable,
    mimeType: metadata.data.mimeType ?? 'application/octet-stream',
  };
}
