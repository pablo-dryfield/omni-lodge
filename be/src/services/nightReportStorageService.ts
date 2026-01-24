import path from 'path';
import { promises as fs, createReadStream } from 'fs';
import { Readable } from 'stream';
import dayjs from 'dayjs';
import { ensureFolderPath, uploadBuffer, getDriveClient } from './googleDrive.js';
import { getConfigValue } from './configService.js';

const DEFAULT_UPLOAD_DIR = path.resolve(process.cwd(), 'uploads', 'night-reports');
const DRIVE_PREFIX = 'drive:';
const VENUE_NUMBERS_ROOT = 'Venue Numbers';

type StoreNightReportPhotoParams = {
  reportId: number;
  activityDate: string | Date | null;
  originalName: string;
  mimeType: string;
  data: Buffer;
};

type StoreNightReportPhotoResult = {
  relativePath: string;
  driveFileId: string;
  driveWebViewLink: string | null;
  folderSegments: string[];
};

function getBaseDir(): string {
  const raw = getConfigValue('NIGHT_REPORT_UPLOAD_DIR') as string | null;
  if (!raw) {
    return DEFAULT_UPLOAD_DIR;
  }
  const resolved = path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
  return resolved;
}

function sanitizeRelativePath(relativePath: string): string {
  const normalized = path.normalize(relativePath).replace(/^[\\/]+/, '');
  if (normalized.includes('..')) {
    throw new Error('Invalid storage path');
  }
  return normalized;
}

function toAbsolutePath(relativePath: string): string {
  const baseDir = getBaseDir();
  const cleaned = sanitizeRelativePath(relativePath);
  const full = path.resolve(baseDir, cleaned);
  if (!full.startsWith(baseDir)) {
    throw new Error('Attempted directory traversal');
  }
  return full;
}

function isDriveStorage(storagePath: string): boolean {
  return storagePath.startsWith(DRIVE_PREFIX);
}

function getDriveFileId(storagePath: string): string {
  return storagePath.replace(DRIVE_PREFIX, '').trim();
}

function extensionFromMime(mimeType: string): string | null {
  const lower = mimeType.toLowerCase();
  if (lower === 'image/jpeg' || lower === 'image/jpg') {
    return '.jpg';
  }
  if (lower === 'image/png') {
    return '.png';
  }
  if (lower === 'image/heic' || lower === 'image/heif') {
    return '.heic';
  }
  if (lower === 'image/webp') {
    return '.webp';
  }
  return null;
}

export async function ensureNightReportStorage(): Promise<void> {
  await ensureFolderPath(VENUE_NUMBERS_ROOT);
}

export async function storeNightReportPhoto(params: StoreNightReportPhotoParams): Promise<StoreNightReportPhotoResult> {
  const { activityDate, originalName, mimeType, data } = params;

  if (!Buffer.isBuffer(data) || data.length === 0) {
    throw new Error('Cannot store empty file');
  }

  const parsed = activityDate ? dayjs(activityDate) : dayjs();
  const reportDate = parsed.isValid() ? parsed : dayjs();
  const year = reportDate.format('YYYY');
  const monthName = reportDate.format('MMMM');
  const dateStamp = reportDate.format('YYYYMMDD');

  const ext = path.extname(originalName) || extensionFromMime(mimeType) || '.jpg';
  const normalizedExt = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
  const fileName = `night_report_${dateStamp}${normalizedExt}`;
  const folderPath = `${VENUE_NUMBERS_ROOT}/${year}/${monthName}`;

  const folder = await ensureFolderPath(folderPath);

  const upload = await uploadBuffer({
    name: fileName,
    mimeType,
    buffer: data,
    parents: [folder.id],
  });

  return {
    relativePath: `${DRIVE_PREFIX}${upload.id}`,
    driveFileId: upload.id,
    driveWebViewLink: upload.webViewLink ?? upload.webContentLink ?? null,
    folderSegments: folder.path.concat(fileName),
  };
}

export async function deleteNightReportPhoto(storagePath: string): Promise<void> {
  if (!storagePath) {
    return;
  }

  if (isDriveStorage(storagePath)) {
    const fileId = getDriveFileId(storagePath);
    if (!fileId) {
      return;
    }
    try {
      const drive = await getDriveClient();
      await drive.files.delete({ fileId });
    } catch (error) {
      const code = (error as { code?: number })?.code;
      if (code === 404) {
        return;
      }
      throw error;
    }
    return;
  }

  const absolutePath = toAbsolutePath(storagePath);
  try {
    await fs.unlink(absolutePath);
    const parentDir = path.dirname(absolutePath);
    const remaining = await fs.readdir(parentDir);
    if (remaining.length === 0 && parentDir !== getBaseDir()) {
      await fs.rmdir(parentDir).catch(() => {});
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') {
      return;
    }
    throw error;
  }
}

export async function openNightReportPhotoStream(storagePath: string): Promise<Readable> {
  if (!storagePath) {
    throw new Error('Missing storage path for night report photo');
  }

  if (isDriveStorage(storagePath)) {
    const fileId = getDriveFileId(storagePath);
    if (!fileId) {
      throw new Error('Invalid Drive storage identifier');
    }
    const drive = await getDriveClient();
    const response = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'stream' },
    );
    return response.data as unknown as Readable;
  }

  const absolutePath = toAbsolutePath(storagePath);
  return createReadStream(absolutePath);
}
