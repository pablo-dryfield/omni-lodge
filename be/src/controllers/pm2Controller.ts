import type { Response } from 'express';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import HttpError from '../errors/HttpError.js';
import logger from '../utils/logger.js';
import { listPm2Processes, restartPm2Process as restartPm2ProcessById, getPm2ProcessLogs } from '../services/pm2Service.js';
import { readLogTail, type LogTarget } from '../services/logFileService.js';

const ensureProduction = (res: Response): boolean => {
  const nodeEnv = (process.env.NODE_ENV ?? '').trim().toLowerCase();
  if (nodeEnv !== 'production') {
    res.status(403).json([{ message: 'PM2 controls are only available in production.' }]);
    return false;
  }
  return true;
};

const handleError = (res: Response, error: unknown): void => {
  if (error instanceof HttpError) {
    res.status(error.status).json([{ message: error.message, details: error.details }]);
    return;
  }

  const message = error instanceof Error ? error.message : 'Unexpected error';
  res.status(500).json([{ message }]);
};

export const getPm2Processes = async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!ensureProduction(res)) {
    return;
  }
  try {
    const processes = await listPm2Processes();
    res.json({ processes });
  } catch (error) {
    handleError(res, error);
  }
};

export const restartPm2Process = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!ensureProduction(res)) {
    return;
  }
  const rawId = req.params.id?.trim();
  if (!rawId || !/^\d+$/u.test(rawId)) {
    res.status(400).json([{ message: 'Process id must be a number' }]);
    return;
  }

  const id = Number.parseInt(rawId, 10);
  const startedAt = new Date().toISOString();

  setImmediate(async () => {
    try {
      const result = await restartPm2ProcessById(id);
      logger.info('[pm2] Restarted process', { id, result });
    } catch (error) {
      logger.error('[pm2] Failed to restart process', error);
    }
  });

  res.status(202).json({
    message: `Restart requested for PM2 process ${id}.`,
    startedAt,
  });
};

export const getPm2Logs = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!ensureProduction(res)) {
    return;
  }

  const rawId = req.params.id?.trim();
  if (!rawId || !/^\d+$/u.test(rawId)) {
    res.status(400).json([{ message: 'Process id must be a number' }]);
    return;
  }

  const linesRaw = typeof req.query.lines === 'string' ? req.query.lines : null;
  const parsedLines = linesRaw ? Number.parseInt(linesRaw, 10) : 200;
  const lines = Number.isFinite(parsedLines) ? parsedLines : 200;

  try {
    const id = Number.parseInt(rawId, 10);
    const result = await getPm2ProcessLogs(id, lines);
    res.json({
      id,
      lines: Math.min(Math.max(Math.floor(lines), 10), 1000),
      output: result.stdout,
      stderr: result.stderr,
    });
  } catch (error) {
    handleError(res, error);
  }
};

export const getLogFile = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!ensureProduction(res)) {
    return;
  }

  const targetRaw = req.params.target?.trim().toLowerCase();
  if (targetRaw !== 'backend' && targetRaw !== 'ui') {
    res.status(400).json([{ message: 'Log target must be backend or ui.' }]);
    return;
  }

  const linesRaw = typeof req.query.lines === 'string' ? req.query.lines : null;
  const parsedLines = linesRaw ? Number.parseInt(linesRaw, 10) : 200;

  try {
    const { output, lines } = await readLogTail(targetRaw as LogTarget, parsedLines);
    res.json({ target: targetRaw, lines, output });
  } catch (error) {
    handleError(res, error);
  }
};
