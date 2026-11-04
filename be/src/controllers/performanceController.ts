import type { Response } from 'express';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import { performanceMonitorService } from '../services/performanceMonitorService.js';
import { heapDiagnosticsService } from '../services/heapDiagnosticsService.js';

export const getPerformanceSnapshotController = async (
  _req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    res.status(200).json(await performanceMonitorService.getSnapshot());
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Failed to load performance snapshot';
    res.status(500).json({ message });
  }
};

export const runPerformanceExplainController = async (
  _req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  res
    .status(410)
    .json({
      code: 'DATABASE_WORKSPACE_REQUIRED',
      message:
        'Run estimated or actual plans in Database Workspace, using its restricted identities, review, limits and durable execution history.',
      path: '/settings/sql-helper',
    });
};

export const captureHeapSnapshotController = async (
  _req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const snapshot = await heapDiagnosticsService.captureSnapshot();
    res.status(201).json({
      snapshot,
      generatedAt: new Date().toISOString(),
      warning: 'Heap snapshot capture can briefly pause the Node process.',
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Failed to capture heap snapshot';
    res.status(500).json({ message });
  }
};
