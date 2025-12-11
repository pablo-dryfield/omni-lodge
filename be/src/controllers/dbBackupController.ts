import type { Response } from 'express';
import path from 'path';
import { promises as fs } from 'fs';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import HttpError from '../errors/HttpError.js';
import {
  listBackupFiles,
  restoreBackupByFilename,
  executeBackupScript,
  streamBackupFile,
  restoreBackupFromPath,
  persistUploadedBackup,
  type CommandResult,
} from '../services/dbBackupService.js';
import logger from '../utils/logger.js';

const summarizeCommandResult = (result: CommandResult) => {
  const truncate = (value: string): string => {
    const maxLength = 20_000;
    if (value.length <= maxLength) {
      return value;
    }
    return `${value.slice(0, maxLength)}\n\n[truncated ${value.length - maxLength} characters]`;
  };

  return {
    exitCode: result.exitCode,
    command: result.command,
    args: result.args,
    stdout: truncate(result.stdout),
    stderr: truncate(result.stderr),
  };
};

const handleError = (res: Response, error: unknown): void => {
  if (error instanceof HttpError) {
    res.status(error.status).json([{ message: error.message, details: error.details }]);
    return;
  }

  const message = error instanceof Error ? error.message : 'Unexpected error';
  res.status(500).json([{ message }]);
};

export const getDbBackups = async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const backups = await listBackupFiles();
    res.json({
      backups: backups.map((backup) => ({
        filename: backup.filename,
        sizeBytes: backup.sizeBytes,
        createdAt: backup.createdAt,
        modifiedAt: backup.modifiedAt,
      })),
    });
  } catch (error) {
    handleError(res, error);
  }
};

export const downloadDbBackup = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { filename } = req.params;

  if (!filename) {
    res.status(400).json([{ message: 'Filename is required' }]);
    return;
  }

  try {
    const backups = await listBackupFiles();
    const record = backups.find((entry) => entry.filename === filename);
    if (!record) {
      throw new HttpError(404, 'Backup file not found');
    }

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${record.filename}"`);
    res.setHeader('Content-Length', record.sizeBytes.toString());
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length');

    await streamBackupFile(record.filename, res);
  } catch (error) {
    if (!res.headersSent) {
      handleError(res, error);
      return;
    }
    res.destroy();
  }
};

export const restoreDbBackup = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { filename } = req.params;

  if (!filename) {
    res.status(400).json([{ message: 'Filename is required' }]);
    return;
  }

  try {
    const result = await restoreBackupByFilename(filename);
    res.json({
      message: `Database restored from ${filename}`,
      result: summarizeCommandResult(result),
    });
  } catch (error) {
    handleError(res, error);
  }
};

export const createDbBackup = async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  const startedAt = new Date().toISOString();
  setImmediate(async () => {
    try {
      const result = await executeBackupScript();
      logger.info('[db-backup] Manual backup completed', {
        startedAt,
        result: summarizeCommandResult(result),
      });
    } catch (error) {
      logger.error('[db-backup] Manual backup failed', error);
    }
  });

  res.status(202).json({
    message: 'Backup request accepted. Refresh the list in a couple of minutes to see the new entry.',
    startedAt,
  });
};

export const uploadAndRestoreDbBackup = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const file = req.file;

  if (!file) {
    res.status(400).json([{ message: 'Backup file is required' }]);
    return;
  }

  const tempPath = (file as Express.Multer.File).path;
  const originalName = (file as Express.Multer.File).originalname;

  try {
    const result = await restoreBackupFromPath(tempPath);
    const storedPath = await persistUploadedBackup(tempPath, originalName);
    const storedFilename = path.basename(storedPath);

    res.json({
      message: 'Backup uploaded and restored successfully',
      storedFilename,
      result: summarizeCommandResult(result),
    });
  } catch (error) {
    handleError(res, error);
  } finally {
    if (tempPath) {
      try {
        await fs.unlink(tempPath);
      } catch {
        // ignore cleanup errors
      }
    }
  }
};
