import dayjs from 'dayjs';
import { Op } from 'sequelize';
import Booking from '../models/Booking.js';
import Product from '../models/Product.js';
import User from '../models/User.js';
import UserType from '../models/UserType.js';
import AffiliatePayoutLog from '../models/AffiliatePayoutLog.js';
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
  status: boolean;
  userTypeId: number | null;
  userTypeSlug: string | null;
  userTypeName: string | null;
  affiliateCommissionPerPerson: number;
  financeVendorId: number | null;
};

export type AffiliateBookingRow = {
  id: number;
  platformBookingId: string;
  platform: string;
  productName: string | null;
  guestName: string;
  experienceDate: string | null;
  sourceReceivedAt: string | null;
  partySizeTotal: number;
  baseAmount: number;
  currency: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  affiliateUserId: number | null;
  affiliateUserName: string | null;
  affiliateRuleId: string | null;
  affiliateCommissionPerPerson: number | null;
  affiliateCommissionAmount: number;
  affiliateCommissionEligible: boolean;
  affiliateCommissionIneligibleReason: string | null;
  affiliatePayoutLogId: number | null;
  isCommissionPaid: boolean;
};

export type AffiliateDailySeriesPoint = {
  date: string;
  bookingCount: number;
  peopleCount: number;
  revenue: number;
  commission: number;
};

export type AffiliateBreakdownRow = {
  label: string;
  bookingCount: number;
  revenue: number;
  commission: number;
};

export type AffiliateTagRow = {
  value: string;
  bookingCount: number;
  revenue: number;
  commission: number;
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
    commissionTotal: number;
    commissionPaidTotal: number;
    commissionOutstandingTotal: number;
    paidBookingCount: number;
    unpaidBookingCount: number;
    payoutCount: number;
    matchedAffiliateCount: number;
    unassignedBookingCount: number;
    affiliateCount: number;
  };
  dailySeries: AffiliateDailySeriesPoint[];
  affiliateBreakdown: Array<{
    userId: number;
    userName: string;
    affiliateCommissionPerPerson: number;
    bookingCount: number;
    revenue: number;
    commission: number;
    paidCommission: number;
    outstandingCommission: number;
  }>;
  payoutLogs: Array<{
    id: number;
    affiliateUserId: number;
    affiliateUserName: string;
    currencyCode: string;
    amount: number;
    paidDate: string;
    rangeStart: string;
    rangeEnd: string;
    bookingCount: number;
    financeTransactionId: number | null;
    note: string | null;
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

const normalizeAffiliateCommissionPerPerson = (value: unknown, fallback = 20): number => {
  const numeric = typeof value === 'number' ? value : Number(value ?? fallback);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return fallback;
  }
  return Math.round((numeric + Number.EPSILON) * 100) / 100;
};

const AFFILIATE_COMMISSION_CUTOFF_MINUTES = 20 * 60 + 45;

const getAffiliateCommissionEligibility = (
  sourceReceivedAt: string | null,
): { eligible: boolean; reason: string | null } => {
  if (!sourceReceivedAt) {
    return { eligible: true, reason: null };
  }
  const parsed = dayjs(sourceReceivedAt);
  if (!parsed.isValid()) {
    return { eligible: true, reason: null };
  }
  const minutes = parsed.hour() * 60 + parsed.minute();
  if (minutes >= AFFILIATE_COMMISSION_CUTOFF_MINUTES) {
    return { eligible: false, reason: 'Booked after 20:45' };
  }
  return { eligible: true, reason: null };
};

const resolvePartySizeTotal = (booking: {
  partySizeTotal?: unknown;
  partySizeAdults?: unknown;
  partySizeChildren?: unknown;
}): number => {
  const total = Number(booking.partySizeTotal);
  if (Number.isFinite(total) && total > 0) {
    return Math.round(total);
  }

  const adults = Number(booking.partySizeAdults ?? 0);
  const children = Number(booking.partySizeChildren ?? 0);
  const fallbackTotal = adults + children;
  if (Number.isFinite(fallbackTotal) && fallbackTotal > 0) {
    return Math.round(fallbackTotal);
  }

  return 1;
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
  const map = new Map<string, { bookingCount: number; peopleCount: number; revenue: number; commission: number }>();

  rows.forEach((row) => {
    const date = row.sourceReceivedAt ? dayjs(row.sourceReceivedAt).format('YYYY-MM-DD') : null;
    if (!date) {
      return;
    }
    const entry = map.get(date) ?? { bookingCount: 0, peopleCount: 0, revenue: 0, commission: 0 };
    entry.bookingCount += 1;
    entry.peopleCount += row.partySizeTotal;
    entry.revenue += row.baseAmount;
    entry.commission += row.affiliateCommissionAmount;
    map.set(date, entry);
  });

  return Array.from(map.entries())
    .map(([date, metrics]) => ({
      date,
      bookingCount: metrics.bookingCount,
      peopleCount: metrics.peopleCount,
      revenue: normalizeMoney(metrics.revenue),
      commission: normalizeMoney(metrics.commission),
    }))
    .sort((left, right) => left.date.localeCompare(right.date));
};

const buildBreakdown = (
  rows: AffiliateBookingRow[],
  selector: (row: AffiliateBookingRow) => string | null,
): AffiliateBreakdownRow[] => {
  const map = new Map<string, { bookingCount: number; revenue: number; commission: number }>();

  rows.forEach((row) => {
    const label = buildDisplayTag(selector(row)) ?? '(missing)';
    const entry = map.get(label) ?? { bookingCount: 0, revenue: 0, commission: 0 };
    entry.bookingCount += 1;
    entry.revenue += row.baseAmount;
    entry.commission += row.affiliateCommissionAmount;
    map.set(label, entry);
  });

  return Array.from(map.entries())
    .map(([label, metrics]) => ({
      label,
      bookingCount: metrics.bookingCount,
      revenue: normalizeMoney(metrics.revenue),
      commission: normalizeMoney(metrics.commission),
    }))
    .sort((left, right) => right.commission - left.commission || right.revenue - left.revenue || right.bookingCount - left.bookingCount || left.label.localeCompare(right.label));
};

const buildTagSummary = (rows: AffiliateBookingRow[], selector: (row: AffiliateBookingRow) => string | null): AffiliateTagRow[] => {
  const map = new Map<string, { value: string; bookingCount: number; revenue: number; commission: number }>();

  rows.forEach((row) => {
    const rawValue = selector(row);
    const label = buildDisplayTag(rawValue);
    if (!label) {
      return;
    }
    const key = label.toLowerCase();
    const entry = map.get(key) ?? { value: label, bookingCount: 0, revenue: 0, commission: 0 };
    entry.bookingCount += 1;
    entry.revenue += row.baseAmount;
    entry.commission += row.affiliateCommissionAmount;
    map.set(key, entry);
  });

  return Array.from(map.values())
    .map((entry) => ({
      value: entry.value,
      bookingCount: entry.bookingCount,
      revenue: normalizeMoney(entry.revenue),
      commission: normalizeMoney(entry.commission),
    }))
    .sort((left, right) => right.commission - left.commission || right.bookingCount - left.bookingCount || right.revenue - left.revenue || left.value.localeCompare(right.value));
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

const toAffiliateUserSummary = (user: User): AffiliateUserSummary => {
  const role = (user as unknown as { role?: UserType | null }).role ?? null;
  return {
    id: user.id,
    fullName: parseName(user.firstName ?? null, user.lastName ?? null),
    firstName: user.firstName ?? null,
    lastName: user.lastName ?? null,
    status: Boolean(user.status),
    userTypeId: user.userTypeId ?? null,
    userTypeSlug: role?.slug ?? null,
    userTypeName: role?.name ?? null,
    affiliateCommissionPerPerson: normalizeAffiliateCommissionPerPerson(user.affiliateCommissionRate),
    financeVendorId: user.financeVendorId ?? null,
  };
};

const fetchAffiliateUsers = async (assignedUserIds: number[] = []): Promise<AffiliateUserSummary[]> => {
  const affiliateRoleUsers = await User.findAll({
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

  const existingIds = new Set(affiliateRoleUsers.map((user) => user.id));
  const extraUserIds = Array.from(
    new Set(
      assignedUserIds.filter(
        (userId) => Number.isInteger(userId) && userId > 0 && !existingIds.has(userId),
      ),
    ),
  );

  const assignedStaffUsers =
    extraUserIds.length > 0
      ? await User.findAll({
          where: {
            id: {
              [Op.in]: extraUserIds,
            },
          },
          include: [
            {
              model: UserType,
              as: 'role',
              required: false,
              attributes: ['id', 'slug', 'name'],
            },
          ],
        })
      : [];

  return [...affiliateRoleUsers, ...assignedStaffUsers]
    .map(toAffiliateUserSummary)
    .sort((left, right) => {
      const firstNameCompare = (left.firstName ?? '').localeCompare(right.firstName ?? '');
      if (firstNameCompare !== 0) {
        return firstNameCompare;
      }
      const lastNameCompare = (left.lastName ?? '').localeCompare(right.lastName ?? '');
      if (lastNameCompare !== 0) {
        return lastNameCompare;
      }
      return left.id - right.id;
    });
};

type NormalizedAffiliatePayoutLog = {
  id: number;
  affiliateUserId: number;
  currencyCode: string;
  amount: number;
  amountMinor: number;
  paidDate: string;
  rangeStart: string;
  rangeEnd: string;
  bookingIds: number[];
  financeTransactionId: number | null;
  note: string | null;
};

const normalizeBookingIds = (value: unknown): number[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => Number(entry))
    .filter((entry) => Number.isInteger(entry) && entry > 0);
};

const fetchAffiliatePayoutLogs = async (affiliateUserIds: number[]): Promise<NormalizedAffiliatePayoutLog[]> => {
  if (affiliateUserIds.length === 0) {
    return [];
  }

  const rows = await AffiliatePayoutLog.findAll({
    where: {
      affiliateUserId: {
        [Op.in]: affiliateUserIds,
      },
    },
    order: [
      ['paidDate', 'DESC'],
      ['id', 'DESC'],
    ],
  });

  return rows.map((row) => ({
    id: row.id,
    affiliateUserId: row.affiliateUserId,
    currencyCode: row.currencyCode,
    amountMinor: row.amountMinor,
    amount: normalizeMoney(row.amountMinor / 100),
    paidDate: row.paidDate,
    rangeStart: row.rangeStart,
    rangeEnd: row.rangeEnd,
    bookingIds: normalizeBookingIds(row.bookingIds),
    financeTransactionId: row.financeTransactionId ?? null,
    note: normalizeText(row.note) ?? null,
  }));
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
      'partySizeTotal',
      'partySizeAdults',
      'partySizeChildren',
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
    partySizeTotal: resolvePartySizeTotal(row),
    baseAmount: normalizeMoney(row.baseAmount),
    currency: row.currency ?? null,
    utmSource: normalizeText(row.utmSource),
    utmMedium: normalizeText(row.utmMedium),
    utmCampaign: normalizeText(row.utmCampaign),
    affiliateUserId: null,
    affiliateUserName: null,
    affiliateRuleId: null,
    affiliateCommissionPerPerson: null,
    affiliateCommissionAmount: 0,
    affiliateCommissionEligible: true,
    affiliateCommissionIneligibleReason: null,
    affiliatePayoutLogId: null,
    isCommissionPaid: false,
  }));
};

export const getAffiliateOverview = async (params: {
  startDate: string;
  endDate: string;
  selectedAffiliateUserId?: number | null;
  currentUserId: number;
  currentRoleSlug: string | null;
  includeStaffAffiliateAssignments?: boolean;
}): Promise<AffiliateOverviewResponse> => {
  const { startDate, endDate } = buildDateRange(params.startDate, params.endDate);
  const isManager = ['admin', 'administrator', 'owner', 'manager'].includes((params.currentRoleSlug ?? '').trim().toLowerCase());
  const canManageAssignments = isManager;
  const assignments = await loadAssignments();
  const affiliateUsers = await fetchAffiliateUsers();
  const attributionUsers = params.includeStaffAffiliateAssignments
    ? await fetchAffiliateUsers(assignments.rules.map((rule) => rule.userId))
    : affiliateUsers;
  const bookings = await fetchAffiliateBookings(startDate, endDate);
  const affiliateUserMap = new Map(affiliateUsers.map((user) => [user.id, user]));
  const attributionUserMap = new Map(attributionUsers.map((user) => [user.id, user]));
  const affiliateRoleUserIds = new Set(affiliateUsers.map((user) => user.id));

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
      if (!params.includeStaffAffiliateAssignments && !affiliateRoleUserIds.has(matchedRule.userId)) {
        return {
          ...booking,
          affiliateUserId: null,
          affiliateUserName: null,
          affiliateRuleId: null,
        };
      }
      const affiliateUser = attributionUserMap.get(matchedRule.userId) ?? null;
      const affiliateCommissionPerPerson = affiliateUser
        ? normalizeAffiliateCommissionPerPerson(affiliateUser.affiliateCommissionPerPerson)
        : null;
      const commissionEligibility = getAffiliateCommissionEligibility(booking.sourceReceivedAt);
      return {
        ...booking,
        affiliateUserId: matchedRule.userId,
        affiliateUserName: affiliateUser?.fullName ?? null,
        affiliateRuleId: matchedRule.id,
        affiliateCommissionPerPerson,
        affiliateCommissionEligible: commissionEligibility.eligible,
        affiliateCommissionIneligibleReason: commissionEligibility.reason,
        affiliateCommissionAmount:
          affiliateCommissionPerPerson != null && commissionEligibility.eligible
            ? normalizeMoney(booking.partySizeTotal * affiliateCommissionPerPerson)
            : 0,
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

  const matchedAffiliateIds = Array.from(
    new Set(resolvedBookings.map((booking) => booking.affiliateUserId).filter((value): value is number => Boolean(value))),
  );
  const payoutLogs = await fetchAffiliatePayoutLogs(matchedAffiliateIds);
  const visibleBookingIds = new Set(resolvedBookings.map((booking) => booking.id));
  const relevantPayoutLogs = payoutLogs.filter((log) => log.bookingIds.some((bookingId) => visibleBookingIds.has(bookingId)));
  const bookingPayoutMap = new Map<number, number>();
  relevantPayoutLogs.forEach((log) => {
    log.bookingIds.forEach((bookingId) => {
      if (visibleBookingIds.has(bookingId) && !bookingPayoutMap.has(bookingId)) {
        bookingPayoutMap.set(bookingId, log.id);
      }
    });
  });

  const bookingsWithPayoutState = resolvedBookings.map((booking) => {
    const payoutLogId = bookingPayoutMap.get(booking.id) ?? null;
    return {
      ...booking,
      affiliatePayoutLogId: payoutLogId,
      isCommissionPaid: payoutLogId != null,
    };
  });

  const affiliateBreakdownMap = new Map<number, { bookingCount: number; revenue: number; commission: number; affiliateCommissionPerPerson: number }>();

  const affiliateBreakdownPaidMap = new Map<number, { paidCommission: number; outstandingCommission: number }>();

  bookingsWithPayoutState.forEach((booking) => {
    if (!booking.affiliateUserId) {
      return;
    }
    const entry = affiliateBreakdownMap.get(booking.affiliateUserId) ?? {
      bookingCount: 0,
      revenue: 0,
      commission: 0,
      affiliateCommissionPerPerson: normalizeAffiliateCommissionPerPerson(booking.affiliateCommissionPerPerson),
    };
    entry.bookingCount += 1;
    entry.revenue += booking.baseAmount;
    entry.commission += booking.affiliateCommissionAmount;
    affiliateBreakdownMap.set(booking.affiliateUserId, entry);

    const payoutEntry = affiliateBreakdownPaidMap.get(booking.affiliateUserId) ?? {
      paidCommission: 0,
      outstandingCommission: 0,
    };
    if (booking.isCommissionPaid) {
      payoutEntry.paidCommission += booking.affiliateCommissionAmount;
    } else {
      payoutEntry.outstandingCommission += booking.affiliateCommissionAmount;
    }
    affiliateBreakdownPaidMap.set(booking.affiliateUserId, payoutEntry);
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
      revenueTotal: normalizeMoney(bookingsWithPayoutState.reduce((sum, booking) => sum + booking.baseAmount, 0)),
      commissionTotal: normalizeMoney(bookingsWithPayoutState.reduce((sum, booking) => sum + booking.affiliateCommissionAmount, 0)),
      commissionPaidTotal: normalizeMoney(
        bookingsWithPayoutState.reduce((sum, booking) => sum + (booking.isCommissionPaid ? booking.affiliateCommissionAmount : 0), 0),
      ),
      commissionOutstandingTotal: normalizeMoney(
        bookingsWithPayoutState.reduce((sum, booking) => sum + (!booking.isCommissionPaid ? booking.affiliateCommissionAmount : 0), 0),
      ),
      paidBookingCount: bookingsWithPayoutState.filter((booking) => booking.isCommissionPaid && booking.affiliateCommissionAmount > 0).length,
      unpaidBookingCount: bookingsWithPayoutState.filter((booking) => !booking.isCommissionPaid && booking.affiliateCommissionAmount > 0).length,
      payoutCount: relevantPayoutLogs.length,
      matchedAffiliateCount: matchedAffiliateIds.length,
      unassignedBookingCount: unassignedBookings.length,
      affiliateCount: affiliateUsers.length,
    },
    dailySeries: buildMetricSeries(bookingsWithPayoutState),
    affiliateBreakdown: Array.from(affiliateBreakdownMap.entries())
      .map(([userId, metrics]) => ({
        userId,
        userName: attributionUserMap.get(userId)?.fullName ?? `Affiliate ${userId}`,
        affiliateCommissionPerPerson: metrics.affiliateCommissionPerPerson,
        bookingCount: metrics.bookingCount,
        revenue: normalizeMoney(metrics.revenue),
        commission: normalizeMoney(metrics.commission),
        paidCommission: normalizeMoney(affiliateBreakdownPaidMap.get(userId)?.paidCommission ?? 0),
        outstandingCommission: normalizeMoney(affiliateBreakdownPaidMap.get(userId)?.outstandingCommission ?? 0),
      }))
      .sort((left, right) => right.commission - left.commission || right.revenue - left.revenue || right.bookingCount - left.bookingCount),
    payoutLogs: relevantPayoutLogs.map((log) => ({
      id: log.id,
      affiliateUserId: log.affiliateUserId,
      affiliateUserName: attributionUserMap.get(log.affiliateUserId)?.fullName ?? `Affiliate ${log.affiliateUserId}`,
      currencyCode: log.currencyCode,
      amount: log.amount,
      paidDate: log.paidDate,
      rangeStart: log.rangeStart,
      rangeEnd: log.rangeEnd,
      bookingCount: log.bookingIds.filter((bookingId) => visibleBookingIds.has(bookingId)).length,
      financeTransactionId: log.financeTransactionId,
      note: log.note,
    })),
    sourceBreakdown: buildBreakdown(bookingsWithPayoutState, (booking) => booking.utmSource),
    mediumBreakdown: buildBreakdown(bookingsWithPayoutState, (booking) => booking.utmMedium),
    campaignBreakdown: buildBreakdown(bookingsWithPayoutState, (booking) => booking.utmCampaign),
    discoveredTags,
    unassignedTags,
    utmCatalog,
    bookings: bookingsWithPayoutState,
  };

  return response;
};

export const updateAffiliateAssignments = async (params: {
  rules: AffiliateAssignmentRule[];
  actorId: number;
}): Promise<AffiliateAssignmentsConfig> => {
  return saveAssignments(params.rules, params.actorId);
};
