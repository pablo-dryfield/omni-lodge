import { Request, Response } from 'express';
import FinanceFile from '../models/FinanceFile.js';
import { AuthenticatedRequest } from '../../types/AuthenticatedRequest';
import { computeBufferSha256, uploadFinanceFile, findDuplicateFinanceFile } from '../services/driveService.js';
import { recordFinanceAuditLog } from '../services/auditLogService.js';

function requireActor(req: AuthenticatedRequest): number {
  const actorId = req.authContext?.id;
  if (!actorId) {
    throw new Error('Missing authenticated user');
  }
  return actorId;
}

export const uploadFinanceFileHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const actorId = requireActor(req as AuthenticatedRequest);
    const file = (req as AuthenticatedRequest).file;

    if (!file) {
      res.status(400).json([{ message: 'File is required' }]);
      return;
    }

    const sha256 = computeBufferSha256(file.buffer);
    const existing = await findDuplicateFinanceFile(sha256);
    if (existing) {
      res.status(200).json(existing);
      return;
    }

    const { driveFileId, driveWebViewLink, folderPath } = await uploadFinanceFile({
      file,
      uploadedBy: actorId,
    });

    const record = await FinanceFile.create({
      originalName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      driveFileId,
      driveWebViewLink,
      sha256,
      uploadedBy: actorId,
      uploadedAt: new Date(),
    });

    await recordFinanceAuditLog({
      entity: 'finance_file',
      entityId: record.id,
      action: 'create',
      performedBy: actorId,
      metadata: {
        folderPath,
      },
    });

    res.status(201).json(record);
  } catch (error) {
    res.status(400).json([{ message: (error as Error).message }]);
  }
};

export const listFinanceFiles = async (_req: Request, res: Response): Promise<void> => {
  try {
    const files = await FinanceFile.findAll({
      order: [['uploadedAt', 'DESC']],
      limit: 50,
    });
    res.status(200).json(files);
  } catch (error) {
    res.status(500).json([{ message: (error as Error).message }]);
  }
};

