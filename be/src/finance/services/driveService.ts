import { google, drive_v3 } from 'googleapis';
import { Readable } from 'stream';
import crypto from 'crypto';
import dayjs from 'dayjs';
import FinanceFile from '../models/FinanceFile.js';
import logger from '../../utils/logger.js';

type UploadResult = {
  driveFileId: string;
  driveWebViewLink: string;
  folderPath: string[];
};

type UploadOptions = {
  file: Express.Multer.File;
  uploadedBy: number;
};

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REFRESH_TOKEN,
} = process.env;

const oauthClient = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
);

if (GOOGLE_REFRESH_TOKEN) {
  oauthClient.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
}

async function getDriveClient(): Promise<drive_v3.Drive> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    throw new Error('Missing Google API credentials for Drive integration');
  }
  return google.drive({ version: 'v3', auth: oauthClient });
}

async function ensureFolder(drive: drive_v3.Drive, name: string, parentId: string | null): Promise<string> {
  const queryParts = [`name = '${name.replace(/'/g, "\\'")}'`, "mimeType = 'application/vnd.google-apps.folder'", 'trashed = false'];
  if (parentId) {
    queryParts.push(`'${parentId}' in parents`);
  } else {
    queryParts.push("'root' in parents");
  }
  const query = queryParts.join(' and ');

  const { data } = await drive.files.list({
    q: query,
    fields: 'files(id, name)',
    pageSize: 1,
    supportsAllDrives: false,
  });

  const existing = data.files?.[0];
  if (existing?.id) {
    return existing.id;
  }

  const folderMetadata: drive_v3.Schema$File = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
    parents: parentId ? [parentId] : undefined,
  };

  const created = await drive.files.create({
    requestBody: folderMetadata,
    fields: 'id',
    supportsAllDrives: false,
  });

  if (!created.data.id) {
    throw new Error(`Failed to create Google Drive folder ${name}`);
  }

  return created.data.id;
}

async function ensureInvoiceFolder(drive: drive_v3.Drive, now: dayjs.Dayjs): Promise<{ folderId: string; path: string[] }> {
  const rootSegments = ['Invoices', now.format('MMMM')];
  let parentId: string | null = null;

  for (const segment of rootSegments) {
    parentId = await ensureFolder(drive, segment, parentId);
  }

  if (!parentId) {
    throw new Error('Unable to resolve Google Drive upload folder');
  }

  return { folderId: parentId, path: rootSegments };
}

export function computeBufferSha256(buffer: Buffer): string {
  const view = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  return crypto.createHash('sha256').update(view).digest('hex');
}

export async function uploadFinanceFile(options: UploadOptions): Promise<UploadResult> {
  const { file, uploadedBy } = options;
  if (!file || !file.buffer || file.size === 0) {
    throw new Error('Cannot upload empty file');
  }

  const drive = await getDriveClient();
  const now = dayjs();
  const { folderId, path } = await ensureInvoiceFolder(drive, now);

  const safeName = file.originalname?.trim() || `invoice-${now.valueOf()}-${uploadedBy}`;

  try {
    const response = await drive.files.create({
      requestBody: {
        name: safeName,
        parents: [folderId],
        mimeType: file.mimetype,
      },
      media: {
        mimeType: file.mimetype,
        body: Readable.from(file.buffer),
      },
      fields: 'id, webViewLink',
      supportsAllDrives: false,
    });

    const driveFileId = response.data.id;
    const driveWebViewLink = response.data.webViewLink;

    if (!driveFileId || !driveWebViewLink) {
      throw new Error('Google Drive did not return file metadata');
    }

    return {
      driveFileId,
      driveWebViewLink,
      folderPath: path,
    };
  } catch (error) {
    logger.error(`Failed to upload finance file to Drive: ${(error as Error).message}`);
    throw error;
  }
}

export async function findDuplicateFinanceFile(sha256: string): Promise<FinanceFile | null> {
  return FinanceFile.findOne({ where: { sha256 } });
}
