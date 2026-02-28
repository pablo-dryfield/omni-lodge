import Booking from '../../models/Booking.js';
import { getEcwidOrder, type EcwidOrder } from '../ecwidService.js';
import logger from '../../utils/logger.js';

type EcwidUtmSnapshot = {
  source: string | null;
  medium: string | null;
  campaign: string | null;
};

const normalizeValue = (value: unknown, maxLength: number): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, maxLength);
};

const stripEcwidItemSuffix = (value: string): string => value.replace(/-\d+$/, '');

const hasTrackedUtmValue = (snapshot: EcwidUtmSnapshot): boolean =>
  Boolean(snapshot.source || snapshot.medium || snapshot.campaign);

const extractPrimaryUtmData = (order: EcwidOrder): Record<string, unknown> | null => {
  const topLevel =
    order.utmData && typeof order.utmData === 'object' && !Array.isArray(order.utmData)
      ? (order.utmData as Record<string, unknown>)
      : null;
  if (topLevel && Object.keys(topLevel).length > 0) {
    return topLevel;
  }

  const datasets = Array.isArray(order.utmDataSets)
    ? order.utmDataSets.filter(
        (entry): entry is Record<string, unknown> =>
          Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry),
      )
    : [];
  if (datasets.length === 0) {
    return null;
  }
  return datasets[datasets.length - 1] ?? null;
};

const extractTrackedUtmSnapshot = (order: EcwidOrder): EcwidUtmSnapshot => {
  const raw = extractPrimaryUtmData(order);
  return {
    source: normalizeValue(raw?.source, 255),
    medium: normalizeValue(raw?.medium, 255),
    campaign: normalizeValue(raw?.campaign, 512),
  };
};

export const syncEcwidBookingUtmByBookingId = async (bookingId: number): Promise<void> => {
  const booking = await Booking.findByPk(bookingId, {
    attributes: ['id', 'platform', 'platformBookingId', 'platformOrderId', 'utmSource', 'utmMedium', 'utmCampaign'],
  });
  if (!booking || booking.platform !== 'ecwid') {
    return;
  }

  const rawOrderId = booking.platformOrderId?.trim() || booking.platformBookingId?.trim() || '';
  const orderId = stripEcwidItemSuffix(rawOrderId);
  if (!orderId) {
    return;
  }

  try {
    const order = await getEcwidOrder(orderId);
    const utm = extractTrackedUtmSnapshot(order);
    if (!hasTrackedUtmValue(utm)) {
      return;
    }

    const hasChanges =
      booking.utmSource !== utm.source ||
      booking.utmMedium !== utm.medium ||
      booking.utmCampaign !== utm.campaign;
    if (!hasChanges) {
      return;
    }

    booking.utmSource = utm.source;
    booking.utmMedium = utm.medium;
    booking.utmCampaign = utm.campaign;
    await booking.save();
  } catch (error) {
    logger.warn(
      `[booking-email] Unable to sync Ecwid UTM tags for booking ${booking.id} (order ${orderId})`,
      error,
    );
  }
};
