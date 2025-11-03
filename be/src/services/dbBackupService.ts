import { promises as fs } from 'fs';
import { constants as fsConstants, createReadStream } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import crypto from 'crypto';
import { pipeline } from 'stream/promises';
import HttpError from '../errors/HttpError.js';
import sequelize from '../config/database.js';
import { initializeAccessControl } from '../utils/initializeAccessControl.js';
import logger from '../utils/logger.js';

const DEFAULT_BACKUP_DIRECTORY = '/home/postgres/backups';
const DEFAULT_BACKUP_SCRIPT = '/home/postgres/backup.sh';

const backupDirectory = path.resolve(process.env.DB_BACKUP_DIRECTORY ?? DEFAULT_BACKUP_DIRECTORY);
const backupScriptPath = path.resolve(process.env.DB_BACKUP_SCRIPT ?? DEFAULT_BACKUP_SCRIPT);
const pgRestoreBinary = process.env.PG_RESTORE_BIN ?? 'pg_restore';
const psqlBinary = process.env.PSQL_BIN ?? 'psql';
const databaseName = process.env.DB_NAME ?? 'omni_lodge_db';
const databaseUser = process.env.DB_USER ?? 'postgres';
const restoreRole = process.env.DB_BACKUP_ROLE ?? databaseUser;
const databaseHost = process.env.DB_HOST ?? '127.0.0.1';
const databasePort = process.env.DB_PORT ?? '5432';
const adminDatabaseName = process.env.DB_ADMIN_DATABASE ?? 'postgres';
const shouldAlterSchema = (process.env.DB_SYNC_ALTER ?? 'false').toLowerCase() === 'true';
const syncOptions = { force: false, alter: shouldAlterSchema } as const;

export type BackupFileDescriptor = {
  filename: string;
  fullPath: string;
  sizeBytes: number;
  createdAt: string;
  modifiedAt: string;
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
  return normalizedTarget === normalizedBase || normalizedTarget.startsWith(`${normalizedBase}${path.sep}`);
};

const resolveBackupPath = async (filename: string): Promise<string> => {
  if (!filename || filename.includes('\0')) {
    throw new HttpError(400, 'Invalid backup file name');
  }

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

const runCommand = (command: string, args: string[], workingDirectory?: string): Promise<CommandResult> => {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: workingDirectory,
      env: {
        ...process.env,
        PGPASSWORD: process.env.DB_PASSWORD ?? process.env.PGPASSWORD,
      },
    });

    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk.toString('utf8'));
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk.toString('utf8'));
    });

    child.on('error', (error) => {
      reject(new HttpError(500, `Failed to execute ${command}: ${error.message}`));
    });

    child.on('close', (code) => {
      const stdout = stdoutChunks.join('');
      const stderr = stderrChunks.join('');

      if (code !== 0) {
        reject(
          new HttpError(500, `Command ${command} exited with code ${code}`, {
            stdout,
            stderr,
            args,
          }),
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

const runSqlCommand = (sql: string, targetDatabase: string = databaseName): Promise<CommandResult> => {
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

  return runCommand(psqlBinary, args);
};

export const streamBackupFile = async (filename: string, destination: NodeJS.WritableStream): Promise<void> => {
  const filePath = await resolveBackupPath(filename);
  const stream = createReadStream(filePath);
  await pipeline(stream, destination);
};

export const listBackupFiles = async (): Promise<BackupFileDescriptor[]> => {
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

export const restoreBackupByFilename = async (filename: string): Promise<CommandResult> => {
  const filePath = await resolveBackupPath(filename);
  return restoreBackupFromPath(filePath);
};

const recreateDatabase = async (): Promise<void> => {
  const escapedDbLiteral = databaseName.replace(/'/g, "''");
  const normalizedDbName = databaseName.replace(/"/g, '""');
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

  if (topLevelMessage.includes('already exists') || parentMessage.includes('already exists')) {
    return true;
  }

  if (topLevelMessage.includes('duplicate column') || parentMessage.includes('duplicate column')) {
    return true;
  }

  return false;
};

export const restoreBackupFromPath = async (filePath: string): Promise<CommandResult> => {
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
    restoreRole,
    '-v',
    filePath,
  ];

  const result = await runCommand(pgRestoreBinary, args, path.dirname(filePath));

  try {
    await sequelize.authenticate();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new HttpError(500, 'Database restored but reconnection failed', { message });
  }

  try {
    await sequelize.sync(syncOptions);
  } catch (error) {
    if (isIgnorableSyncError(error)) {
      logger.warn('Sequelize sync reported duplicate object; continuing restore workflow', error);
    } else {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new HttpError(500, 'Database restored but schema synchronization failed', { message });
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
  try {
    await fs.access(backupScriptPath, fsConstants.X_OK);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      throw new HttpError(500, `Backup script not found at ${backupScriptPath}`);
    }
    if (err.code === 'EACCES') {
      throw new HttpError(500, `Backup script at ${backupScriptPath} is not executable`);
    }
    throw error;
  }

  return runCommand(backupScriptPath, [], path.dirname(backupScriptPath));
};

export const persistUploadedBackup = async (tempPath: string, originalName: string): Promise<string> => {
  await ensureDirectory(backupDirectory);

  const sanitizedName = path.basename(originalName).replace(/\s+/g, '_');
  const uniqueSuffix = crypto.randomBytes(6).toString('hex');
  const targetName = `${Date.now()}_${uniqueSuffix}_${sanitizedName}`;
  const destination = path.resolve(backupDirectory, targetName);

  if (!isSubPath(backupDirectory, destination)) {
    throw new HttpError(500, 'Failed to store uploaded backup inside the backup directory');
  }

  await fs.copyFile(tempPath, destination);
  return destination;
};
