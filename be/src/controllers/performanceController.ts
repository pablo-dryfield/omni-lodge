import type { Response } from 'express';
import { QueryTypes } from 'sequelize';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import { performanceMonitorService } from '../services/performanceMonitorService.js';
import sequelize from '../config/database.js';
import { heapDiagnosticsService } from '../services/heapDiagnosticsService.js';

const sanitizeExplainSql = (value: unknown): string => {
  if (typeof value !== 'string') {
    throw new Error('SQL is required');
  }

  const trimmed = value
    .replace(/^Executing \([^)]+\):\s*/i, '')
    .trim()
    .replace(/;+\s*$/, '');

  if (!trimmed) {
    throw new Error('SQL is required');
  }

  if (/;\s*\S/.test(trimmed) || trimmed.includes(';')) {
    throw new Error('Only a single SELECT or WITH statement can be explained');
  }

  if (!/^(select|with)\b/i.test(trimmed)) {
    throw new Error('Only SELECT or WITH statements can be explained');
  }

  return trimmed;
};

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

export const runPerformanceExplainController = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const sql = sanitizeExplainSql(req.body?.sql);
    const plan = await sequelize.transaction(async (transaction) => {
      await sequelize.query(`SET LOCAL statement_timeout = '5000ms'`, {
        transaction,
        type: QueryTypes.RAW,
      });
      const rows = await sequelize.query<Record<string, string>>(
        `EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT) ${sql}`,
        {
          transaction,
          type: QueryTypes.SELECT,
        },
      );
      return rows.map((row) => row['QUERY PLAN']).filter((line): line is string => typeof line === 'string');
    });

    res.status(200).json({
      sql,
      plan,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to run EXPLAIN ANALYZE';
    res.status(400).json({ message });
  }
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
    const message = error instanceof Error ? error.message : 'Failed to capture heap snapshot';
    res.status(500).json({ message });
  }
};
