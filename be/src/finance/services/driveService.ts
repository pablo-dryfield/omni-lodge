import crypto from 'crypto';
import dayjs from 'dayjs';
import FinanceFile from '../models/FinanceFile.js';
import logger from '../../utils/logger.js';
import { ensureFolderPath, uploadBuffer } from '../../services/googleDrive.js';

type UploadResult = {
  driveFileId: string;
  driveWebViewLink: string;
  folderPath: string[];
};

type UploadOptions = {
  file: Express.Multer.File;
  uploadedBy: number;
};

export function computeBufferSha256(buffer: Buffer): string {
  const view = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  return crypto.createHash('sha256').update(view).digest('hex');
}

export async function uploadFinanceFile(options: UploadOptions): Promise<UploadResult> {
  const { file, uploadedBy } = options;
  if (!file || !file.buffer || file.size === 0) {
    throw new Error('Cannot upload empty file');
  }

  const now = dayjs();
  const invoicePath = `Folder of Invoices/${now.format('YYYY')}/${now.format('MMMM')}`;
  const folder = await ensureFolderPath(invoicePath);

  const safeName = file.originalname?.trim() || `invoice-${now.valueOf()}-${uploadedBy}`;

  try {
    const upload = await uploadBuffer({
      name: safeName,
      mimeType: file.mimetype,
      buffer: file.buffer,
      parents: [folder.id],
    });
    const driveWebViewLink = upload.webViewLink ?? upload.webContentLink;
    if (!driveWebViewLink) {
      throw new Error('Google Drive did not return file metadata');
    }

    return {
      driveFileId: upload.id,
      driveWebViewLink,
      folderPath: folder.path,
    };
  } catch (error) {
    logger.error(`Failed to upload finance file to Drive: ${(error as Error).message}`);
    throw error;
  }
}

export async function findDuplicateFinanceFile(sha256: string): Promise<FinanceFile | null> {
  return FinanceFile.findOne({ where: { sha256 } });
}
