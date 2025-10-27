import { google, drive_v3 } from 'googleapis';
import { Readable } from 'stream';
import logger from '../utils/logger.js';

type EnsureFolderResult = { id: string; path: string[] };

type UploadBufferParams = {
  name: string;
  mimeType: string;
  buffer: Buffer;
  parents?: string[];
};

type UploadResult = {
  id: string;
  webViewLink: string | null;
  webContentLink: string | null;
};

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REFRESH_TOKEN,
  GOOGLE_DRIVE_SCHEDULES_PARENT_ID,
} = process.env;

const oauthClient = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
);

if (GOOGLE_REFRESH_TOKEN) {
  oauthClient.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
}

function assertDriveCredentials(): void {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    throw new Error('Missing Google API credentials for Drive integration');
  }
}

async function getDriveClient(): Promise<drive_v3.Drive> {
  assertDriveCredentials();
  return google.drive({ version: 'v3', auth: oauthClient });
}

async function ensureFolder(
  drive: drive_v3.Drive,
  name: string,
  parentId: string | null,
): Promise<string> {
  const safe = name.replace(/'/g, "\\'");
  const query = [
    `name = '${safe}'`,
    "mimeType = 'application/vnd.google-apps.folder'",
    'trashed = false',
    parentId ? `'${parentId}' in parents` : "'root' in parents'",
  ].join(' and ');

  const { data } = await drive.files.list({
    q: query,
    fields: 'files(id)',
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

  const folderId = created.data.id;
  if (!folderId) {
    throw new Error(`Failed to create Google Drive folder ${name}`);
  }

  return folderId;
}

export async function ensureFolderPath(path: string): Promise<EnsureFolderResult> {
  const segments = path
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (segments.length === 0) {
    throw new Error('ensureFolderPath requires a non-empty path');
  }

  const drive = await getDriveClient();
  let parentId: string | null = GOOGLE_DRIVE_SCHEDULES_PARENT_ID ?? null;
  const createdPath: string[] = parentId ? [] : [];

  for (const segment of segments) {
    try {
      parentId = await ensureFolder(drive, segment, parentId);
      createdPath.push(segment);
    } catch (error) {
      logger.error(`Failed to ensure Google Drive folder segment ${segment}: ${(error as Error).message}`);
      throw error;
    }
  }

  if (!parentId) {
    throw new Error(`Failed to resolve Drive folder for path ${path}`);
  }

  return { id: parentId, path: createdPath };
}

export async function uploadBuffer(params: UploadBufferParams): Promise<UploadResult> {
  const { name, mimeType, buffer, parents } = params;
  if (!buffer || buffer.length === 0) {
    throw new Error('Cannot upload empty buffer to Drive');
  }

  const drive = await getDriveClient();

  const safeName = name.trim().length > 0 ? name.trim() : `schedule-${Date.now()}`;

  const response = await drive.files.create({
    requestBody: {
      name: safeName,
      mimeType,
      parents,
    },
    media: {
      mimeType,
      body: Readable.from(buffer),
    },
    fields: 'id, webViewLink, webContentLink',
    supportsAllDrives: false,
  });

  const { id, webViewLink, webContentLink } = response.data;
  if (!id) {
    throw new Error(`Drive upload did not return an id for ${safeName}`);
  }

  return {
    id,
    webViewLink: webViewLink ?? null,
    webContentLink: webContentLink ?? null,
  };
}
