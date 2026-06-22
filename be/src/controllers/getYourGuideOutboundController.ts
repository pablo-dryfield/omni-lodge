import type { Request, Response } from 'express';
import HttpError from '../errors/HttpError.js';
import {
  getGetYourGuideOutboundDefaults,
  runGetYourGuideOutboundSelfTest,
  type GygOutboundMode,
} from '../services/getYourGuideOutboundService.js';

const parseMode = (value: unknown): GygOutboundMode => {
  if (value === 'prod' || value === 'production') {
    return 'prod';
  }
  return 'test';
};

const readText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

const readNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const readBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no', 'n'].includes(normalized)) {
      return false;
    }
  }
  return undefined;
};

export const getOutboundDefaults = async (_req: Request, res: Response): Promise<void> => {
  res.status(200).json(getGetYourGuideOutboundDefaults());
};

export const runOutboundSelfTest = async (req: Request, res: Response): Promise<void> => {
  const body = req.body as Record<string, unknown> | undefined;
  if (body !== undefined && !body) {
    throw new HttpError(400, 'Invalid request body');
  }

  const result = await runGetYourGuideOutboundSelfTest({
    mode: parseMode(body?.mode),
    productId: readText(body?.productId),
    externalProductId: readText(body?.externalProductId),
    supplierExternalId: readText(body?.supplierExternalId),
    gygOptionId: readNumber(body?.gygOptionId),
    gygBookingReference: readText(body?.gygBookingReference),
    ticketCode: readText(body?.ticketCode),
    includeAdditionalEndpoints: readBoolean(body?.includeAdditionalEndpoints),
  });

  res.status(200).json(result);
};
