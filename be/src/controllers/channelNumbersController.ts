import { Response } from 'express';
import { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import HttpError from '../errors/HttpError.js';
import logger from '../utils/logger.js';
import { getChannelNumbersSummary, recordChannelCashCollection } from '../services/channelNumbersService.js';

function handleError(res: Response, error: unknown): void {
  if (error instanceof HttpError) {
    res.status(error.status).json({ message: error.message, details: error.details });
    return;
  }

  logger.error('Channel numbers controller error', error);
  res.status(500).json({ message: 'Internal server error' });
}

export const getSummary = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { startDate, endDate } = req.query;
    const summary = await getChannelNumbersSummary({
      startDate: typeof startDate === 'string' ? startDate : undefined,
      endDate: typeof endDate === 'string' ? endDate : undefined,
    });
    res.status(200).json(summary);
  } catch (error) {
    handleError(res, error);
  }
};

export const createCashCollectionLog = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const actorId = req.authContext?.id;
    if (!actorId) {
      throw new HttpError(401, 'Authentication required');
    }
    const payload = {
      channelId: Number(req.body.channelId),
      currency: typeof req.body.currency === 'string' ? req.body.currency : 'PLN',
      amount: Number(req.body.amount),
      rangeStart: typeof req.body.rangeStart === 'string' ? req.body.rangeStart : '',
      rangeEnd: typeof req.body.rangeEnd === 'string' ? req.body.rangeEnd : '',
      financeTransactionId:
        req.body.financeTransactionId !== undefined ? Number(req.body.financeTransactionId) : null,
      note: typeof req.body.note === 'string' ? req.body.note : null,
      actorId,
    };
    const record = await recordChannelCashCollection(payload);
    res.status(201).json(record);
  } catch (error) {
    handleError(res, error);
  }
};
