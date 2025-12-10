import { Request, Response } from 'express';
import { Op, type WhereOptions, fn, col, where as sequelizeWhere } from 'sequelize';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import Booking from '../models/Booking.js';
import { canonicalizeProductKeyFromSources, canonicalizeProductLabelFromSources } from '../utils/productName.js';
import type {
  UnifiedOrder,
  UnifiedProduct,
  ManifestGroup,
  OrderExtras,
  PlatformBreakdownEntry,
} from '../types/booking.js';
import { groupOrdersForManifest } from '../utils/ecwidAdapter.js';
import { BOOKING_STATUSES } from '../constants/bookings.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const DATE_FORMAT = 'YYYY-MM-DD';
const DISPLAY_TIMEZONE =
  process.env.BOOKING_DISPLAY_TIMEZONE ??
  process.env.BOOKING_PARSER_TIMEZONE ??
  process.env.ECWID_STORE_TIMEZONE ??
  'Europe/Warsaw';

type RangeBoundary = 'start' | 'end';

type QueryParams = {
  date?: string;
  pickupFrom?: string;
  pickupTo?: string;
  productId?: string;
  time?: string;
  search?: string;
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

const canonicalizeProductKey = (booking: Booking): string | null => {
  const sources = [
    prettifyProductName(booking),
    booking.product?.name ?? null,
    booking.productName ?? null,
    booking.productVariant ?? null,
  ];
  return canonicalizeProductKeyFromSources(sources);
};

const prettifyProductName = (booking: Booking): string | null => {
  const sources = [booking.product?.name ?? null, booking.productName ?? null, booking.productVariant ?? null];
  return canonicalizeProductLabelFromSources(sources);
};

const deriveProductId = (booking: Booking): string => {
  if (booking.productId) {
    return String(booking.productId);
  }

  const canonicalKey = canonicalizeProductKey(booking);
  if (canonicalKey) {
    return canonicalKey;
  }

  return `${booking.platform}-${booking.id}`;
};

const escapeSearchTerm = (input: string): string =>
  input.replace(/[%_]/g, (match) => `\\${match}`);

const buildSearchWhere = (term: string): WhereOptions => {
  const safeTerm = escapeSearchTerm(term);
  const likeValue = `%${safeTerm}%`;
  return {
    [Op.or]: [
      { platformBookingId: { [Op.iLike]: likeValue } },
      { guestPhone: { [Op.iLike]: likeValue } },
      { guestEmail: { [Op.iLike]: likeValue } },
      { guestFirstName: { [Op.iLike]: likeValue } },
      { guestLastName: { [Op.iLike]: likeValue } },
      sequelizeWhere(fn('concat_ws', ' ', col('guest_first_name'), col('guest_last_name')), {
        [Op.iLike]: likeValue,
      }),
    ],
  };
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

const coerceCount = (value: unknown): number | null => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
};

const extractPartyBreakdown = (
  snapshot?: Record<string, unknown> | null,
): { men: number | null; women: number | null } => {
  if (!snapshot || typeof snapshot !== 'object') {
    return { men: null, women: null };
  }
  const breakdown = (snapshot as { partyBreakdown?: { men?: unknown; women?: unknown } }).partyBreakdown;
  if (!breakdown || typeof breakdown !== 'object') {
    return { men: null, women: null };
  }
  return {
    men: coerceCount(breakdown.men),
    women: coerceCount(breakdown.women),
  };
};

const bookingToUnifiedOrder = (booking: Booking): UnifiedOrder | null => {
  const pickupMomentUtc = booking.experienceStartAt ? dayjs(booking.experienceStartAt) : null;
  const pickupMomentLocal =
    pickupMomentUtc?.isValid() && DISPLAY_TIMEZONE ? pickupMomentUtc.tz(DISPLAY_TIMEZONE) : pickupMomentUtc;
  const experienceDate =
    booking.experienceDate ??
    (pickupMomentLocal?.isValid()
      ? pickupMomentLocal.format(DATE_FORMAT)
      : pickupMomentUtc?.isValid()
        ? pickupMomentUtc.format(DATE_FORMAT)
        : null);

  if (!experienceDate) {
    return null;
  }

  const productId = deriveProductId(booking);
  const displayProductName = prettifyProductName(booking) ?? 'Unassigned product';
  const timeslot = pickupMomentLocal?.isValid() ? pickupMomentLocal.format('HH:mm') : '--:--';
  const snapshotBreakdown = extractPartyBreakdown(booking.addonsSnapshot ?? undefined);
  const fallbackTotal = booking.partySizeTotal ?? booking.partySizeAdults ?? null;
  let menCount = snapshotBreakdown.men;
  let womenCount = snapshotBreakdown.women;
  if (menCount === null && womenCount === null) {
    menCount = booking.partySizeAdults ?? booking.partySizeTotal ?? 0;
    womenCount = booking.partySizeChildren ?? 0;
  } else {
    const adultsFallback = booking.partySizeAdults ?? booking.partySizeTotal ?? 0;
    const childrenFallback = booking.partySizeChildren ?? 0;
    if (menCount === null && womenCount !== null) {
      menCount =
        fallbackTotal !== null
          ? Math.max(fallbackTotal - womenCount, 0)
          : Math.max(adultsFallback - womenCount, 0);
    }
    if (womenCount === null && menCount !== null) {
      womenCount =
        fallbackTotal !== null
          ? Math.max(fallbackTotal - menCount, 0)
          : Math.max(childrenFallback, 0);
    }
    menCount = menCount ?? adultsFallback;
    womenCount = womenCount ?? childrenFallback;
    if (fallbackTotal !== null) {
      const combined = menCount + womenCount;
      if (combined === 0) {
        menCount = fallbackTotal;
        womenCount = 0;
      } else if (combined !== fallbackTotal) {
        const scale = fallbackTotal / combined;
        menCount = Math.max(Math.round(menCount * scale), 0);
        womenCount = Math.max(fallbackTotal - menCount, 0);
      }
      if (menCount > fallbackTotal) {
        menCount = fallbackTotal;
        womenCount = 0;
      }
      if (womenCount > fallbackTotal) {
        womenCount = fallbackTotal;
      }
    }
  }
  if (booking.status === 'rebooked') {
    menCount = 0;
    womenCount = 0;
  }
  let extras = normalizeExtras(booking.addonsSnapshot ?? undefined);
  if (booking.status === 'rebooked') {
    extras = { tshirts: 0, cocktails: 0, photos: 0 };
  }
  const combinedCount = menCount + womenCount;
  const quantity =
    booking.status === 'rebooked'
      ? 0
      : fallbackTotal ?? (combinedCount > 0 ? combinedCount : (booking.partySizeAdults ?? 0));

  return {
    id: String(booking.id),
    platformBookingId: booking.platformBookingId,
    productId,
    productName: displayProductName,
    date: experienceDate,
    timeslot,
    quantity,
    menCount,
    womenCount,
    customerName: buildCustomerName(booking),
    customerPhone: booking.guestPhone ?? undefined,
    platform: booking.platform,
    pickupDateTime: pickupMomentUtc?.isValid() ? pickupMomentUtc.toISOString() : undefined,
    extras,
    status: booking.status,
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
    const { date, productId, time, search } = req.query as QueryParams;
    const searchTerm = typeof search === 'string' ? search.trim() : '';
    const hasSearch = searchTerm.length > 0;
    const targetDate = normalizeDate(date ?? dayjs().format(DATE_FORMAT), 'start');

    if (!targetDate) {
      res.status(400).json({ message: 'Invalid date provided' });
      return;
    }

    const rows = await Booking.findAll({
      where: hasSearch ? buildSearchWhere(searchTerm) : { experienceDate: targetDate },
      order: [
        ['experienceStartAt', 'ASC'],
        ['id', 'ASC'],
      ],
    });

    const baseOrders = rows
      .map((booking) => bookingToUnifiedOrder(booking))
      .filter((order): order is UnifiedOrder => order !== null);

    const scopedOrders = hasSearch
      ? baseOrders
      : baseOrders.filter((order) => order.date === targetDate);

    const filteredOrders = hasSearch
      ? scopedOrders
      : scopedOrders.filter((order) => {
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
      statusCounts: Record<string, number>;
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
        group.orders.forEach((order) => {
          acc.statusCounts[order.status] = (acc.statusCounts[order.status] ?? 0) + 1;
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
        statusCounts: {},
      },
    );

    summary.platformBreakdown.sort((a, b) => a.platform.localeCompare(b.platform));
    for (const status of BOOKING_STATUSES) {
      if (!(status in summary.statusCounts)) {
        summary.statusCounts[status] = 0;
      }
    }

    res.status(200).json({
      date: targetDate,
      filters: {
        productId: hasSearch ? null : productId ?? null,
        time: hasSearch ? null : time ?? null,
        search: hasSearch ? searchTerm : null,
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
