import crypto from 'crypto';
import dayjs from 'dayjs';
import { Readable } from 'stream';
import FinanceFile from '../models/FinanceFile.js';
import logger from '../../utils/logger.js';
import { ensureFolderPath, getDriveClient, uploadBuffer } from '../../services/googleDrive.js';

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

export async function openFinanceFileStream(driveFileId: string): Promise<Readable> {
  if (!driveFileId || !driveFileId.trim()) {
    throw new Error('Missing Drive file id');
  }

  const drive = await getDriveClient();
  const response = await drive.files.get(
    { fileId: driveFileId.trim(), alt: 'media' },
    { responseType: 'stream' },
  );
  return response.data as unknown as Readable;
}

export async function deleteFinanceFileFromDrive(driveFileId: string | null | undefined): Promise<void> {
  if (!driveFileId || !driveFileId.trim()) {
    return;
  }

  try {
    const drive = await getDriveClient();
    await drive.files.delete({ fileId: driveFileId.trim() });
  } catch (error) {
    const code = (error as { code?: number })?.code;
    if (code === 404) {
      return;
    }
    logger.error(`Failed to delete finance file from Drive: ${(error as Error).message}`);
    throw error;
  }
}
