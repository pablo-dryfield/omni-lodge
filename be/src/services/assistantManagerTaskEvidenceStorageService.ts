import path from 'path';
import dayjs from 'dayjs';
import { Readable } from 'stream';
import { ensureFolderPath, getDriveClient, uploadBuffer } from './googleDrive.js';

const ROOT_FOLDER = 'Assistant Manager Task Evidence';
const DRIVE_PREFIX = 'drive:';

type StoreAssistantManagerTaskEvidenceImageParams = {
  logId: number;
  taskDate: string | Date | null;
  ruleKey: string;
  originalName: string;
  mimeType: string;
  data: Buffer;
};

export type StoreAssistantManagerTaskEvidenceImageResult = {
  storagePath: string;
  driveFileId: string;
  driveWebViewLink: string | null;
  originalName: string;
  mimeType: string;
  fileSize: number;
};

type OpenAssistantManagerTaskEvidenceImageStreamParams = {
  storagePath?: string | null;
  driveFileId?: string | null;
};

type OpenAssistantManagerTaskEvidenceImageStreamResult = {
  stream: Readable;
  mimeType: string;
};

const extensionFromMime = (mimeType: string): string | null => {
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
};

export async function ensureAssistantManagerTaskEvidenceStorage(): Promise<void> {
  await ensureFolderPath(ROOT_FOLDER);
}

export async function storeAssistantManagerTaskEvidenceImage(
  params: StoreAssistantManagerTaskEvidenceImageParams,
): Promise<StoreAssistantManagerTaskEvidenceImageResult> {
  const { logId, taskDate, ruleKey, originalName, mimeType, data } = params;

  if (!Buffer.isBuffer(data) || data.length === 0) {
    throw new Error('Cannot store empty evidence file');
  }

  const parsedDate = taskDate ? dayjs(taskDate) : dayjs();
  const evidenceDate = parsedDate.isValid() ? parsedDate : dayjs();
  const year = evidenceDate.format('YYYY');
  const month = evidenceDate.format('MMMM');
  const day = evidenceDate.format('DD');
  const dateStamp = evidenceDate.format('YYYYMMDD');
  const ext = path.extname(originalName) || extensionFromMime(mimeType) || '.jpg';
  const normalizedExt = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
  const safeRuleKey = ruleKey.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  const safeOriginalName = path.basename(originalName).replace(/\s+/g, '-');
  const fileName = `am_task_${logId}_${safeRuleKey}_${dateStamp}_${Date.now()}_${safeOriginalName || `evidence${normalizedExt}`}`;
  const folder = await ensureFolderPath(`${ROOT_FOLDER}/${year}/${month}/${day}`);

  const upload = await uploadBuffer({
    name: fileName.endsWith(normalizedExt) ? fileName : `${fileName}${normalizedExt}`,
    mimeType,
    buffer: data,
    parents: [folder.id],
  });

  return {
    storagePath: `${DRIVE_PREFIX}${upload.id}`,
    driveFileId: upload.id,
    driveWebViewLink: upload.webViewLink ?? upload.webContentLink ?? null,
    originalName,
    mimeType,
    fileSize: data.length,
  };
}

const isDriveStorage = (storagePath: string): boolean => storagePath.startsWith(DRIVE_PREFIX);

const getDriveFileIdFromStoragePath = (storagePath: string): string =>
  storagePath.replace(DRIVE_PREFIX, '').trim();

export async function deleteAssistantManagerTaskEvidenceImage(params: {
  storagePath?: string | null;
  driveFileId?: string | null;
}): Promise<void> {
  const fromStoragePath =
    typeof params.storagePath === 'string' && isDriveStorage(params.storagePath)
      ? getDriveFileIdFromStoragePath(params.storagePath)
      : '';
  const fileId =
    (typeof params.driveFileId === 'string' ? params.driveFileId.trim() : '') || fromStoragePath;

  if (!fileId) {
    return;
  }

  try {
    const drive = await getDriveClient();
    await drive.files.delete({
      fileId,
      supportsAllDrives: true,
    });
  } catch (error) {
    const code = (error as { code?: number })?.code;
    if (code === 404) {
      return;
    }
    throw error;
  }
}

export async function openAssistantManagerTaskEvidenceImageStream(
  params: OpenAssistantManagerTaskEvidenceImageStreamParams,
): Promise<OpenAssistantManagerTaskEvidenceImageStreamResult> {
  const fromStoragePath =
    typeof params.storagePath === 'string' && isDriveStorage(params.storagePath)
      ? getDriveFileIdFromStoragePath(params.storagePath)
      : '';
  const fileId =
    (typeof params.driveFileId === 'string' ? params.driveFileId.trim() : '') || fromStoragePath;

  if (!fileId) {
    throw new Error('Missing evidence Drive file id');
  }

  const drive = await getDriveClient();
  const metadata = await drive.files.get({
    fileId,
    fields: 'mimeType',
    supportsAllDrives: true,
  });
  const mimeType = metadata.data.mimeType ?? 'application/octet-stream';
  const response = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream' },
  );

  return {
    stream: response.data as unknown as Readable,
    mimeType,
  };
}
