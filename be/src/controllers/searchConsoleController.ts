import type { Response } from 'express';
import HttpError from '../errors/HttpError.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import {
  createSeoActionLog,
  getSearchConsolePerformance,
  inspectSearchConsoleUrl,
  listSearchConsoleSites,
  listSeoActionLogs,
} from '../services/searchConsoleService.js';
import { analyzeGoogleSerp } from '../services/serpAnalysisService.js';

const extractMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
};

const handleError = (res: Response, error: unknown, fallback: string): void => {
  const directStatus = error instanceof HttpError ? error.status : undefined;
  const status = (error as { response?: { status?: unknown } })?.response?.status;
  const responseStatus =
    typeof directStatus === 'number'
      ? directStatus
      : typeof status === 'number' && status >= 400 && status < 500
        ? status
        : 500;
  res.status(responseStatus).json([
    { message: extractMessage(error, fallback) },
  ]);
};

export const getSearchConsoleSites = async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const sites = await listSearchConsoleSites();
    res.json({ sites });
  } catch (error) {
    handleError(res, error, 'Failed to load Search Console properties.');
  }
};

export const getSearchConsolePerformanceRows = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const siteUrl = typeof req.query.siteUrl === 'string' ? req.query.siteUrl : '';
    const dimensions =
      typeof req.query.dimensions === 'string'
        ? req.query.dimensions.split(',').map((entry) => entry.trim())
        : undefined;
    const result = await getSearchConsolePerformance({
      siteUrl,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      dimensions,
      rowLimit: req.query.rowLimit,
    });
    res.json(result);
  } catch (error) {
    handleError(res, error, 'Failed to load Search Console performance.');
  }
};

export const inspectSearchConsoleUrlController = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const siteUrl = typeof req.body?.siteUrl === 'string' ? req.body.siteUrl : '';
    const inspectionUrl = typeof req.body?.inspectionUrl === 'string' ? req.body.inspectionUrl : '';
    const result = await inspectSearchConsoleUrl({ siteUrl, inspectionUrl });
    res.json({ result });
  } catch (error) {
    handleError(res, error, 'Failed to inspect URL.');
  }
};

export const getSeoActionLogs = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const siteUrl = typeof req.query.siteUrl === 'string' ? req.query.siteUrl : '';
    const actions = await listSeoActionLogs({ siteUrl, limit: req.query.limit });
    res.json({ actions });
  } catch (error) {
    handleError(res, error, 'Failed to load SEO action history.');
  }
};

export const createSeoActionLogController = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const action = await createSeoActionLog({
      siteUrl: req.body?.siteUrl,
      actionType: req.body?.actionType,
      title: req.body?.title,
      details: req.body?.details,
      targetQuery: req.body?.targetQuery,
      targetPage: req.body?.targetPage,
      actorId: req.authContext?.id ?? null,
    });
    res.status(201).json({ action });
  } catch (error) {
    handleError(res, error, 'Failed to create SEO action.');
  }
};

export const analyzeGoogleSerpController = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const result = await analyzeGoogleSerp({
      keyword: req.body?.keyword,
      targetDomain: req.body?.targetDomain,
      location: req.body?.location,
      country: req.body?.country,
      language: req.body?.language,
      googleDomain: req.body?.googleDomain,
    });
    res.json({ result });
  } catch (error) {
    handleError(res, error, 'Failed to analyze Google SERP.');
  }
};
