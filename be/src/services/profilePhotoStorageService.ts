import path from 'path';
import { promises as fs, createReadStream } from 'fs';
import { Readable } from 'stream';
import { ensureFolderPath, uploadBuffer, getDriveClient } from './googleDrive.js';
import { getConfigValue } from './configService.js';

const DEFAULT_UPLOAD_DIR = path.resolve(process.cwd(), 'uploads', 'profile-photos');
const DRIVE_PREFIX = 'drive:';
const PROFILE_PHOTO_ROOT = 'Profile Photos';

type StoreProfilePhotoParams = {
  userId: number;
  originalName: string;
  mimeType: string;
  data: Buffer;
};

export type StoreProfilePhotoResult = {
  relativePath: string;
  driveFileId: string;
  driveWebViewLink: string | null;
  folderSegments: string[];
};

function getBaseDir(): string {
  const raw = getConfigValue('PROFILE_PHOTO_UPLOAD_DIR') as string | null;
  if (!raw) {
    return DEFAULT_UPLOAD_DIR;
  }
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
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

export async function ensureProfilePhotoStorage(): Promise<void> {
  await ensureFolderPath(PROFILE_PHOTO_ROOT);
}

export async function storeProfilePhoto(params: StoreProfilePhotoParams): Promise<StoreProfilePhotoResult> {
  const { userId, originalName, mimeType, data } = params;

  if (!Buffer.isBuffer(data) || data.length === 0) {
    throw new Error('Cannot store empty file');
  }

  const ext = path.extname(originalName) || extensionFromMime(mimeType) || '.jpg';
  const normalizedExt = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
  const timestamp = Date.now();
  const fileName = `profile_${userId}_${timestamp}${normalizedExt}`;
  const folderPath = `${PROFILE_PHOTO_ROOT}/User ${userId}`;

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

export async function deleteProfilePhoto(storagePath: string | null | undefined): Promise<void> {
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

type ProfilePhotoStreamResult = {
  stream: Readable;
  mimeType: string;
};

function guessMimeTypeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') {
    return 'image/jpeg';
  }
  if (ext === '.png') {
    return 'image/png';
  }
  if (ext === '.webp') {
    return 'image/webp';
  }
  if (ext === '.heic' || ext === '.heif') {
    return 'image/heic';
  }
  return 'application/octet-stream';
}

export async function openProfilePhotoStream(storagePath: string): Promise<ProfilePhotoStreamResult> {
  if (!storagePath) {
    throw new Error('Missing storage path for profile photo');
  }

  if (isDriveStorage(storagePath)) {
    const fileId = getDriveFileId(storagePath);
    if (!fileId) {
      throw new Error('Invalid Drive storage identifier');
    }
    const driveClient = await getDriveClient();
    const metadata = await driveClient.files.get({
      fileId,
      fields: 'mimeType',
      supportsAllDrives: true,
    });
    const mimeType = metadata.data.mimeType ?? 'application/octet-stream';
    const response = await driveClient.files.get(
      { fileId, alt: 'media' },
      { responseType: 'stream' },
    );
    return {
      stream: response.data as unknown as Readable,
      mimeType,
    };
  }

  const absolutePath = toAbsolutePath(storagePath);
  return {
    stream: createReadStream(absolutePath),
    mimeType: guessMimeTypeFromPath(absolutePath),
  };
}
