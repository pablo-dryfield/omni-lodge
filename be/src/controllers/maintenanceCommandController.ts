import type { Response } from 'express';

import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import HttpError from '../errors/HttpError.js';
import {
  executeMaintenanceCommand,
  type MaintenanceCommandAction,
  type MaintenanceCommandResult,
} from '../services/maintenanceCommandService.js';
import { randomUUID } from 'crypto';

type MaintenanceCommandJob = {
  id: string;
  action: MaintenanceCommandAction;
  status: 'running' | 'success' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  result: MaintenanceCommandResult | null;
  error: string | null;
};

const commandJobs = new Map<string, MaintenanceCommandJob>();
const activeJobByAction = new Map<MaintenanceCommandAction, string>();
const JOB_RETENTION_MS = 60 * 60 * 1000;

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

  const existingJobId = activeJobByAction.get(action);
  if (existingJobId) {
    const existingJob = commandJobs.get(existingJobId);
    if (existingJob?.status === 'running') {
      res.status(202).json({ job: existingJob });
      return;
    }
  }

  const job: MaintenanceCommandJob = {
    id: randomUUID(),
    action,
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    result: null,
    error: null,
  };
  commandJobs.set(job.id, job);
  activeJobByAction.set(action, job.id);

  void executeMaintenanceCommand(action)
    .then((result) => {
      job.result = result;
      job.status = result.status;
      job.finishedAt = new Date().toISOString();
    })
    .catch((error: unknown) => {
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : 'Maintenance command failed';
      job.finishedAt = new Date().toISOString();
    })
    .finally(() => {
      activeJobByAction.delete(action);
      setTimeout(() => commandJobs.delete(job.id), JOB_RETENTION_MS).unref?.();
    });

  res.status(202).json({ job });
};

export const getMaintenanceCommandJobHandler = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  const job = commandJobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json([{ message: 'Maintenance command job not found or expired.' }]);
    return;
  }
  res.json({ job });
};
