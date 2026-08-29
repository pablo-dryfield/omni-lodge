import crypto from 'crypto';
import path from 'path';
import dayjs from 'dayjs';
import FinanceFile from '../finance/models/FinanceFile.js';
import { deleteFinanceFileFromDrive } from '../finance/services/driveService.js';
import { getConfigValue } from './configService.js';
import { getDriveClient, uploadBuffer } from './googleDrive.js';
import {
  describeUnsafeStaffPayoutDrivePermission,
  type StaffPayoutDriveIdentity,
} from './staffPayoutReceiptDrivePrivacy.js';
import logger from '../utils/logger.js';

const ROOT_FOLDER = 'Staff Payout Receipts';
const STAFF_PAYOUT_PARENT_CONFIG = 'GOOGLE_DRIVE_STAFF_PAYOUT_RECEIPTS_PARENT_ID';
const SCHEDULES_PARENT_CONFIG = 'GOOGLE_DRIVE_SCHEDULES_PARENT_ID';
let warnedAboutSchedulesParentFallback = false;

const normalizeConfigString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const resolveStaffPayoutDriveParent = (): { id: string } => {
  const dedicatedParent = normalizeConfigString(getConfigValue(STAFF_PAYOUT_PARENT_CONFIG));
  if (dedicatedParent) {
    return { id: dedicatedParent };
  }

  const schedulesParent = normalizeConfigString(getConfigValue(SCHEDULES_PARENT_CONFIG));
  if (schedulesParent) {
    if (!warnedAboutSchedulesParentFallback) {
      logger.warn(
        `${STAFF_PAYOUT_PARENT_CONFIG} is not configured; payout evidence will use the schedules parent only if its Drive ACL is owner-only.`,
      );
      warnedAboutSchedulesParentFallback = true;
    }
    return { id: schedulesParent };
  }

  throw new Error(
    `Configure ${STAFF_PAYOUT_PARENT_CONFIG} with a private Google Drive folder before collecting payout evidence.`,
  );
};

const readDriveIdentity = async (
  drive: Awaited<ReturnType<typeof getDriveClient>>,
): Promise<StaffPayoutDriveIdentity> => {
  const response = await drive.about.get({ fields: 'user(emailAddress,permissionId)' });
  return {
    emailAddress: response.data.user?.emailAddress?.trim() || null,
    permissionId: response.data.user?.permissionId?.trim() || null,
  };
};

const assertPrivateDriveResource = async (params: {
  drive: Awaited<ReturnType<typeof getDriveClient>>;
  fileId: string;
  identity: StaffPayoutDriveIdentity;
  label: string;
}): Promise<void> => {
  let pageToken: string | undefined;
  do {
    const response = await params.drive.permissions.list({
      fileId: params.fileId,
      fields: 'nextPageToken,permissions(id,type,role,emailAddress,domain,deleted)',
      pageSize: 100,
      pageToken,
      supportsAllDrives: true,
    });
    for (const permission of response.data.permissions ?? []) {
      const unsafe = describeUnsafeStaffPayoutDrivePermission(
        permission,
        params.identity,
      );
      if (unsafe) {
        throw new Error(
          `${params.label} is not private (${unsafe}). Configure ${STAFF_PAYOUT_PARENT_CONFIG} with a private folder.`,
        );
      }
    }
    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);
};

const ensureChildFolder = async (params: {
  drive: Awaited<ReturnType<typeof getDriveClient>>;
  name: string;
  parentId: string;
}): Promise<string> => {
  const safeName = params.name.replace(/'/g, "\\'");
  const existing = await params.drive.files.list({
    q: [
      `name = '${safeName}'`,
      "mimeType = 'application/vnd.google-apps.folder'",
      'trashed = false',
      `'${params.parentId}' in parents`,
    ].join(' and '),
    fields: 'files(id)',
    pageSize: 1,
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
  });
  const existingId = existing.data.files?.[0]?.id;
  if (existingId) {
    return existingId;
  }

  const created = await params.drive.files.create({
    requestBody: {
      name: params.name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [params.parentId],
    },
    fields: 'id',
    supportsAllDrives: true,
  });
  if (!created.data.id) {
    throw new Error(`Failed to create private Google Drive folder ${params.name}.`);
  }
  return created.data.id;
};

const ensurePrivateReceiptFolder = async (
  segments: string[],
): Promise<{
  id: string;
  drive: Awaited<ReturnType<typeof getDriveClient>>;
  identity: StaffPayoutDriveIdentity;
}> => {
  try {
    const parent = resolveStaffPayoutDriveParent();
    const drive = await getDriveClient();
    const identity = await readDriveIdentity(drive);
    await assertPrivateDriveResource({
      drive,
      fileId: parent.id,
      identity,
      label: 'Staff payout receipts Drive folder',
    });

    let parentId = parent.id;
    for (const segment of segments) {
      parentId = await ensureChildFolder({ drive, name: segment, parentId });
    }
    await assertPrivateDriveResource({
      drive,
      fileId: parentId,
      identity,
      label: 'Staff payout receipt destination folder',
    });

    return { id: parentId, drive, identity };
  } catch (error) {
    const message = (error as Error).message;
    if (message.includes(STAFF_PAYOUT_PARENT_CONFIG)) {
      throw error;
    }
    throw new Error(
      `Staff payout evidence storage could not be verified as private. Check ${STAFF_PAYOUT_PARENT_CONFIG}: ${message}`,
    );
  }
};

export type StaffPayoutReceiptFileKind = 'photo' | 'signature';

export type StoreStaffPayoutReceiptFileParams = {
  receiptId: number;
  staffUserId: number;
  paidDate: string;
  kind: StaffPayoutReceiptFileKind;
  originalName: string;
  mimeType: string;
  data: Buffer;
  uploadedBy: number;
};

const sanitizeFileName = (value: string): string =>
  path.basename(value).trim().replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 160);

export const computeStaffPayoutReceiptFileSha256 = (data: Buffer): string =>
  crypto.createHash('sha256').update(data).digest('hex');

export async function storeStaffPayoutReceiptFile(
  params: StoreStaffPayoutReceiptFileParams,
): Promise<FinanceFile> {
  if (!Buffer.isBuffer(params.data) || params.data.length === 0) {
    throw new Error('Cannot store an empty payout receipt file.');
  }

  const paidDate = dayjs(params.paidDate);
  const folderDate = paidDate.isValid() ? paidDate : dayjs();
  const folder = await ensurePrivateReceiptFolder([
    ROOT_FOLDER,
    folderDate.format('YYYY'),
    folderDate.format('MMMM'),
    `Staff ${params.staffUserId}`,
    `Receipt ${params.receiptId}`,
  ]);
  const fallbackExtension = params.kind === 'signature' ? '.png' : '.jpg';
  const requestedName = sanitizeFileName(params.originalName) || `${params.kind}${fallbackExtension}`;
  const fileName = `payout_receipt_${params.receiptId}_${params.kind}_${Date.now()}_${requestedName}`;
  const generatedIds = await folder.drive.files.generateIds({ count: 1, space: 'drive', type: 'files' });
  const reservedDriveFileId = generatedIds.data.ids?.[0]?.trim();
  if (!reservedDriveFileId) {
    throw new Error('Google Drive did not reserve an ID for payout receipt evidence.');
  }
  // Persist the reserved Drive ID before uploading. If the process or cleanup
  // fails after Drive accepts the bytes, this sensitive object remains
  // discoverable in the database instead of becoming an untracked orphan.
  const trackedFile = await FinanceFile.create({
    originalName: requestedName,
    mimeType: params.mimeType,
    sizeBytes: params.data.length,
    driveFileId: reservedDriveFileId,
    driveWebViewLink: '',
    sha256: computeStaffPayoutReceiptFileSha256(params.data),
    purpose: 'staff_payout_receipt',
    uploadedBy: params.uploadedBy,
    uploadedAt: new Date(),
  });
  try {
    const upload = await uploadBuffer({
      fileId: reservedDriveFileId,
      name: fileName,
      mimeType: params.mimeType,
      buffer: params.data,
      parents: [folder.id],
    });
    if (upload.id !== reservedDriveFileId) {
      throw new Error('Google Drive returned an unexpected ID for payout receipt evidence.');
    }
    await assertPrivateDriveResource({
      drive: folder.drive,
      fileId: upload.id,
      identity: folder.identity,
      label: 'Uploaded staff payout receipt evidence',
    });

    return trackedFile;
  } catch (error) {
    let driveCleanupSucceeded = false;
    await deleteFinanceFileFromDrive(reservedDriveFileId)
      .then(() => {
        driveCleanupSucceeded = true;
      })
      .catch((cleanupError) => {
        logger.warn(
          `Failed to clean up payout receipt Drive file ${reservedDriveFileId}; retaining finance file ${trackedFile.id} for traceability: ${(cleanupError as Error).message}`,
        );
      });
    if (driveCleanupSucceeded) {
      await trackedFile.destroy().catch((cleanupError) => {
        logger.warn(
          `Failed to clean up payout receipt tracking row ${trackedFile.id}: ${(cleanupError as Error).message}`,
        );
      });
    }
    throw error;
  }
}

export async function deleteStoredStaffPayoutReceiptFile(file: FinanceFile | null | undefined): Promise<void> {
  if (!file) {
    return;
  }
  let driveDeleted = true;
  await deleteFinanceFileFromDrive(file.driveFileId).catch((error) => {
    driveDeleted = false;
    logger.warn(`Failed to clean up payout receipt Drive file ${file.driveFileId}: ${(error as Error).message}`);
  });
  if (!driveDeleted) {
    return;
  }
  await FinanceFile.destroy({ where: { id: file.id } }).catch((error) => {
    logger.warn(`Failed to clean up payout receipt file row ${file.id}: ${(error as Error).message}`);
  });
}
