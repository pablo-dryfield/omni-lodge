import { Request, Response } from 'express';
import { Op, type WhereOptions } from 'sequelize';
import dayjs from 'dayjs';
import Booking from '../models/Booking.js';
import type {
  UnifiedOrder,
  UnifiedProduct,
  ManifestGroup,
  OrderExtras,
  PlatformBreakdownEntry,
} from '../types/booking.js';
import { groupOrdersForManifest } from '../utils/ecwidAdapter.js';

const DATE_FORMAT = 'YYYY-MM-DD';

type RangeBoundary = 'start' | 'end';

type QueryParams = {
  date?: string;
  pickupFrom?: string;
  pickupTo?: string;
  productId?: string;
  time?: string;
};

const normalizeDate = (value?: string, boundary: RangeBoundary = 'start'): string | null => {
  if (!value) {
    return null;
  }

  const parsed = dayjs(value);
  if (!parsed.isValid()) {
    return null;
  }

  const normalized = boundary === 'start' ? parsed.startOf('day') : parsed.endOf('day');
  return normalized.format(DATE_FORMAT);
};

const resolveRange = (query: QueryParams): { start: string | null; end: string | null } => {
  const base = query.date;
  const startCandidate = base ?? query.pickupFrom;
  const endCandidate = base ?? query.pickupTo;

  const start = normalizeDate(startCandidate, 'start');
  const end = normalizeDate(endCandidate ?? startCandidate ?? base ?? undefined, 'end');

  if (start && !end) {
    return { start, end: start };
  }
  if (!start && end) {
    return { start: end, end };
  }
  return { start, end };
};

const deriveProductId = (booking: Booking): string => {
  if (booking.productId) {
    return String(booking.productId);
  }
  if (booking.productName) {
    return `${booking.productName}`.trim().toLowerCase().replace(/\s+/g, '-');
  }
  return `${booking.platform}-${booking.id}`;
};

const buildCustomerName = (booking: Booking): string => {
  const nameParts = [booking.guestFirstName, booking.guestLastName].filter(Boolean);
  if (nameParts.length > 0) {
    return nameParts.join(' ');
  }
  if (booking.guestEmail) {
    return booking.guestEmail;
  }
  if (booking.guestPhone) {
    return booking.guestPhone;
  }
  return `Booking #${booking.id}`;
};

const normalizeExtras = (snapshot: unknown): OrderExtras => {
  if (!snapshot || typeof snapshot !== 'object') {
    return { tshirts: 0, cocktails: 0, photos: 0 };
  }
  const extras = (snapshot as { extras?: Partial<OrderExtras> }).extras;
  if (!extras) {
    return { tshirts: 0, cocktails: 0, photos: 0 };
  }
  return {
    tshirts: Number(extras.tshirts) || 0,
    cocktails: Number(extras.cocktails) || 0,
    photos: Number(extras.photos) || 0,
  };
};

const bookingToUnifiedOrder = (booking: Booking): UnifiedOrder | null => {
  const experienceDate =
    booking.experienceDate ??
    (booking.experienceStartAt ? dayjs(booking.experienceStartAt).format(DATE_FORMAT) : null);

  if (!experienceDate) {
    return null;
  }

  const productId = deriveProductId(booking);
  const pickupMoment = booking.experienceStartAt ? dayjs(booking.experienceStartAt) : null;
  const timeslot = pickupMoment?.isValid() ? pickupMoment.format('HH:mm') : '--:--';
  const menCount = booking.partySizeAdults ?? booking.partySizeTotal ?? 0;
  const womenCount = booking.partySizeChildren ?? 0;
  const extras = normalizeExtras(booking.addonsSnapshot ?? undefined);

  return {
    id: String(booking.id),
    productId,
    productName: booking.productName ?? 'Unassigned product',
    date: experienceDate,
    timeslot,
    quantity: booking.partySizeTotal ?? booking.partySizeAdults ?? 0,
    menCount,
    womenCount,
    customerName: buildCustomerName(booking),
    customerPhone: booking.guestPhone ?? undefined,
    platform: booking.platform,
    pickupDateTime: pickupMoment?.isValid() ? pickupMoment.toISOString() : undefined,
    extras,
    rawData: {
      bookingId: booking.id,
      platform: booking.platform,
    },
  };
};

const collectProducts = (orders: UnifiedOrder[]): UnifiedProduct[] => {
  const map = new Map<string, UnifiedProduct>();

  orders.forEach((order) => {
    if (!map.has(order.productId)) {
      map.set(order.productId, {
        id: order.productId,
        name: order.productName,
        platform: order.platform,
      });
    }
  });

  return Array.from(map.values());
};

export const listBookings = async (req: Request, res: Response): Promise<void> => {
  try {
    const { start, end } = resolveRange(req.query as QueryParams);

    const where: WhereOptions = {};
    if (start && end) {
      where.experienceDate = { [Op.between]: [start, end] };
    } else if (start) {
      where.experienceDate = { [Op.gte]: start };
    } else if (end) {
      where.experienceDate = { [Op.lte]: end };
    }

    const rows = await Booking.findAll({
      where,
      order: [
        ['experienceDate', 'ASC'],
        ['experienceStartAt', 'ASC'],
        ['id', 'ASC'],
      ],
    });

    const orders = rows
      .map((booking) => bookingToUnifiedOrder(booking))
      .filter((order): order is UnifiedOrder => order !== null);

    const products = collectProducts(orders);

    res.status(200).json({
      total: orders.length,
      count: orders.length,
      products,
      orders,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load bookings';
    res.status(500).json({ message });
  }
};

export const getManifest = async (req: Request, res: Response): Promise<void> => {
  try {
    const { date, productId, time } = req.query as QueryParams;
    const targetDate = normalizeDate(date ?? dayjs().format(DATE_FORMAT), 'start');

    if (!targetDate) {
      res.status(400).json({ message: 'Invalid date provided' });
      return;
    }

    const rows = await Booking.findAll({
      where: {
        experienceDate: targetDate,
      },
      order: [
        ['experienceStartAt', 'ASC'],
        ['id', 'ASC'],
      ],
    });

    const orders = rows
      .map((booking) => bookingToUnifiedOrder(booking))
      .filter((order): order is UnifiedOrder => order !== null && order.date === targetDate);

    const filteredOrders = orders.filter((order) => {
      if (productId && order.productId !== productId) {
        return false;
      }
      if (time && order.timeslot !== time) {
        return false;
      }
      return true;
    });

    const manifest = groupOrdersForManifest(filteredOrders);

    const summary = manifest.reduce<{
      totalPeople: number;
      men: number;
      women: number;
      totalOrders: number;
      extras: OrderExtras;
      platformBreakdown: PlatformBreakdownEntry[];
    }>(
      (acc, group: ManifestGroup) => {
        acc.totalPeople += group.totalPeople;
        acc.men += group.men;
        acc.women += group.women;
        acc.totalOrders += group.orders.length;
        acc.extras.tshirts += group.extras.tshirts;
        acc.extras.cocktails += group.extras.cocktails;
        acc.extras.photos += group.extras.photos;
        group.platformBreakdown.forEach((entry) => {
          const key = entry.platform || 'unknown';
          const existing = acc.platformBreakdown.find((bucket) => bucket.platform === key);
          if (existing) {
            existing.totalPeople += entry.totalPeople;
            existing.men += entry.men;
            existing.women += entry.women;
            existing.orderCount += entry.orderCount;
            return;
          }
          acc.platformBreakdown.push({ ...entry, platform: key });
        });
        return acc;
      },
      {
        totalPeople: 0,
        men: 0,
        women: 0,
        totalOrders: 0,
        extras: { tshirts: 0, cocktails: 0, photos: 0 },
        platformBreakdown: [],
      },
    );

    summary.platformBreakdown.sort((a, b) => a.platform.localeCompare(b.platform));

    res.status(200).json({
      date: targetDate,
      filters: {
        productId: productId ?? null,
        time: time ?? null,
      },
      orders: filteredOrders,
      manifest,
      summary,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to build manifest';
    res.status(500).json({ message });
  }
};
