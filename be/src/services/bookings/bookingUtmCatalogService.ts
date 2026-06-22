import { Op } from 'sequelize';
import Booking from '../../models/Booking.js';
import BookingUtmCatalog, { type BookingUtmCatalogField } from '../../models/BookingUtmCatalog.js';

export type BookingUtmCatalogSummary = {
  utmSource: string[];
  utmMedium: string[];
  utmCampaign: string[];
};

export type BookingUtmCatalogEntry = {
  id: number;
  field: BookingUtmCatalogField;
  value: string;
  active: boolean;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
};

const SUPPORTED_FIELDS: BookingUtmCatalogField[] = ['utm_source', 'utm_medium', 'utm_campaign'];

const normalizeCatalogValue = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeCatalogKey = (value: BookingUtmCatalogField): string => value.trim().toLowerCase();

const resolveSeenAt = (value: unknown): Date => {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.valueOf())) {
      return parsed;
    }
  }
  return new Date();
};

export const upsertBookingUtmCatalogEntry = async (params: {
  field: BookingUtmCatalogField;
  value: unknown;
  seenAt?: unknown;
}): Promise<boolean> => {
  const normalizedValue = normalizeCatalogValue(params.value);
  if (!normalizedValue) {
    return false;
  }

  const field = normalizeCatalogKey(params.field) as BookingUtmCatalogField;
  if (!SUPPORTED_FIELDS.includes(field)) {
    return false;
  }

  const normalizedLookupValue = normalizedValue.toLowerCase();
  const seenAt = resolveSeenAt(params.seenAt);
  const existing = await BookingUtmCatalog.findOne({
    where: {
      field,
      normalizedValue: normalizedLookupValue,
    },
  });

  if (existing) {
    const nextFirstSeenAt =
      existing.firstSeenAt && existing.firstSeenAt.valueOf() <= seenAt.valueOf()
        ? existing.firstSeenAt
        : seenAt;
    await existing.update({
      value: normalizedValue,
      active: true,
      firstSeenAt: nextFirstSeenAt,
      lastSeenAt: seenAt,
    });
    return false;
  }

  await BookingUtmCatalog.create({
    field,
    value: normalizedValue,
    normalizedValue: normalizedLookupValue,
    active: true,
    firstSeenAt: seenAt,
    lastSeenAt: seenAt,
  });
  return true;
};

export const seedBookingUtmCatalogFromExistingBookings = async (): Promise<{
  seededCount: number;
  details: Record<string, unknown>;
}> => {
  const rows = await Booking.findAll({
    attributes: ['utmSource', 'utmMedium', 'utmCampaign', 'sourceReceivedAt', 'createdAt', 'processedAt'],
    where: {
      [Op.or]: [
        { utmSource: { [Op.ne]: null } },
        { utmMedium: { [Op.ne]: null } },
        { utmCampaign: { [Op.ne]: null } },
      ],
    },
  });

  const seen = new Map<string, { field: BookingUtmCatalogField; value: string; seenAt: Date }>();

  rows.forEach((row) => {
    const seenAt = resolveSeenAt(row.sourceReceivedAt ?? row.processedAt ?? row.createdAt);
    const entries: Array<[BookingUtmCatalogField, unknown]> = [
      ['utm_source', row.utmSource],
      ['utm_medium', row.utmMedium],
      ['utm_campaign', row.utmCampaign],
    ];
    entries.forEach(([field, value]) => {
      const normalizedValue = normalizeCatalogValue(value);
      if (!normalizedValue) {
        return;
      }
      const key = `${field}:${normalizedValue.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.set(key, { field, value: normalizedValue, seenAt });
      }
    });
  });

  let created = 0;
  let updated = 0;
  for (const entry of seen.values()) {
    const inserted = await upsertBookingUtmCatalogEntry({
      field: entry.field,
      value: entry.value,
      seenAt: entry.seenAt,
    });
    if (inserted) {
      created += 1;
    } else {
      updated += 1;
    }
  }

  return {
    seededCount: created + updated,
    details: {
      created,
      updated,
      distinctValues: seen.size,
    },
  };
};

export const syncBookingUtmCatalogByBookingId = async (bookingId: number): Promise<void> => {
  const booking = await Booking.findByPk(bookingId, {
    attributes: ['utmSource', 'utmMedium', 'utmCampaign', 'sourceReceivedAt', 'createdAt', 'processedAt'],
  });

  if (!booking) {
    return;
  }

  const seenAt = booking.sourceReceivedAt ?? booking.processedAt ?? booking.createdAt ?? new Date();
  await Promise.all([
    upsertBookingUtmCatalogEntry({ field: 'utm_source', value: booking.utmSource, seenAt }),
    upsertBookingUtmCatalogEntry({ field: 'utm_medium', value: booking.utmMedium, seenAt }),
    upsertBookingUtmCatalogEntry({ field: 'utm_campaign', value: booking.utmCampaign, seenAt }),
  ]);
};

export const syncBookingUtmCatalogSnapshot = async (params: {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  seenAt?: unknown;
}): Promise<void> => {
  const seenAt = resolveSeenAt(params.seenAt);
  await Promise.all([
    upsertBookingUtmCatalogEntry({ field: 'utm_source', value: params.source, seenAt }),
    upsertBookingUtmCatalogEntry({ field: 'utm_medium', value: params.medium, seenAt }),
    upsertBookingUtmCatalogEntry({ field: 'utm_campaign', value: params.campaign, seenAt }),
  ]);
};

export const fetchBookingUtmCatalog = async (): Promise<BookingUtmCatalogSummary> => {
  const rows = await BookingUtmCatalog.findAll({
    where: { active: true },
    order: [
      ['field', 'ASC'],
      ['value', 'ASC'],
    ],
    attributes: ['field', 'value'],
  });

  const summary: BookingUtmCatalogSummary = {
    utmSource: [],
    utmMedium: [],
    utmCampaign: [],
  };

  rows.forEach((row) => {
    if (row.field === 'utm_source') {
      summary.utmSource.push(row.value);
    } else if (row.field === 'utm_medium') {
      summary.utmMedium.push(row.value);
    } else if (row.field === 'utm_campaign') {
      summary.utmCampaign.push(row.value);
    }
  });

  return summary;
};

export const listBookingUtmCatalogEntries = async (): Promise<BookingUtmCatalogEntry[]> => {
  const rows = await BookingUtmCatalog.findAll({
    where: { active: true },
    order: [
      ['field', 'ASC'],
      ['value', 'ASC'],
    ],
  });

  return rows.map((row) => ({
    id: row.id,
    field: row.field,
    value: row.value,
    active: row.active,
    firstSeenAt: row.firstSeenAt ?? null,
    lastSeenAt: row.lastSeenAt ?? null,
  }));
};
