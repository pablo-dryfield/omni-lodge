import { promises as fs } from 'fs';
import {
  constants as fsConstants,
  createReadStream,
  createWriteStream,
} from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import crypto from 'crypto';
import { pipeline } from 'stream/promises';
import os from 'os';
import HttpError from '../errors/HttpError.js';
import sequelize from '../config/database.js';
import { initializeAccessControl } from '../utils/initializeAccessControl.js';
import logger from '../utils/logger.js';
import { ensureFolderPath, getDriveClient } from './googleDrive.js';
import { getConfigValue, refreshConfigCacheKeys } from './configService.js';
import {
  backupCopyFingerprint,
  streamLocalBackup,
  deleteLocalBackup,
} from './backupCopyStorage.js';
import { backupWorkspaceControl } from './databaseWorkspace/controlBackup.js';

const DEFAULT_BACKUP_DIRECTORY = '/home/postgres/backups';
const DEFAULT_BACKUP_SCRIPT = '/home/postgres/backup.sh';
const resolveBackupDirectory = (): string => {
  const raw =
    (getConfigValue('DB_BACKUP_DIRECTORY') as string | null) ??
    DEFAULT_BACKUP_DIRECTORY;
  return path.resolve(raw);
};
const resolveBackupScriptPath = (): string => {
  const raw =
    (getConfigValue('DB_BACKUP_SCRIPT') as string | null) ??
    DEFAULT_BACKUP_SCRIPT;
  return path.resolve(raw);
};
const resolvePgRestoreBinary = (): string =>
  (getConfigValue('PG_RESTORE_BIN') as string | null) ?? 'pg_restore';
const resolvePsqlBinary = (): string =>
  (getConfigValue('PSQL_BIN') as string | null) ?? 'psql';
const databaseName = process.env.DB_NAME ?? 'omni_lodge_db';
const databaseUser = process.env.DB_USER ?? 'postgres';
const resolveRestoreRole = (): string =>
  ((getConfigValue('DB_BACKUP_ROLE') as string | null) ?? databaseUser).trim();
const databaseHost = process.env.DB_HOST ?? '127.0.0.1';
const databasePort = process.env.DB_PORT ?? '5432';
const adminDatabaseName = process.env.DB_ADMIN_DATABASE ?? 'postgres';
type BackupStorageMode = 'local' | 'drive' | 'both';
export type BackupLocation = 'local' | 'drive';
const nodeEnv = (process.env.NODE_ENV ?? 'development').trim().toLowerCase();
const driveEnvironmentFolderName =
  nodeEnv === 'production' ? 'Production' : 'Development';
const utcMonthFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  timeZone: 'UTC',
});

const resolveBackupStorageMode = (): BackupStorageMode => {
  const value = (
    (getConfigValue('DB_BACKUP_STORAGE') as string | null) ?? 'local'
  ).toLowerCase();
  return value === 'drive' || value === 'both' ? value : 'local';
};

const resolveDriveBackupRootFolder = (): string =>
  (getConfigValue('DB_BACKUP_DRIVE_FOLDER') as string | null) ??
  'Database Backups';

const resolveSyncOptions = () => {
  const shouldAlterSchema = Boolean(getConfigValue('DB_SYNC_ALTER') ?? false);
  return { force: false, alter: shouldAlterSchema } as const;
};

const resolveDriveEnvironmentPath = (): string =>
  `${resolveDriveBackupRootFolder()}/${driveEnvironmentFolderName}`;

export type BackupFileDescriptor = {
  filename: string;
  fullPath: string;
  sizeBytes: number;
  createdAt: string;
  modifiedAt: string;
  driveFileId?: string;
  location: BackupLocation;
  sha256Checksum?: string;
};
export type BackupCopy = BackupFileDescriptor & {
  id: string;
  fingerprint: string;
};
const backupConfigKeys = [
  'DB_BACKUP_WORKSPACE_CONTROL_ENABLED',
  'PG_DUMP_BIN',
  'DB_BACKUP_COMMAND_TIMEOUT_MS',
  'DB_BACKUP_STORAGE',
  'DB_BACKUP_KEEP_LOCAL_COPY',
  'DB_BACKUP_DIRECTORY',
  'DB_BACKUP_SCRIPT',
  'DB_BACKUP_DRIVE_FOLDER',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REFRESH_TOKEN',
];
const backupCopy = (file: BackupFileDescriptor): BackupCopy => {
  const id =
    file.location === 'drive'
      ? `drive:${file.driveFileId}`
      : `local:${file.filename}`;
  return { ...file, id, fingerprint: backupCopyFingerprint({ ...file, id }) };
};

export const listBackupCopies = async (): Promise<{
  files: BackupCopy[];
  stores: Array<{
    location: BackupLocation;
    available: boolean;
    count: number;
    message?: string;
  }>;
  storageMode: BackupStorageMode;
  keepLocalAfterUpload: boolean;
}> => {
  await refreshConfigCacheKeys(backupConfigKeys);
  const results = await Promise.allSettled([
      listLocalBackupFiles(),
      listDriveBackupFiles(),
    ]),
    files: BackupCopy[] = [],
    stores: Array<{
      location: BackupLocation;
      available: boolean;
      count: number;
      message?: string;
    }> = [];
  results.forEach((result, index) => {
    const location = index === 0 ? 'local' : 'drive';
    if (result.status === 'fulfilled') {
      files.push(...result.value.map(backupCopy));
      stores.push({ location, available: true, count: result.value.length });
    } else
      stores.push({
        location,
        available: false,
        count: 0,
        message:
          location === 'local'
            ? 'Server backup directory is unavailable or not readable by this service.'
            : 'Google Drive backup inventory is unavailable. Check its configured folder, OAuth credentials and permissions.',
      });
  });
  return {
    files: files.sort(
      (a, b) =>
        b.modifiedAt.localeCompare(a.modifiedAt) || a.id.localeCompare(b.id),
    ),
    stores,
    storageMode: resolveBackupStorageMode(),
    keepLocalAfterUpload:
      resolveBackupStorageMode() === 'both' ||
      getConfigValue('DB_BACKUP_KEEP_LOCAL_COPY') === true,
  };
};
export const findBackupCopy = async (
  id: string,
  expectedFingerprint?: string,
): Promise<BackupCopy> => {
  const inventory = await listBackupCopies(),
    copy = inventory.files.find((f) => f.id === id);
  if (!copy)
    throw new HttpError(
      404,
      'This backup copy is unavailable in the configured server/Drive inventory.',
    );
  if (expectedFingerprint && copy.fingerprint !== expectedFingerprint)
    throw new HttpError(
      409,
      'The selected backup copy changed. Refresh and review it again.',
    );
  return copy;
};
export const streamBackupCopy = async (
  id: string,
  destination: NodeJS.WritableStream,
  expectedFingerprint?: string,
): Promise<void> => {
  const copy = await findBackupCopy(id, expectedFingerprint);
  if (copy.location === 'local')
    await streamLocalBackup(resolveBackupDirectory(), copy, destination);
  else await streamDriveFileToDestination(copy.driveFileId!, destination);
};
export const deleteBackupCopy = async (
  id: string,
  expectedFingerprint: string,
  permanent = false,
): Promise<void> => {
  const copy = await findBackupCopy(id, expectedFingerprint);
  if (copy.location === 'local') {
    await deleteLocalBackup(resolveBackupDirectory(), copy);
    return;
  }
  const drive = await getDriveClient();
  // File identity comes from the configured backup-folder inventory, never a
  // browser-supplied arbitrary Drive file ID.
  const current = await drive.files.get(
    {
      fileId: copy.driveFileId!,
      fields: 'id,name,size,modifiedTime,trashed,sha256Checksum',
      supportsAllDrives: true,
    },
    { timeout: 30000 },
  );
  if (
    current.data.trashed ||
    current.data.name !== copy.filename ||
    Number(current.data.size) !== copy.sizeBytes ||
    current.data.modifiedTime !== copy.modifiedAt
  )
    throw new HttpError(
      409,
      'The Drive backup changed. Refresh before deleting this copy.',
    );
  if (permanent)
    await drive.files.delete(
      { fileId: copy.driveFileId!, supportsAllDrives: true },
      { timeout: 30000 },
    );
  else
    await drive.files.update(
      {
        fileId: copy.driveFileId!,
        requestBody: { trashed: true },
        supportsAllDrives: true,
      },
      { timeout: 30000 },
    );
};

export type CommandResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  command: string;
  args: string[];
};

const isSubPath = (basePath: string, targetPath: string): boolean => {
  const normalizedBase = path.resolve(basePath);
  const normalizedTarget = path.resolve(targetPath);
  return (
    normalizedTarget === normalizedBase ||
    normalizedTarget.startsWith(`${normalizedBase}${path.sep}`)
  );
};

const resolveBackupPath = async (filename: string): Promise<string> => {
  if (!filename || filename.includes('\0')) {
    throw new HttpError(400, 'Invalid backup file name');
  }

  const backupDirectory = resolveBackupDirectory();
  const sanitizedName = path.basename(filename);
  const fullPath = path.resolve(backupDirectory, sanitizedName);

  if (!isSubPath(backupDirectory, fullPath)) {
    throw new HttpError(400, 'Access to the requested file is not permitted');
  }

  try {
    await fs.access(fullPath);
  } catch {
    throw new HttpError(404, 'Backup file not found');
  }

  return fullPath;
};

const ensureDirectory = async (dirPath: string): Promise<void> => {
  try {
    const stats = await fs.stat(dirPath);
    if (!stats.isDirectory()) {
      throw new HttpError(500, `Backup directory ${dirPath} is not a folder`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new HttpError(500, `Backup directory ${dirPath} does not exist`);
    }
    throw error;
  }
};

const runCommand = (
  command: string,
  args: string[],
  workingDirectory?: string,
): Promise<CommandResult> => {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: workingDirectory,
      detached: process.platform !== 'win32',
      windowsHide: true,
      env: {
        ...process.env,
        PGPASSWORD: process.env.DB_PASSWORD ?? process.env.PGPASSWORD,
      },
    });

    let stdout = '',
      stderr = '',
      timedOut = false,
      killTimer: NodeJS.Timeout | undefined;
    const stop = (signal: NodeJS.Signals) => {
      try {
        if (process.platform !== 'win32' && child.pid)
          process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        /* Already exited. */
      }
    };
    const timer = setTimeout(
      () => {
        timedOut = true;
        stop('SIGTERM');
        killTimer = setTimeout(() => stop('SIGKILL'), 2000);
        killTimer.unref();
      },
      Number(getConfigValue('DB_BACKUP_COMMAND_TIMEOUT_MS') ?? 900000),
    );
    timer.unref();
    const clear = () => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < 32768)
        stdout += chunk.toString('utf8').slice(0, 32768 - stdout.length);
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 32768)
        stderr += chunk.toString('utf8').slice(0, 32768 - stderr.length);
    });

    child.on('error', (error) => {
      clear();
      reject(
        new HttpError(500, `Failed to execute ${command}: ${error.message}`),
      );
    });

    child.on('close', (code) => {
      clear();

      if (code !== 0 || timedOut) {
        reject(
          new HttpError(
            500,
            timedOut
              ? 'Backup command exceeded its configured timeout'
              : `Command ${command} exited with code ${code}`,
            {
              stdout,
              stderr,
              args,
            },
          ),
        );
        return;
      }

      resolve({
        exitCode: code,
        stdout,
        stderr,
        command,
        args,
      });
    });
  });
};

const getDriveFolderIdForDate = async (date: Date): Promise<string> => {
  const year = date.getUTCFullYear().toString();
  const month = utcMonthFormatter.format(date);
  const folderPath = `${resolveDriveEnvironmentPath()}/${year}/${month}`;
  const folder = await ensureFolderPath(folderPath);
  return folder.id;
};

type DriveFileMetadata = {
  id: string;
  name: string;
  sizeBytes: number;
  createdAt: string;
  modifiedAt: string;
  sha256Checksum?: string;
};

const findDriveEnvironmentFolderId = async (): Promise<string | null> => {
  const drive = await getDriveClient();
  let parent: string | null = null;
  for (const name of resolveDriveEnvironmentPath().split('/').filter(Boolean)) {
    const escaped = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const { data }: { data: { files?: Array<{ id?: string | null }> } } =
      await drive.files.list({
        q: `name = '${escaped}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false and '${parent || 'root'}' in parents`,
        fields: 'files(id)',
        pageSize: 2,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
    if (!data.files?.length) return null;
    if (data.files.length > 1)
      throw new HttpError(
        409,
        'Backup folder name is ambiguous. Resolve duplicate Drive folders before managing backups.',
      );
    parent = data.files[0].id || null;
    if (!parent) return null;
  }
  return parent;
};

const listDriveFiles = async (): Promise<DriveFileMetadata[]> => {
  const drive = await getDriveClient();
  const envFolderId = await findDriveEnvironmentFolderId();
  if (!envFolderId) return [];

  const gather = async (parentId: string): Promise<DriveFileMetadata[]> => {
    const result: DriveFileMetadata[] = [];
    let pageToken: string | undefined;

    do {
      const { data } = await drive.files.list({
        q: `'${parentId}' in parents and trashed = false`,
        fields:
          'nextPageToken, files(id, name, size, mimeType, createdTime, modifiedTime, sha256Checksum)',
        pageSize: 100,
        pageToken,
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
      });

      pageToken = data.nextPageToken ?? undefined;
      for (const file of data.files ?? []) {
        const id = file.id;
        const name = file.name;
        if (!id || !name) {
          continue;
        }

        if (file.mimeType === 'application/vnd.google-apps.folder') {
          const childFiles = await gather(id);
          result.push(...childFiles);
          continue;
        }
        if (!name.endsWith('.backup')) continue;

        const size = file.size ? Number(file.size) : 0;
        const created = file.createdTime ?? new Date().toISOString();
        const modified = file.modifiedTime ?? created;
        result.push({
          id,
          name,
          sizeBytes: size,
          createdAt: created,
          modifiedAt: modified,
          sha256Checksum: file.sha256Checksum || undefined,
        });
      }
    } while (pageToken);

    return result;
  };

  const files = await gather(envFolderId);
  files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  return files;
};

const findDriveFileByName = async (
  filename: string,
): Promise<DriveFileMetadata | null> => {
  const files = await listDriveFiles();
  const match = files.find((file) => file.name === filename);
  return match ?? null;
};

const uploadFileToDrive = async (
  filePath: string,
  filename: string,
  fileDate: Date,
): Promise<string> => {
  const drive = await getDriveClient();
  const folderId = await getDriveFolderIdForDate(fileDate);
  const stream = createReadStream(filePath);

  const response = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [folderId],
    },
    media: {
      mimeType: 'application/octet-stream',
      body: stream,
    },
    fields: 'id',
    supportsAllDrives: true,
  });

  const fileId = response.data.id;
  if (!fileId) {
    throw new Error(`Drive upload failed for ${filename}`);
  }
  const stat = await fs.stat(filePath),
    hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  const checksum = hash.digest('hex'),
    remote = await drive.files.get(
      { fileId, fields: 'id,size,sha256Checksum', supportsAllDrives: true },
      { timeout: 30000 },
    );
  if (
    Number(remote.data.size) !== stat.size ||
    remote.data.sha256Checksum !== checksum
  )
    throw new HttpError(
      409,
      'Drive backup upload could not be verified by size and SHA-256. The server archive is retained.',
    );
  return fileId;
};

const downloadDriveFileToPath = async (
  fileId: string,
  destinationPath: string,
): Promise<void> => {
  const drive = await getDriveClient();
  const { data } = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream' },
  );
  const destination = createWriteStream(destinationPath);
  await pipeline(data as unknown as NodeJS.ReadableStream, destination);
};

const streamDriveFileToDestination = async (
  fileId: string,
  destination: NodeJS.WritableStream,
): Promise<void> => {
  const drive = await getDriveClient();
  const { data } = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream' },
  );
  await pipeline(data as unknown as NodeJS.ReadableStream, destination);
};

type SyncOptions = {
  deleteAfterUpload?: boolean;
  skipExisting?: boolean;
};

export const syncLocalBackupsToDrive = async (
  options: SyncOptions = {},
): Promise<{
  uploaded: string[];
  skipped: string[];
  failed: string[];
}> => {
  await refreshConfigCacheKeys(backupConfigKeys);
  if (resolveBackupStorageMode() === 'local') {
    return { uploaded: [], skipped: [], failed: [] };
  }

  const backups = await listLocalBackupFiles();
  if (backups.length === 0) {
    return { uploaded: [], skipped: [], failed: [] };
  }

  const uploaded: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];
  const deleteAfterUpload =
    options.deleteAfterUpload === true &&
    resolveBackupStorageMode() === 'drive' &&
    getConfigValue('DB_BACKUP_KEEP_LOCAL_COPY') !== true;
  const driveExistingFiles = await listDriveFiles();

  for (const backup of backups) {
    try {
      const existing = driveExistingFiles.filter(
        (file) => file.name === backup.filename,
      );
      if (existing.length && options.skipExisting) {
        const hash = crypto.createHash('sha256');
        for await (const chunk of createReadStream(backup.fullPath))
          hash.update(chunk);
        const checksum = hash.digest('hex');
        if (
          !existing.some(
            (file) =>
              file.sizeBytes === backup.sizeBytes &&
              file.sha256Checksum === checksum,
          )
        )
          throw new HttpError(
            409,
            'A different or unverifiable Drive archive has this filename. The server copy is retained; resolve it manually.',
          );
        skipped.push(backup.filename);
        if (deleteAfterUpload)
          await deleteLocalBackup(resolveBackupDirectory(), {
            id: `local:${backup.filename}`,
            filename: backup.filename,
            location: 'local',
            sizeBytes: backup.sizeBytes,
            modifiedAt: backup.modifiedAt,
          });
        continue;
      }
      const backupDate = new Date(
        backup.modifiedAt ?? backup.createdAt ?? new Date().toISOString(),
      );
      const fileId = await uploadFileToDrive(
        backup.fullPath,
        backup.filename,
        backupDate,
      );
      uploaded.push(backup.filename);
      logger.info(
        `[db-backup] Uploaded ${backup.filename} to Drive (fileId=${fileId})`,
      );

      if (deleteAfterUpload) {
        try {
          await deleteLocalBackup(resolveBackupDirectory(), {
            id: `local:${backup.filename}`,
            filename: backup.filename,
            location: 'local',
            sizeBytes: backup.sizeBytes,
            modifiedAt: backup.modifiedAt,
          });
        } catch (error) {
          logger.warn(
            `Failed to delete local backup ${backup.fullPath}: ${(error as Error).message}`,
          );
        }
      }
    } catch (error) {
      failed.push(backup.filename);
      logger.error(
        `Failed to upload backup ${backup.filename} to Drive`,
        error,
      );
    }
  }

  return { uploaded, skipped, failed };
};

const runSqlCommand = (
  sql: string,
  targetDatabase: string = databaseName,
): Promise<CommandResult> => {
  const args = [
    '-h',
    databaseHost,
    '-p',
    databasePort,
    '-U',
    databaseUser,
    '-d',
    targetDatabase,
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    sql,
  ];

  return runCommand(resolvePsqlBinary(), args);
};

export const streamBackupFile = async (
  filename: string,
  destination: NodeJS.WritableStream,
): Promise<void> => {
  if (resolveBackupStorageMode() !== 'local') {
    const driveFile = await findDriveFileByName(filename);
    if (!driveFile) {
      throw new HttpError(404, 'Backup file not found on Drive');
    }
    await streamDriveFileToDestination(driveFile.id, destination);
    return;
  }

  const filePath = await resolveBackupPath(filename);
  const stream = createReadStream(filePath);
  await pipeline(stream, destination);
};

const listLocalBackupFiles = async (): Promise<BackupFileDescriptor[]> => {
  const backupDirectory = resolveBackupDirectory();
  await ensureDirectory(backupDirectory);

  const entries = await fs.readdir(backupDirectory, { withFileTypes: true });
  const result: BackupFileDescriptor[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    if (!entry.name.endsWith('.backup')) {
      continue;
    }

    const fullPath = path.resolve(backupDirectory, entry.name);
    if (!isSubPath(backupDirectory, fullPath)) {
      continue;
    }

    const stats = await fs.stat(fullPath);
    result.push({
      filename: entry.name,
      fullPath,
      sizeBytes: stats.size,
      createdAt: stats.birthtime.toISOString(),
      modifiedAt: stats.mtime.toISOString(),
      location: 'local',
    });
  }

  const parseTimestamp = (filename: string): number => {
    const match = filename.match(/(\d{12})/u);
    if (!match) {
      return Number.MIN_SAFE_INTEGER;
    }
    return Number.parseInt(match[1], 10);
  };

  result.sort((a, b) => {
    const aStamp = parseTimestamp(a.filename);
    const bStamp = parseTimestamp(b.filename);
    if (aStamp === bStamp) {
      return b.modifiedAt.localeCompare(a.modifiedAt);
    }
    return bStamp - aStamp;
  });
  return result;
};

const listDriveBackupFiles = async (): Promise<BackupFileDescriptor[]> => {
  const files = await listDriveFiles();
  files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));

  return files.map((file) => ({
    filename: file.name,
    fullPath: '',
    sizeBytes: file.sizeBytes,
    createdAt: file.createdAt,
    modifiedAt: file.modifiedAt,
    driveFileId: file.id,
    location: 'drive',
    sha256Checksum: file.sha256Checksum,
  }));
};

export const listBackupFiles = async (): Promise<BackupFileDescriptor[]> => {
  return resolveBackupStorageMode() !== 'local'
    ? listDriveBackupFiles()
    : listLocalBackupFiles();
};

export const restoreBackupByFilename = async (
  filename: string,
): Promise<CommandResult> => {
  if (resolveBackupStorageMode() !== 'local') {
    const driveFile = await findDriveFileByName(filename);
    if (!driveFile) {
      throw new HttpError(404, 'Backup file not found on Drive');
    }

    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'db-drive-backup-'),
    );
    const tempPath = path.resolve(tempDir, filename);
    try {
      await downloadDriveFileToPath(driveFile.id, tempPath);
      return await restoreBackupFromPath(tempPath);
    } finally {
      try {
        await fs.unlink(tempPath);
      } catch {
        // ignore cleanup errors
      }
      try {
        await fs.rmdir(tempDir);
      } catch {
        // ignore cleanup errors
      }
    }
  }

  const filePath = await resolveBackupPath(filename);
  return restoreBackupFromPath(filePath);
};

const recreateDatabase = async (): Promise<void> => {
  const escapedDbLiteral = databaseName.replace(/'/g, "''");
  const normalizedDbName = databaseName.replace(/"/g, '""');
  const restoreRole = resolveRestoreRole();
  const normalizedRole = restoreRole.replace(/"/g, '""');
  const quotedDbName = `"${normalizedDbName}"`;
  const quotedRole = `"${normalizedRole}"`;

  const terminateConnectionsSql = `
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = '${escapedDbLiteral}'
  AND pid <> pg_backend_pid();
`.trim();

  const dropDatabaseSql = `DROP DATABASE IF EXISTS ${quotedDbName};`;
  const createDatabaseSql = `CREATE DATABASE ${quotedDbName} OWNER ${quotedRole};`;

  await runSqlCommand(terminateConnectionsSql, adminDatabaseName);
  await runSqlCommand(dropDatabaseSql, adminDatabaseName);
  await runSqlCommand(createDatabaseSql, adminDatabaseName);
};

const isIgnorableSyncError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const extractMessage = (value: unknown): string => {
    if (!value || typeof value !== 'object') {
      return '';
    }
    const message = (value as { message?: unknown }).message;
    return typeof message === 'string' ? message.toLowerCase() : '';
  };

  const topLevelMessage = extractMessage(error);
  const parentMessage = extractMessage((error as { parent?: unknown }).parent);
  const code = (error as { parent?: { code?: string } }).parent?.code;

  if (code === '42701' || code === '42710') {
    return true;
  }

  if (
    topLevelMessage.includes('already exists') ||
    parentMessage.includes('already exists')
  ) {
    return true;
  }

  if (
    topLevelMessage.includes('duplicate column') ||
    parentMessage.includes('duplicate column')
  ) {
    return true;
  }

  return false;
};

export const restoreBackupFromPath = async (
  filePath: string,
): Promise<CommandResult> => {
  const stats = await fs.stat(filePath);
  if (!stats.isFile()) {
    throw new HttpError(400, 'Provided path is not a file');
  }

  await recreateDatabase();

  const args = [
    '-h',
    databaseHost,
    '-p',
    databasePort,
    '-U',
    databaseUser,
    '-d',
    databaseName,
    '--clean',
    '--if-exists',
    '--no-owner',
    '--no-privileges',
    '--role',
    resolveRestoreRole(),
    '-v',
    filePath,
  ];

  const result = await runCommand(
    resolvePgRestoreBinary(),
    args,
    path.dirname(filePath),
  );
  try {
    await sequelize.authenticate();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new HttpError(500, 'Database restored but reconnection failed', {
      message,
    });
  }

  try {
    await sequelize.sync(resolveSyncOptions());
  } catch (error) {
    if (isIgnorableSyncError(error)) {
      logger.warn(
        'Sequelize sync reported duplicate object; continuing restore workflow',
        error,
      );
    } else {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new HttpError(
        500,
        'Database restored but schema synchronization failed',
        { message },
      );
    }
  }

  try {
    await initializeAccessControl();
  } catch (error) {
    logger.error('Post-restore access control initialization failed', error);
  }

  return result;
};

export const executeBackupScript = async (): Promise<CommandResult> => {
  await refreshConfigCacheKeys(backupConfigKeys);
  const backupScriptPath = resolveBackupScriptPath();
  try {
    await fs.access(backupScriptPath, fsConstants.X_OK);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      throw new HttpError(
        500,
        `Backup script not found at ${backupScriptPath}`,
      );
    }
    if (err.code === 'EACCES') {
      throw new HttpError(
        500,
        `Backup script at ${backupScriptPath} is not executable`,
      );
    }
    throw error;
  }

  const result = await runCommand(
    backupScriptPath,
    [],
    path.dirname(backupScriptPath),
  );
  if (
    process.env.DB_WORKSPACE_CONTROL_URL &&
    getConfigValue('DB_BACKUP_WORKSPACE_CONTROL_ENABLED') !== false
  ) {
    await backupWorkspaceControl({
      connectionString: process.env.DB_WORKSPACE_CONTROL_URL,
      directory: resolveBackupDirectory(),
      binary: String(getConfigValue('PG_DUMP_BIN') || 'pg_dump'),
      timeoutMs: Number(
        getConfigValue('DB_BACKUP_COMMAND_TIMEOUT_MS') ?? 900000,
      ),
    });
  }

  if (resolveBackupStorageMode() !== 'local') {
    const backupDirectory = resolveBackupDirectory();
    await ensureDirectory(backupDirectory);
    const sync = await syncLocalBackupsToDrive({
      deleteAfterUpload:
        resolveBackupStorageMode() === 'drive' &&
        getConfigValue('DB_BACKUP_KEEP_LOCAL_COPY') !== true,
      skipExisting: true,
    });
    if (sync.failed.length)
      throw new HttpError(
        502,
        'Server backup exists, but one or more Google Drive copies could not be verified. Server archives were retained.',
      );
  }

  return result;
};

export const persistUploadedBackup = async (
  tempPath: string,
  originalName: string,
): Promise<string> => {
  const sanitizedName = path.basename(originalName).replace(/\s+/g, '_');
  const uniqueSuffix = crypto.randomBytes(6).toString('hex');
  const targetName = `${Date.now()}_${uniqueSuffix}_${sanitizedName}`;

  if (resolveBackupStorageMode() !== 'local') {
    if (
      resolveBackupStorageMode() === 'both' ||
      getConfigValue('DB_BACKUP_KEEP_LOCAL_COPY') === true
    ) {
      const directory = resolveBackupDirectory();
      await ensureDirectory(directory);
      await fs.copyFile(
        tempPath,
        path.join(directory, targetName),
        fsConstants.COPYFILE_EXCL,
      );
    }
    await uploadFileToDrive(tempPath, targetName, new Date());
    logger.info(`[db-backup] Uploaded manual backup ${targetName} to Drive`);
    return targetName;
  }

  const backupDirectory = resolveBackupDirectory();
  await ensureDirectory(backupDirectory);
  const destination = path.resolve(backupDirectory, targetName);

  if (!isSubPath(backupDirectory, destination)) {
    throw new HttpError(
      500,
      'Failed to store uploaded backup inside the backup directory',
    );
  }

  await fs.copyFile(tempPath, destination);
  return destination;
};
