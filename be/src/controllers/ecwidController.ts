import { Request, Response } from 'express';
import dayjs from 'dayjs';
import { fetchEcwidOrders } from '../services/ecwidService.js';
import { ErrorWithMessage } from '../types/ErrorWithMessage.js';

const normalizeDate = (value?: string, boundary: 'start' | 'end' = 'start'): string | undefined => {
  if (!value) {
    return undefined;
  }

  const parsed = dayjs(value);
  if (!parsed.isValid()) {
    return undefined;
  }

  const normalized = boundary === 'start' ? parsed.startOf('day') : parsed.endOf('day');
  return normalized.toISOString();
};

const toEcwidDate = (value: string): string => {
  return value.replace('Z', '+0000').replace('T', ' ');
};

export const getOrders = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      pickupDate,
      pickupFrom,
      pickupTo,
      createdFrom,
      createdTo,
      limit,
      offset,
    } = req.query as Record<string, string | undefined>;

    const effectivePickupFrom = pickupDate ?? pickupFrom;
    const effectivePickupTo = pickupDate ?? pickupTo;

    const params: Record<string, string> = {};

    if (effectivePickupFrom) {
      const normalized = normalizeDate(effectivePickupFrom, 'start');
      if (normalized) {
        params.pickupFrom = toEcwidDate(normalized);
      }
    }

    if (effectivePickupTo) {
      const normalized = normalizeDate(effectivePickupTo, 'end');
      if (normalized) {
        params.pickupTo = toEcwidDate(normalized);
      }
    }

    if (createdFrom) {
      const normalized = normalizeDate(createdFrom, 'start');
      if (normalized) {
        params.createdFrom = toEcwidDate(normalized);
      }
    }

    if (createdTo) {
      const normalized = normalizeDate(createdTo, 'end');
      if (normalized) {
        params.createdTo = toEcwidDate(normalized);
      }
    }

    if (limit) {
      params.limit = limit;
    }

    if (offset) {
      params.offset = offset;
    }

    const data = await fetchEcwidOrders(params);
    res.status(200).json(data);
  } catch (error) {
    const message = (error as ErrorWithMessage).message ?? 'Failed to fetch Ecwid orders';
    res.status(500).json([{ message }]);
  }
};