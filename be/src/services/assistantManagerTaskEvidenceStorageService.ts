import path from 'path';
import dayjs from 'dayjs';
import { ensureFolderPath, uploadBuffer } from './googleDrive.js';

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
  const dateStamp = evidenceDate.format('YYYYMMDD');
  const ext = path.extname(originalName) || extensionFromMime(mimeType) || '.jpg';
  const normalizedExt = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
  const safeRuleKey = ruleKey.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  const safeOriginalName = path.basename(originalName).replace(/\s+/g, '-');
  const fileName = `am_task_${logId}_${safeRuleKey}_${dateStamp}_${Date.now()}_${safeOriginalName || `evidence${normalizedExt}`}`;
  const folder = await ensureFolderPath(`${ROOT_FOLDER}/${year}/${month}`);

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
