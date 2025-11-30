import { Response } from 'express';
import { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import HttpError from '../errors/HttpError.js';
import logger from '../utils/logger.js';
import { getChannelNumbersSummary } from '../services/channelNumbersService.js';

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
