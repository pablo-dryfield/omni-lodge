import { Request, Response } from 'express';
import dayjs from 'dayjs';
import { fetchEcwidOrders } from '../services/ecwidService.js';
import { ErrorWithMessage } from '../types/ErrorWithMessage.js';
import { groupOrdersForManifest, transformEcwidOrders } from '../utils/ecwidAdapter.js';

const DATE_FORMAT = 'YYYY-MM-DD';

type QueryParams = Record<string, string | undefined>;

type EcwidQueryParams = Record<string, string>;

type RangeBoundary = 'start' | 'end';

const normalizeDate = (value?: string, boundary: RangeBoundary = 'start'): string | undefined => {
  if (!value) {
    return undefined;
  }

  const parsed = dayjs(value);
  if (!parsed.isValid()) {
    return undefined;
  }

  const normalized = boundary === 'start' ? parsed.startOf('day') : parsed.endOf('day');
  return normalized.format('YYYY-MM-DD');
};

const toEcwidDate = (value: string): string => {
  return value.replace('Z', '+0000').replace('T', ' ');
};

const applyDateParam = (
  params: EcwidQueryParams,
  value: string | undefined,
  key: 'pickupTimeFrom' | 'pickupTimeTo' ,
  boundary: RangeBoundary,
) => {
  if (!value) {
    return;
  }

  const normalized = normalizeDate(value, boundary);
  if (normalized) {
    params[key] = toEcwidDate(normalized);
  }
};

export const getOrders = async (req: Request, res: Response): Promise<void> => {
  try {
    const { pickupDate, pickupFrom, pickupTo, limit, offset } =
      req.query as QueryParams;

    const params: EcwidQueryParams = {};

    const effectivePickupFrom = pickupDate ?? pickupFrom;
    const effectivePickupTo = pickupDate ?? pickupTo;

    applyDateParam(params, effectivePickupFrom, 'pickupTimeFrom', 'start');
    applyDateParam(params, effectivePickupTo, 'pickupTimeTo', 'end');

    if (limit) {
      params.limit = limit;
    }

    if (offset) {
      params.offset = offset;
    }

    const data = await fetchEcwidOrders(params);
    const { products, orders } = transformEcwidOrders(data.items ?? []);

    res.status(200).json({
      total: data.total,
      count: orders.length,
      offset: data.offset,
      limit: data.limit,
      products,
      orders,
    });
  } catch (error) {
    const message = (error as ErrorWithMessage).message ?? 'Failed to fetch Ecwid orders';
    res.status(500).json([{ message }]);
  }
};

export const getManifest = async (req: Request, res: Response): Promise<void> => {
  try {
    const { date, productId, time } = req.query as QueryParams;

    const fallbackDate = dayjs().startOf('day');
    const parsed = date ? dayjs(date) : fallbackDate;
    const targetDate = parsed.isValid() ? parsed.startOf('day') : fallbackDate;
    const formattedDate = targetDate.format(DATE_FORMAT);

    const pickupFrom = normalizeDate(formattedDate, 'start');
    const pickupTo = normalizeDate(formattedDate, 'end');

    const data = await fetchEcwidOrders({
      pickupFrom: pickupFrom ? toEcwidDate(pickupFrom) : undefined,
      pickupTo: pickupTo ? toEcwidDate(pickupTo) : undefined,
      limit: '500',
    });

    const { products, orders } = transformEcwidOrders(data.items ?? []);

    const filteredOrders = orders.filter((order) => {
      if (order.date !== formattedDate) {
        return false;
      }

      if (productId && order.productId !== productId) {
        return false;
      }

      if (time && order.timeslot !== time) {
        return false;
      }

      return true;
    });

    const manifest = groupOrdersForManifest(filteredOrders);

    const summary = manifest.reduce(
      (acc, group) => {
        acc.totalPeople += group.totalPeople;
        acc.men += group.men;
        acc.women += group.women;
        acc.totalOrders += group.orders.length;
        acc.extras.tshirts += group.extras.tshirts;
        acc.extras.cocktails += group.extras.cocktails;
        acc.extras.photos += group.extras.photos;
        return acc;
      },
      { totalPeople: 0, men: 0, women: 0, totalOrders: 0, extras: { tshirts: 0, cocktails: 0, photos: 0 } },
    );


    res.status(200).json({
      date: formattedDate,
      filters: {
        productId: productId ?? null,
        time: time ?? null,
      },
      products,
      orders: filteredOrders,
      manifest,
      summary,
    });
  } catch (error) {
    const message = (error as ErrorWithMessage).message ?? 'Failed to build manifest';
    res.status(500).json([{ message }]);
  }
};
