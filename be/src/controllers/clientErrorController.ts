import type { Request, Response } from 'express';

import { ingestBrowserReports, ingestClientErrorBatch } from '../services/errorMonitoringService.js';

const requestIp = (req: Request): string | null => req.ip
  || (typeof req.socket?.remoteAddress === 'string' ? req.socket.remoteAddress : null);

export const ingestClientErrors = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await ingestClientErrorBatch(req.body?.events, {
      userId: req.monitoringUserId ?? null,
      trustedInternal: req.monitoringTrustedInternal === true,
      userAgent: req.get('user-agent') ?? null,
      ip: requestIp(req),
    });
    const persistenceFailed = result.errors.some((error) => error.retryable);
    res.status(persistenceFailed ? 503 : 202).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid client-error batch.';
    res.status(400).json({ message });
  }
};

export const ingestBrowserErrorReports = async (req: Request, res: Response): Promise<void> => {
  const result = await ingestBrowserReports(req.body, {
    userId: req.monitoringUserId ?? null,
    trustedInternal: req.monitoringTrustedInternal === true,
    userAgent: req.get('user-agent') ?? null,
    ip: requestIp(req),
  });
  res.status(result.retryableRejected > 0 ? 503 : 202).json(result);
};
