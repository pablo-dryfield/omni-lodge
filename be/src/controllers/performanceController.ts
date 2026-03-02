import type { Response } from 'express';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import { performanceMonitorService } from '../services/performanceMonitorService.js';

export const getPerformanceSnapshotController = async (
  _req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    res.status(200).json(await performanceMonitorService.getSnapshot());
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load performance snapshot';
    res.status(500).json({ message });
  }
};
