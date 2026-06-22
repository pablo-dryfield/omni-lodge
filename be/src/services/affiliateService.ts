import dayjs from 'dayjs';
import { Op } from 'sequelize';
import Booking from '../models/Booking.js';
import Product from '../models/Product.js';
import User from '../models/User.js';
import UserType from '../models/UserType.js';
import { getConfigValue, updateConfigValue } from './configService.js';
import { fetchBookingUtmCatalog } from './bookings/bookingUtmCatalogService.js';

export type AffiliateAssignmentRule = {
  id: string;
  userId: number;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  notes: string | null;
};

export type AffiliateAssignmentsConfig = {
  rules: AffiliateAssignmentRule[];
};

export type AffiliateUserSummary = {
  id: number;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  userTypeId: number | null;
  userTypeSlug: string | null;
  userTypeName: string | null;
};

export type AffiliateBookingRow = {
  id: number;
  platformBookingId: string;
  platform: string;
  productName: string | null;
  guestName: string;
  experienceDate: string | null;
  sourceReceivedAt: string | null;
  baseAmount: number;
  currency: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  affiliateUserId: number | null;
  affiliateUserName: string | null;
  affiliateRuleId: string | null;
};

export type AffiliateDailySeriesPoint = {
  date: string;
  bookingCount: number;
  revenue: number;
};

export type AffiliateBreakdownRow = {
  label: string;
  bookingCount: number;
  revenue: number;
};

export type AffiliateTagRow = {
  value: string;
  bookingCount: number;
  revenue: number;
};

export type AffiliateOverviewResponse = {
  startDate: string;
  endDate: string;
  selectedAffiliateUserId: number | null;
  currentUser: {
    id: number;
    roleSlug: string | null;
    canManageAssignments: boolean;
  };
  affiliateUsers: AffiliateUserSummary[];
  assignments: AffiliateAssignmentsConfig;
  summary: {
    bookingCount: number;
    revenueTotal: number;
    matchedAffiliateCount: number;
    unassignedBookingCount: number;
    affiliateCount: number;
  };
  dailySeries: AffiliateDailySeriesPoint[];
  affiliateBreakdown: Array<{
    userId: number;
    userName: string;
    bookingCount: number;
    revenue: number;
  }>;
  sourceBreakdown: AffiliateBreakdownRow[];
  mediumBreakdown: AffiliateBreakdownRow[];
  campaignBreakdown: AffiliateBreakdownRow[];
  discoveredTags: {
    utmSource: AffiliateTagRow[];
    utmMedium: AffiliateTagRow[];
    utmCampaign: AffiliateTagRow[];
  };
  unassignedTags: {
    utmSource: AffiliateTagRow[];
    utmMedium: AffiliateTagRow[];
    utmCampaign: AffiliateTagRow[];
  };
  utmCatalog: {
    utmSource: string[];
    utmMedium: string[];
    utmCampaign: string[];
  };
  bookings: AffiliateBookingRow[];
};

const AFFILIATE_CONFIG_KEY = 'AFFILIATE_TAG_ASSIGNMENTS';
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

const normalizeText = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeTagValue = (value: unknown): string | null => normalizeText(value)?.toLowerCase() ?? null;

const normalizeMoney = (value: unknown): number => {
  const numeric = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(numeric) ? Math.round((numeric + Number.EPSILON) * 100) / 100 : 0;
};

const parseName = (firstName: string | null, lastName: string | null): string => {
  const parts = [normalizeText(firstName), normalizeText(lastName)].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : '-';
};

const parseCommaSeparatedTags = (value: string | null): string[] => {
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => entry.toLowerCase());
};

const buildDisplayTag = (value: string | null): string | null => {
  const trimmed = normalizeText(value);
  return trimmed ? trimmed : null;
};

const buildDateRange = (startDate: string, endDate: string): { startDate: string; endDate: string } => {
  const normalizedStart = dayjs(startDate).format('YYYY-MM-DD');
  const normalizedEnd = dayjs(endDate).format('YYYY-MM-DD');
  if (
    !ISO_DATE_PATTERN.test(normalizedStart) ||
    !ISO_DATE_PATTERN.test(normalizedEnd) ||
    !dayjs(normalizedStart).isValid() ||
    !dayjs(normalizedEnd).isValid()
  ) {
    throw new Error('startDate and endDate must be valid YYYY-MM-DD dates');
  }
  if (dayjs(normalizedEnd).isBefore(dayjs(normalizedStart), 'day')) {
    throw new Error('endDate must be on or after startDate');
  }
  return { startDate: normalizedStart, endDate: normalizedEnd };
};

const loadAssignments = async (): Promise<AffiliateAssignmentsConfig> => {
  const rawValue = getConfigValue(AFFILIATE_CONFIG_KEY);
  if (!rawValue || typeof rawValue !== 'object') {
    return { rules: [] };
  }

  const rulesRaw = Array.isArray((rawValue as { rules?: unknown }).rules) ? ((rawValue as { rules: unknown[] }).rules ?? []) : [];
  const rules = rulesRaw
    .map((rule, index) => {
      if (!rule || typeof rule !== 'object') {
        return null;
      }
      const rawRule = rule as Partial<AffiliateAssignmentRule> & { id?: unknown };
      const userId = Number(rawRule.userId ?? 0);
      if (!Number.isInteger(userId) || userId <= 0) {
        return null;
      }

      return {
        id: normalizeText(rawRule.id) ?? `rule-${index + 1}`,
        userId,
        utmSource: normalizeText(rawRule.utmSource) ?? null,
        utmMedium: normalizeText(rawRule.utmMedium) ?? null,
        utmCampaign: normalizeText(rawRule.utmCampaign) ?? null,
        notes: normalizeText(rawRule.notes) ?? null,
      } satisfies AffiliateAssignmentRule;
    })
    .filter((value): value is AffiliateAssignmentRule => Boolean(value));

  return { rules };
};

const saveAssignments = async (rules: AffiliateAssignmentRule[], actorId: number | null): Promise<AffiliateAssignmentsConfig> => {
  const normalizedRules = rules
    .map((rule, index) => ({
      id: normalizeText(rule.id) ?? `rule-${index + 1}-${rule.userId}`,
      userId: Number(rule.userId),
      utmSource: normalizeText(rule.utmSource) ?? null,
      utmMedium: normalizeText(rule.utmMedium) ?? null,
      utmCampaign: normalizeText(rule.utmCampaign) ?? null,
      notes: normalizeText(rule.notes) ?? null,
    }))
    .filter((rule) => Number.isInteger(rule.userId) && rule.userId > 0);

  await updateConfigValue({
    key: AFFILIATE_CONFIG_KEY,
    value: { rules: normalizedRules },
    actorId,
    reason: 'Updated affiliate UTM assignments',
  });

  return { rules: normalizedRules };
};

const buildMetricSeries = (rows: AffiliateBookingRow[]): AffiliateDailySeriesPoint[] => {
  const map = new Map<string, { bookingCount: number; revenue: number }>();

  rows.forEach((row) => {
    const date = row.sourceReceivedAt ? dayjs(row.sourceReceivedAt).format('YYYY-MM-DD') : null;
    if (!date) {
      return;
    }
    const entry = map.get(date) ?? { bookingCount: 0, revenue: 0 };
    entry.bookingCount += 1;
    entry.revenue += row.baseAmount;
    map.set(date, entry);
  });

  return Array.from(map.entries())
    .map(([date, metrics]) => ({
      date,
      bookingCount: metrics.bookingCount,
      revenue: normalizeMoney(metrics.revenue),
    }))
    .sort((left, right) => left.date.localeCompare(right.date));
};

const buildBreakdown = (
  rows: AffiliateBookingRow[],
  selector: (row: AffiliateBookingRow) => string | null,
): AffiliateBreakdownRow[] => {
  const map = new Map<string, { bookingCount: number; revenue: number }>();

  rows.forEach((row) => {
    const label = buildDisplayTag(selector(row)) ?? '(missing)';
    const entry = map.get(label) ?? { bookingCount: 0, revenue: 0 };
    entry.bookingCount += 1;
    entry.revenue += row.baseAmount;
    map.set(label, entry);
  });

  return Array.from(map.entries())
    .map(([label, metrics]) => ({
      label,
      bookingCount: metrics.bookingCount,
      revenue: normalizeMoney(metrics.revenue),
    }))
    .sort((left, right) => right.revenue - left.revenue || right.bookingCount - left.bookingCount || left.label.localeCompare(right.label));
};

const buildTagSummary = (rows: AffiliateBookingRow[], selector: (row: AffiliateBookingRow) => string | null): AffiliateTagRow[] => {
  const map = new Map<string, { value: string; bookingCount: number; revenue: number }>();

  rows.forEach((row) => {
    const rawValue = selector(row);
    const label = buildDisplayTag(rawValue);
    if (!label) {
      return;
    }
    const key = label.toLowerCase();
    const entry = map.get(key) ?? { value: label, bookingCount: 0, revenue: 0 };
    entry.bookingCount += 1;
    entry.revenue += row.baseAmount;
    map.set(key, entry);
  });

  return Array.from(map.values())
    .map((entry) => ({
      value: entry.value,
      bookingCount: entry.bookingCount,
      revenue: normalizeMoney(entry.revenue),
    }))
    .sort((left, right) => right.bookingCount - left.bookingCount || right.revenue - left.revenue || left.value.localeCompare(right.value));
};

const findMatchingRule = (booking: AffiliateBookingRow, rules: AffiliateAssignmentRule[]): AffiliateAssignmentRule | null => {
  const source = normalizeTagValue(booking.utmSource);
  const medium = normalizeTagValue(booking.utmMedium);
  const campaign = normalizeTagValue(booking.utmCampaign);

  for (const rule of rules) {
    const ruleSources = parseCommaSeparatedTags(rule.utmSource);
    const ruleMediums = parseCommaSeparatedTags(rule.utmMedium);
    const ruleCampaigns = parseCommaSeparatedTags(rule.utmCampaign);

    const hasAnyFilter = ruleSources.length > 0 || ruleMediums.length > 0 || ruleCampaigns.length > 0;
    if (!hasAnyFilter) {
      continue;
    }

    if (ruleSources.length > 0 && (!source || !ruleSources.includes(source))) {
      continue;
    }
    if (ruleMediums.length > 0 && (!medium || !ruleMediums.includes(medium))) {
      continue;
    }
    if (ruleCampaigns.length > 0 && (!campaign || !ruleCampaigns.includes(campaign))) {
      continue;
    }

    return rule;
  }

  return null;
};

const fetchAffiliateUsers = async (): Promise<AffiliateUserSummary[]> => {
  const users = await User.findAll({
    where: { status: true },
    include: [
      {
        model: UserType,
        as: 'role',
        required: true,
        where: { slug: 'affiliate' },
        attributes: ['id', 'slug', 'name'],
      },
    ],
    order: [['firstName', 'ASC'], ['lastName', 'ASC'], ['id', 'ASC']],
  });

  return users.map((user) => {
    const role = (user as unknown as { role?: UserType | null }).role ?? null;
    return {
      id: user.id,
      fullName: parseName(user.firstName ?? null, user.lastName ?? null),
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
      userTypeId: user.userTypeId ?? null,
      userTypeSlug: role?.slug ?? null,
      userTypeName: role?.name ?? null,
    };
  });
};

const fetchAffiliateBookings = async (startDate: string, endDate: string): Promise<AffiliateBookingRow[]> => {
  const rangeStart = `${startDate}T00:00:00.000Z`;
  const rangeEndExclusive = `${dayjs(endDate).add(1, 'day').format('YYYY-MM-DD')}T00:00:00.000Z`;
  const rows = await Booking.findAll({
    where: {
      sourceReceivedAt: {
        [Op.gte]: rangeStart,
        [Op.lt]: rangeEndExclusive,
      },
      [Op.or]: [
        { utmSource: { [Op.ne]: null } },
        { utmMedium: { [Op.ne]: null } },
        { utmCampaign: { [Op.ne]: null } },
      ],
    },
    attributes: [
      'id',
      'platformBookingId',
      'platform',
      'productName',
      'guestFirstName',
      'guestLastName',
      'experienceDate',
      'sourceReceivedAt',
      'baseAmount',
      'currency',
      'utmSource',
      'utmMedium',
      'utmCampaign',
    ],
    include: [{ model: Product, as: 'product', attributes: ['name'] }],
    order: [
      ['sourceReceivedAt', 'ASC'],
      ['id', 'ASC'],
    ],
  });

  return rows.map((row) => ({
    id: row.id,
    platformBookingId: row.platformBookingId,
    platform: row.platform,
    productName: normalizeText(row.product?.name) ?? normalizeText(row.productName) ?? null,
    guestName: parseName(row.guestFirstName ?? null, row.guestLastName ?? null),
    experienceDate: row.experienceDate ?? null,
    sourceReceivedAt: row.sourceReceivedAt ? dayjs(row.sourceReceivedAt).toISOString() : null,
    baseAmount: normalizeMoney(row.baseAmount),
    currency: row.currency ?? null,
    utmSource: normalizeText(row.utmSource),
    utmMedium: normalizeText(row.utmMedium),
    utmCampaign: normalizeText(row.utmCampaign),
    affiliateUserId: null,
    affiliateUserName: null,
    affiliateRuleId: null,
  }));
};

export const getAffiliateOverview = async (params: {
  startDate: string;
  endDate: string;
  selectedAffiliateUserId?: number | null;
  currentUserId: number;
  currentRoleSlug: string | null;
}): Promise<AffiliateOverviewResponse> => {
  const { startDate, endDate } = buildDateRange(params.startDate, params.endDate);
  const isManager = ['admin', 'administrator', 'owner', 'manager'].includes((params.currentRoleSlug ?? '').trim().toLowerCase());
  const canManageAssignments = isManager;
  const affiliateUsers = await fetchAffiliateUsers();
  const assignments = await loadAssignments();
  const bookings = await fetchAffiliateBookings(startDate, endDate);
  const affiliateUserMap = new Map(affiliateUsers.map((user) => [user.id, user]));

  const normalizedSelectedAffiliateUserId =
    params.currentRoleSlug?.trim().toLowerCase() === 'affiliate'
      ? params.currentUserId
      : Number.isInteger(params.selectedAffiliateUserId ?? NaN)
        ? Number(params.selectedAffiliateUserId)
        : null;

  if (
    params.currentRoleSlug?.trim().toLowerCase() === 'affiliate' &&
    params.selectedAffiliateUserId != null &&
    params.selectedAffiliateUserId !== params.currentUserId
  ) {
    throw new Error('Affiliate users can only view their own bookings');
  }

  const resolvedBookings = bookings
    .map((booking) => {
      const matchedRule = findMatchingRule(booking, assignments.rules);
      if (!matchedRule) {
        return {
          ...booking,
          affiliateUserId: null,
          affiliateUserName: null,
          affiliateRuleId: null,
        };
      }
      const affiliateUser = affiliateUserMap.get(matchedRule.userId) ?? null;
      return {
        ...booking,
        affiliateUserId: matchedRule.userId,
        affiliateUserName: affiliateUser?.fullName ?? null,
        affiliateRuleId: matchedRule.id,
      };
    })
    .filter((booking) => {
      if (!booking.affiliateUserId) {
        return false;
      }
      if (normalizedSelectedAffiliateUserId == null) {
        return true;
      }
      return booking.affiliateUserId === normalizedSelectedAffiliateUserId;
    });

  const matchedAffiliateIds = Array.from(new Set(resolvedBookings.map((booking) => booking.affiliateUserId).filter((value): value is number => Boolean(value))));
  const affiliateBreakdownMap = new Map<number, { bookingCount: number; revenue: number }>();

  resolvedBookings.forEach((booking) => {
    if (!booking.affiliateUserId) {
      return;
    }
    const entry = affiliateBreakdownMap.get(booking.affiliateUserId) ?? { bookingCount: 0, revenue: 0 };
    entry.bookingCount += 1;
    entry.revenue += booking.baseAmount;
    affiliateBreakdownMap.set(booking.affiliateUserId, entry);
  });

  const unassignedBookings = bookings.filter((booking) => !findMatchingRule(booking, assignments.rules));
  const discoveredTags = {
    utmSource: buildTagSummary(bookings, (booking) => booking.utmSource),
    utmMedium: buildTagSummary(bookings, (booking) => booking.utmMedium),
    utmCampaign: buildTagSummary(bookings, (booking) => booking.utmCampaign),
  };
  const unassignedTags = {
    utmSource: buildTagSummary(unassignedBookings, (booking) => booking.utmSource),
    utmMedium: buildTagSummary(unassignedBookings, (booking) => booking.utmMedium),
    utmCampaign: buildTagSummary(unassignedBookings, (booking) => booking.utmCampaign),
  };
  const utmCatalog = await fetchBookingUtmCatalog();

  const response: AffiliateOverviewResponse = {
    startDate,
    endDate,
    selectedAffiliateUserId: normalizedSelectedAffiliateUserId,
    currentUser: {
      id: params.currentUserId,
      roleSlug: params.currentRoleSlug,
      canManageAssignments,
    },
    affiliateUsers,
    assignments,
    summary: {
      bookingCount: resolvedBookings.length,
      revenueTotal: normalizeMoney(resolvedBookings.reduce((sum, booking) => sum + booking.baseAmount, 0)),
      matchedAffiliateCount: matchedAffiliateIds.length,
      unassignedBookingCount: unassignedBookings.length,
      affiliateCount: affiliateUsers.length,
    },
    dailySeries: buildMetricSeries(resolvedBookings),
    affiliateBreakdown: Array.from(affiliateBreakdownMap.entries())
      .map(([userId, metrics]) => ({
        userId,
        userName: affiliateUserMap.get(userId)?.fullName ?? `Affiliate ${userId}`,
        bookingCount: metrics.bookingCount,
        revenue: normalizeMoney(metrics.revenue),
      }))
      .sort((left, right) => right.revenue - left.revenue || right.bookingCount - left.bookingCount),
    sourceBreakdown: buildBreakdown(resolvedBookings, (booking) => booking.utmSource),
    mediumBreakdown: buildBreakdown(resolvedBookings, (booking) => booking.utmMedium),
    campaignBreakdown: buildBreakdown(resolvedBookings, (booking) => booking.utmCampaign),
    discoveredTags,
    unassignedTags,
    utmCatalog,
    bookings: resolvedBookings,
  };

  return response;
};

export const updateAffiliateAssignments = async (params: {
  rules: AffiliateAssignmentRule[];
  actorId: number;
}): Promise<AffiliateAssignmentsConfig> => {
  return saveAssignments(params.rules, params.actorId);
};
