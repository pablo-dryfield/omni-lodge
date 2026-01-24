import type { Response } from 'express';
import bcrypt from 'bcryptjs';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import ConfigKey from '../models/ConfigKey.js';
import User from '../models/User.js';
import HttpError from '../errors/HttpError.js';
import {
  listConfigEntries,
  getConfigDetail,
  updateConfigValue,
  revealConfigSecret,
  getConfigHistory,
  restoreMissingConfigValues,
  listConfigSeedRuns,
} from '../services/configService.js';

const handleError = (res: Response, error: unknown): void => {
  if (error instanceof HttpError) {
    res.status(error.status).json([{ message: error.message, details: error.details }]);
    return;
  }

  const message = error instanceof Error ? error.message : 'Unexpected error';
  res.status(500).json([{ message }]);
};

const verifyPassword = async (req: AuthenticatedRequest, password?: string): Promise<boolean> => {
  const actorId = req.authContext?.id;
  if (!actorId) {
    return false;
  }
  if (!password || password.trim().length === 0) {
    return false;
  }
  const user = await User.findByPk(actorId);
  if (!user) {
    return false;
  }
  return bcrypt.compare(password, user.password);
};

const parseLimit = (value: unknown, fallback = 5, max = 25): number => {
  const parsed = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(parsed), max);
};

export const getConfigList = async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const configs = await listConfigEntries();
    res.json({ configs });
  } catch (error) {
    handleError(res, error);
  }
};

export const getConfigSeedRuns = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const limit = parseLimit(req.query.limit, 5, 25);
    const runs = await listConfigSeedRuns(limit);
    res.json({
      runs: runs.map((run) => ({
        id: run.id,
        seedKey: run.seedKey,
        runType: run.runType,
        seededBy: run.seededBy,
        seededCount: run.seededCount,
        seedDetails: run.seedDetails,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
      })),
    });
  } catch (error) {
    handleError(res, error);
  }
};

export const getConfigByKey = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const key = req.params.key;
  if (!key) {
    res.status(400).json([{ message: 'Config key is required' }]);
    return;
  }
  try {
    const config = await getConfigDetail(key);
    res.json({ config });
  } catch (error) {
    handleError(res, error);
  }
};

export const updateConfigKey = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const key = req.params.key;
  if (!key) {
    res.status(400).json([{ message: 'Config key is required' }]);
    return;
  }

  try {
    const record = await ConfigKey.findByPk(key);
    if (!record) {
      res.status(404).json([{ message: `Config key ${key} not found` }]);
      return;
    }

    if (record.isSecret) {
      const ok = await verifyPassword(req, req.body?.password);
      if (!ok) {
        res.status(403).json([{ message: 'Password confirmation is required to update secrets.' }]);
        return;
      }
    }

    const actorId = req.authContext?.id ?? null;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : null;
    const value = req.body?.value;
    const updated = await updateConfigValue({ key, value, actorId, reason });
    res.json({ config: updated });
  } catch (error) {
    handleError(res, error);
  }
};

export const revealConfigKey = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const key = req.params.key;
  if (!key) {
    res.status(400).json([{ message: 'Config key is required' }]);
    return;
  }

  try {
    const record = await ConfigKey.findByPk(key);
    if (!record) {
      res.status(404).json([{ message: `Config key ${key} not found` }]);
      return;
    }
    if (!record.isSecret) {
      res.status(400).json([{ message: 'Config key is not secret.' }]);
      return;
    }

    const ok = await verifyPassword(req, req.body?.password);
    if (!ok) {
      res.status(403).json([{ message: 'Password confirmation is required to reveal secrets.' }]);
      return;
    }

    const payload = await revealConfigSecret(key);
    res.json(payload);
  } catch (error) {
    handleError(res, error);
  }
};

export const getConfigHistoryByKey = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const key = req.params.key;
  if (!key) {
    res.status(400).json([{ message: 'Config key is required' }]);
    return;
  }
  try {
    const records = await getConfigHistory(key);
    const history = records.map((entry) => ({
      id: entry.id,
      key: entry.key,
      actorId: entry.actorId,
      oldValue: entry.isSecret ? null : entry.oldValue,
      newValue: entry.isSecret ? null : entry.newValue,
      isSecret: entry.isSecret,
      reason: entry.reason,
      createdAt: entry.createdAt,
    }));
    res.json({ history });
  } catch (error) {
    handleError(res, error);
  }
};

export const restoreConfigDefaults = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const ok = await verifyPassword(req, req.body?.password);
    if (!ok) {
      res.status(403).json([{ message: 'Password confirmation is required to restore defaults.' }]);
      return;
    }

    const actorId = req.authContext?.id ?? null;
    const seededKeys = await restoreMissingConfigValues(actorId);
    res.json({ seededCount: seededKeys.length, seededKeys });
  } catch (error) {
    handleError(res, error);
  }
};
