import { Response } from 'express';
import { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import HttpError from '../errors/HttpError.js';
import logger from '../utils/logger.js';
import {
  getChannelNumbersSummary,
  recordChannelCashCollection,
  getChannelNumbersDetails,
  type ChannelNumbersDetailMetric,
} from '../services/channelNumbersService.js';
import FinanceAccount from '../finance/models/FinanceAccount.js';
import FinanceCategory from '../finance/models/FinanceCategory.js';
import FinanceClient from '../finance/models/FinanceClient.js';
import FinanceVendor from '../finance/models/FinanceVendor.js';

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

export const getBootstrap = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { startDate, endDate } = req.query;
    const [summary, accounts, categories, vendors, clients] = await Promise.all([
      getChannelNumbersSummary({
        startDate: typeof startDate === 'string' ? startDate : undefined,
        endDate: typeof endDate === 'string' ? endDate : undefined,
      }),
      FinanceAccount.findAll({ order: [['name', 'ASC']] }),
      FinanceCategory.findAll({
        order: [
          ['kind', 'ASC'],
          ['parentId', 'ASC'],
          ['name', 'ASC'],
        ],
      }),
      FinanceVendor.findAll({ order: [['name', 'ASC']] }),
      FinanceClient.findAll({ order: [['name', 'ASC']] }),
    ]);

    res.status(200).json({
      summary,
      finance: {
        accounts,
        categories,
        vendors,
        clients,
      },
    });
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

export const getDetails = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { startDate, endDate, channelId, productId, addonKey, metric } = req.query;
    if (typeof metric !== 'string') {
      throw new HttpError(400, 'metric query parameter is required');
    }
    const response = await getChannelNumbersDetails({
      startDate: typeof startDate === 'string' ? startDate : undefined,
      endDate: typeof endDate === 'string' ? endDate : undefined,
      channelId:
        typeof channelId === 'string' && channelId.trim().length > 0 ? Number(channelId) : undefined,
      productId:
        typeof productId === 'string'
          ? productId === 'null'
            ? null
            : Number(productId)
          : undefined,
      addonKey: typeof addonKey === 'string' ? addonKey : undefined,
      metric: metric as ChannelNumbersDetailMetric,
    });
    res.status(200).json(response);
  } catch (error) {
    handleError(res, error);
  }
};
