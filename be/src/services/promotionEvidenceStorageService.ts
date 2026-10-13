import path from 'path';
import dayjs from 'dayjs';
import { ensureFolderPath, uploadBuffer } from './googleDrive.js';
import { normalizeCleaningPhoto } from './cleaningPhotoValidationService.js';

const ROOT_FOLDER = 'Promotion Tracking Evidence';
const DRIVE_PREFIX = 'drive:';

type StorePromotionEvidencePhotoParams = {
  actorUserId: number;
  assignmentId?: number | null;
  shiftInstanceId?: number | null;
  originalName?: string | null;
  data: Buffer;
};

export type StorePromotionEvidencePhotoResult = {
  evidenceRef: string;
  storagePath: string;
  driveFileId: string;
  driveWebViewLink: string | null;
  sha256: string;
  capturedAtUtc: string;
  byteSize: number;
  mimeType: string;
  width: number;
  height: number;
};

const safeName = (value: string): string =>
  value.trim().replace(/[^a-zA-Z0-9_.-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 80);

export const storePromotionEvidencePhoto = async (
  params: StorePromotionEvidencePhotoParams,
): Promise<StorePromotionEvidencePhotoResult> => {
  const normalized = await normalizeCleaningPhoto(params.data);
  const now = dayjs();
  const year = now.format('YYYY');
  const month = now.format('MMMM');
  const day = now.format('DD');
  const dateStamp = now.format('YYYYMMDD-HHmmss');
  const folder = await ensureFolderPath(`${ROOT_FOLDER}/${year}/${month}/${day}`);
  const baseOriginal = params.originalName ? safeName(path.basename(params.originalName)) : '';
  const fileName = [
    'promotion-evidence',
    `actor-${params.actorUserId}`,
    params.shiftInstanceId ? `shift-${params.shiftInstanceId}` : null,
    params.assignmentId ? `assignment-${params.assignmentId}` : null,
    dateStamp,
    baseOriginal || 'team-photo.jpg',
  ].filter(Boolean).join('_');
  const upload = await uploadBuffer({
    name: fileName.endsWith('.jpg') || fileName.endsWith('.jpeg') ? fileName : `${fileName}.jpg`,
    mimeType: normalized.mimeType,
    buffer: normalized.data,
    parents: [folder.id],
  });
  const storagePath = `${DRIVE_PREFIX}${upload.id}`;
  return {
    evidenceRef: storagePath,
    storagePath,
    driveFileId: upload.id,
    driveWebViewLink: upload.webViewLink ?? upload.webContentLink ?? null,
    sha256: normalized.sha256,
    capturedAtUtc: new Date().toISOString(),
    byteSize: normalized.data.length,
    mimeType: normalized.mimeType,
    width: normalized.width,
    height: normalized.height,
  };
};
