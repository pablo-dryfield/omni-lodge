import type { Response } from 'express';

import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import HttpError from '../errors/HttpError.js';
import {
  executeMaintenanceCommand,
  type MaintenanceCommandAction,
} from '../services/maintenanceCommandService.js';

const handleError = (res: Response, error: unknown): void => {
  if (error instanceof HttpError) {
    res.status(error.status).json([{ message: error.message, details: error.details }]);
    return;
  }
  const message = error instanceof Error ? error.message : 'Unexpected error';
  res.status(500).json([{ message }]);
};

export const runMaintenanceCommandHandler = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  const actionRaw = req.body?.action;
  if (typeof actionRaw !== 'string' || actionRaw.trim().length === 0) {
    res.status(400).json([{ message: 'action is required' }]);
    return;
  }

  const action = actionRaw.trim() as MaintenanceCommandAction;

  try {
    const result = await executeMaintenanceCommand(action);
    res.json({ result });
  } catch (error) {
    handleError(res, error);
  }
};
