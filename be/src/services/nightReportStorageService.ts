import path from 'path';
import { promises as fs, createReadStream } from 'fs';
import type { ReadStream } from 'fs';
import crypto from 'crypto';

const DEFAULT_UPLOAD_DIR = path.resolve(process.cwd(), 'uploads', 'night-reports');

function getBaseDir(): string {
  const raw = process.env.NIGHT_REPORT_UPLOAD_DIR;
  if (!raw) {
    return DEFAULT_UPLOAD_DIR;
  }
  const resolved = path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
  return resolved;
}

async function ensureDirectory(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
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

function buildFilename(originalName: string, mimeType: string): string {
  const originalExt = path.extname(originalName);
  const ext = originalExt || extensionFromMime(mimeType) || '.jpg';
  const id = crypto.randomUUID();
  return `${id}${ext}`;
}

export async function storeNightReportPhoto(
  reportId: number,
  originalName: string,
  mimeType: string,
  data: Buffer,
): Promise<{ relativePath: string; absolutePath: string }> {
  if (!Buffer.isBuffer(data) || data.length === 0) {
    throw new Error('Cannot store empty file');
  }

  const baseDir = getBaseDir();
  const targetDir = path.join(baseDir, String(reportId));
  await ensureDirectory(targetDir);

  const fileName = buildFilename(originalName, mimeType);
  const absolutePath = path.join(targetDir, fileName);
  await fs.writeFile(absolutePath, data);

  const relativePath = path.relative(baseDir, absolutePath).replace(/\\/g, '/');
  return { relativePath, absolutePath };
}

export async function deleteNightReportPhoto(storagePath: string): Promise<void> {
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

export function openNightReportPhotoStream(storagePath: string): ReadStream {
  const absolutePath = toAbsolutePath(storagePath);
  return createReadStream(absolutePath);
}

export async function ensureNightReportStorage(): Promise<string> {
  const baseDir = getBaseDir();
  await ensureDirectory(baseDir);
  return baseDir;
}
