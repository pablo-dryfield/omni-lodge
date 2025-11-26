import type { Response } from 'express';
import { Op, Transaction, fn, col } from 'sequelize';
import dayjs from 'dayjs';
import Counter from '../models/Counter.js';
import NightReport, { type NightReportStatus } from '../models/NightReport.js';
import NightReportVenue from '../models/NightReportVenue.js';
import NightReportPhoto from '../models/NightReportPhoto.js';
import User from '../models/User.js';
import Venue from '../models/Venue.js';
import VenueCompensationTerm from '../models/VenueCompensationTerm.js';
import VenueCompensationTermRate from '../models/VenueCompensationTermRate.js';
import VenueCompensationCollectionLog from '../models/VenueCompensationCollectionLog.js';
import FinanceTransaction from '../finance/models/FinanceTransaction.js';
import HttpError from '../errors/HttpError.js';
import { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import logger from '../utils/logger.js';
import { DID_NOT_OPERATE_NOTE } from '../constants/nightReports.js';
import {
  ensureNightReportStorage,
  storeNightReportPhoto,
  deleteNightReportPhoto as removePhotoFromDisk,
  openNightReportPhotoStream,
} from '../services/nightReportStorageService.js';
import { fetchLeaderNightReportStats } from '../services/nightReportMetricsService.js';

type RawVenueAggregate = {
  venueId: number | null;
  venueName: string | null;
  currencyCode: string | null;
  direction: 'payable' | 'receivable' | null;
  totalAmount: string | number | null;
};

type CollectionAggregate = {
  venueId: number;
  currencyCode: string;
  direction: 'receivable' | 'payable';
  totalAmountMinor: string | number | null;
};

type VenueDetailAggregate = {
  venueId: number | null;
  venueName: string | null;
  currencyCode: string | null;
  direction: 'receivable' | 'payable' | null;
  payoutAmount: string | number | null;
  totalPeople: number | null;
  activityDate: string | null;
  reportId: number | null;
};

type NightReportPayload = {
  id: number;
  counterId: number;
  activityDate: string;
  status: NightReportStatus;
  notes: string | null;
  leader: {
    id: number;
    fullName: string;
  } | null;
  counter: {
    id: number;
    date: string;
  } | null;
  venues: Array<{
    id: number;
    orderIndex: number;
    venueName: string;
    venueId: number | null;
    totalPeople: number;
    isOpenBar: boolean;
    normalCount: number | null;
    cocktailsCount: number | null;
    brunchCount: number | null;
    compensationTermId: number | null;
    compensationType: 'open_bar' | 'commission' | null;
    compensationDirection: 'payable' | 'receivable' | null;
    rateApplied: number | null;
    rateUnit: 'per_person' | 'flat' | null;
    payoutAmount: number | null;
    currencyCode: string | null;
  }>;
  photos: Array<{
    id: number;
    originalName: string;
    mimeType: string;
    fileSize: number;
    capturedAt: string | null;
    downloadUrl: string;
  }>;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string | null;
};

const ADMIN_ROLE_SLUGS = new Set(['admin', 'owner', 'super_admin']);
type SummaryPeriod = 'this_month' | 'last_month' | 'custom';

const SUMMARY_PERIODS: SummaryPeriod[] = ['this_month', 'last_month', 'custom'];

const roundCurrencyValue = (value: number): number => Math.round(value * 100) / 100;

const parseAmountToMinor = (value: unknown): number => {
  if (value === null || value === undefined || value === '') {
    return 0;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new HttpError(400, 'Amount must be a valid number');
  }
  return Math.round(parsed * 100);
};

const resolveVenueSummaryRange = (
  rawPeriod: string | undefined,
  startDateParam?: string,
  endDateParam?: string,
): { period: SummaryPeriod; start: dayjs.Dayjs; end: dayjs.Dayjs } => {
  const normalized = SUMMARY_PERIODS.includes(rawPeriod as SummaryPeriod)
    ? (rawPeriod as SummaryPeriod)
    : ('this_month' as SummaryPeriod);

  const now = dayjs();
  let start: dayjs.Dayjs;
  let end: dayjs.Dayjs;

  if (normalized === 'last_month') {
    start = now.subtract(1, 'month').startOf('month');
    end = start.endOf('month');
  } else if (normalized === 'custom') {
    if (!startDateParam || !endDateParam) {
      throw new HttpError(400, 'Provide startDate and endDate when using the custom period');
    }
    start = dayjs(startDateParam).startOf('day');
    end = dayjs(endDateParam).endOf('day');
  } else {
    start = now.startOf('month');
    end = now.endOf('month');
  }

  if (normalized !== 'custom') {
    if (startDateParam) {
      const override = dayjs(startDateParam).startOf('day');
      if (!override.isValid()) {
        throw new HttpError(400, 'Invalid startDate provided');
      }
      start = override;
    }
    if (endDateParam) {
      const override = dayjs(endDateParam).endOf('day');
      if (!override.isValid()) {
        throw new HttpError(400, 'Invalid endDate provided');
      }
      end = override;
    }
  }

  if (!start.isValid() || !end.isValid() || end.isBefore(start)) {
    throw new HttpError(400, 'Provide a valid date range');
  }

  return { period: normalized, start, end };
};

const NIGHT_REPORT_COLUMNS = [
  { header: 'ID', accessorKey: 'id', type: 'number' },
  { header: 'Date', accessorKey: 'activityDate', type: 'date' },
  { header: 'Leader', accessorKey: 'leaderName', type: 'text' },
  { header: 'Status', accessorKey: 'status', type: 'text' },
  { header: 'Total Venues', accessorKey: 'venuesCount', type: 'number' },
  { header: 'Total People', accessorKey: 'totalPeople', type: 'number' },
  { header: 'Counter ID', accessorKey: 'counterId', type: 'number' },
];

type VenueInput = {
  orderIndex?: number;
  venueName?: string;
  venueId?: number;
  totalPeople?: number;
  isOpenBar?: boolean;
  normalCount?: number | null;
  cocktailsCount?: number | null;
  brunchCount?: number | null;
};

function requireActorId(req: AuthenticatedRequest): number {
  const actorId = req.authContext?.id;
  if (!actorId) {
    throw new HttpError(401, 'Unauthorized');
  }
  return actorId;
}

function isAdminRole(roleSlug: string | null | undefined): boolean {
  if (!roleSlug) {
    return false;
  }
  return ADMIN_ROLE_SLUGS.has(roleSlug);
}

function canManageReport(report: NightReport, actorId: number, roleSlug: string | null | undefined): boolean {
  if (isAdminRole(roleSlug)) {
    return true;
  }
  if (report.leaderId === actorId) {
    return true;
  }
  if (report.counter && report.counter.userId === actorId) {
    return true;
  }
  return false;
}

const buildPhotoDownloadUrl = (req: AuthenticatedRequest, reportId: number, photoId: number): string => {
  const basePath = `${req.baseUrl ?? ''}`.replace(/\/+$/, '');
  const isProduction = (process.env.NODE_ENV ?? '').trim() === 'production';

  let normalizedBase = basePath;
  if (!normalizedBase) {
    normalizedBase = isProduction ? '/nightReports' : '/api/nightReports';
  } else if (isProduction) {
    normalizedBase = normalizedBase.replace(/^\/?api(\/|$)/i, '/');
  } else if (!normalizedBase.startsWith('/api')) {
    normalizedBase = normalizedBase.startsWith('/')
      ? `/api${normalizedBase}`
      : `/api/${normalizedBase}`;
  }

  if (!normalizedBase.startsWith('/')) {
    normalizedBase = `/${normalizedBase}`;
  }

  normalizedBase = normalizedBase.replace(/\/+$/, '') || (isProduction ? '/nightReports' : '/api/nightReports');

  return `${normalizedBase}/${reportId}/photos/${photoId}/download`;
};

function serializeNightReport(report: NightReport, req: AuthenticatedRequest): NightReportPayload {
  const leader = report.leader
    ? {
        id: report.leader.id,
        fullName: `${report.leader.firstName ?? ''} ${report.leader.lastName ?? ''}`.trim(),
      }
    : null;

  const counter = report.counter
    ? {
        id: report.counter.id,
        date: report.counter.date,
      }
    : null;

  const venues = (report.venues ?? [])
    .slice()
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((venue) => ({
      id: venue.id,
      orderIndex: venue.orderIndex,
      venueName: venue.venueName,
       venueId: venue.venueId ?? null,
      totalPeople: venue.totalPeople,
      isOpenBar: venue.isOpenBar,
      normalCount: venue.normalCount,
      cocktailsCount: venue.cocktailsCount,
      brunchCount: venue.brunchCount,
      compensationTermId: venue.compensationTermId ?? null,
      compensationType: venue.compensationType ?? null,
      compensationDirection: venue.direction ?? null,
      rateApplied: venue.rateApplied != null ? Number(venue.rateApplied) : null,
      rateUnit: venue.rateUnit ?? null,
      payoutAmount: venue.payoutAmount != null ? Number(venue.payoutAmount) : null,
      currencyCode: venue.currencyCode ?? null,
    }));

  const photos = (report.photos ?? []).map((photo) => ({
    id: photo.id,
    originalName: photo.originalName,
    mimeType: photo.mimeType,
    fileSize: photo.fileSize,
    capturedAt: photo.capturedAt ? photo.capturedAt.toISOString() : null,
    downloadUrl: buildPhotoDownloadUrl(req, report.id, photo.id),
  }));

  return {
    id: report.id,
    counterId: report.counterId,
    activityDate: report.activityDate,
    status: report.status,
    notes: report.notes ?? null,
    leader,
    counter,
    venues,
    photos,
    submittedAt: report.submittedAt ? report.submittedAt.toISOString() : null,
    createdAt: report.createdAt instanceof Date ? report.createdAt.toISOString() : new Date(report.createdAt).toISOString(),
    updatedAt:
      report.updatedAt instanceof Date
        ? report.updatedAt.toISOString()
        : report.updatedAt
        ? new Date(report.updatedAt).toISOString()
        : null,
  };
}

function buildSummaryRow(report: NightReport) {
  const leaderName = report.leader
    ? `${report.leader.firstName ?? ''} ${report.leader.lastName ?? ''}`.trim()
    : '';
  const venues = report.venues ?? [];
  const totalPeople = venues.reduce((acc, venue) => acc + (venue.totalPeople ?? 0), 0);
  return {
    id: report.id,
    activityDate: report.activityDate,
    leaderName,
    status: report.status,
    venuesCount: venues.length,
    totalPeople,
    counterId: report.counterId,
  };
}

function normalizeVenueInput(raw: unknown): VenueInput[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map((item) => {
    const venue = (item ?? {}) as VenueInput;
    return {
      orderIndex: typeof venue.orderIndex === 'number' ? venue.orderIndex : undefined,
      venueName: typeof venue.venueName === 'string' ? venue.venueName.trim() : undefined,
      venueId: typeof venue.venueId === 'number' ? venue.venueId : undefined,
      totalPeople: typeof venue.totalPeople === 'number' ? venue.totalPeople : undefined,
      isOpenBar: typeof venue.isOpenBar === 'boolean' ? venue.isOpenBar : undefined,
      normalCount:
        venue.normalCount == null ? null : typeof venue.normalCount === 'number' ? venue.normalCount : undefined,
      cocktailsCount:
        venue.cocktailsCount == null ? null : typeof venue.cocktailsCount === 'number' ? venue.cocktailsCount : undefined,
      brunchCount:
        venue.brunchCount == null ? null : typeof venue.brunchCount === 'number' ? venue.brunchCount : undefined,
    };
  });
}

type NormalizedVenue = {
  orderIndex: number;
  venueName: string;
  venueId: number | null;
  totalPeople: number;
  isOpenBar: boolean;
  normalCount: number | null;
  cocktailsCount: number | null;
  brunchCount: number | null;
};

function validateAndArrangeVenues(raw: VenueInput[]): NormalizedVenue[] {
  if (raw.length === 0) {
    return [];
  }

  const sorted = raw
    .map((venue, index) => ({
      orderIndex: venue.orderIndex && venue.orderIndex > 0 ? Math.floor(venue.orderIndex) : index + 1,
      venueName: venue.venueName ?? '',
      venueId: venue.venueId ?? null,
      totalPeople: venue.totalPeople ?? 0,
      isOpenBar: venue.isOpenBar ?? index === 0,
      normalCount: venue.normalCount ?? null,
      cocktailsCount: venue.cocktailsCount ?? null,
      brunchCount: venue.brunchCount ?? null,
    }))
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((venue, index) => ({
      ...venue,
      orderIndex: index + 1,
    }));

  if (sorted.some((venue) => !venue.venueName)) {
    throw new HttpError(400, 'Each venue entry must include a name');
  }

  if (sorted.some((venue) => venue.totalPeople < 0)) {
    throw new HttpError(400, 'Venue headcount cannot be negative');
  }

  const openBarEntries = sorted.filter((venue) => venue.isOpenBar);
  if (openBarEntries.length !== 1) {
    throw new HttpError(400, 'Exactly one venue must be marked as the open bar');
  }
  if (sorted[0].isOpenBar !== true) {
    throw new HttpError(400, 'The first venue (order 1) must be marked as the open bar');
  }

  const [openBar] = openBarEntries;
  if (
    openBar.normalCount == null ||
    openBar.cocktailsCount == null ||
    openBar.brunchCount == null ||
    openBar.normalCount < 0 ||
    openBar.cocktailsCount < 0 ||
    openBar.brunchCount < 0
  ) {
    throw new HttpError(400, 'Open bar venue must include non-negative Normal, Cocktails, and Brunch counts');
  }

  return sorted;
}

type PreparedVenueRow = {
  orderIndex: number;
  venueId: number;
  venueName: string;
  totalPeople: number;
  isOpenBar: boolean;
  normalCount: number | null;
  cocktailsCount: number | null;
  brunchCount: number | null;
  compensationTermId: number;
  compensationType: 'open_bar' | 'commission';
  direction: 'payable' | 'receivable';
  rateApplied: number;
  rateUnit: 'per_person' | 'flat';
  payoutAmount: number;
  currencyCode: string;
};

const normalizeVenueKey = (value: string): string => value.trim().toLowerCase();

const roundToCents = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value * 100) / 100;
};

async function resolveNightReportVenueRows(
  venues: NormalizedVenue[],
  activityDate: string,
  productId: number | null,
  transaction?: Transaction,
): Promise<PreparedVenueRow[]> {
  if (venues.length === 0) {
    return [];
  }

  const trimmedDate = (activityDate ?? '').trim();
  if (!trimmedDate) {
    throw new HttpError(400, 'Activity date is required to compute venue payouts');
  }

  const directory = await Venue.findAll({ transaction });
  const byId = new Map<number, Venue>();
  const byName = new Map<string, Venue>();
  directory.forEach((venue) => {
    byId.set(venue.id, venue);
    if (venue.name) {
      byName.set(normalizeVenueKey(venue.name), venue);
    }
  });

  const resolved = venues.map((entry) => {
    const key = normalizeVenueKey(entry.venueName);
    let venueRecord = entry.venueId != null ? byId.get(entry.venueId) ?? null : null;
    if (!venueRecord && key) {
      venueRecord = byName.get(key) ?? null;
    }
    if (!venueRecord) {
      throw new HttpError(400, `Venue "${entry.venueName}" is not part of the directory`);
    }
    if (entry.isOpenBar && venueRecord.allowsOpenBar !== true) {
      throw new HttpError(400, `Venue "${venueRecord.name}" is not eligible to host the open bar`);
    }
    return { entry, venue: venueRecord };
  });

  const uniqueVenueIds = [...new Set(resolved.map(({ venue }) => venue.id))];
  const terms = await VenueCompensationTerm.findAll({
    where: {
      venueId: uniqueVenueIds.length > 0 ? { [Op.in]: uniqueVenueIds } : uniqueVenueIds,
      isActive: true,
      validFrom: { [Op.lte]: trimmedDate },
      [Op.or]: [{ validTo: null }, { validTo: { [Op.gte]: trimmedDate } }],
    },
    order: [
      ['venueId', 'ASC'],
      ['compensationType', 'ASC'],
      ['validFrom', 'DESC'],
      ['id', 'DESC'],
    ],
    transaction,
  });

  const termMap = new Map<string, VenueCompensationTerm>();
  const termIds = terms.map((term) => term.id);
  const rates = termIds.length
    ? await VenueCompensationTermRate.findAll({
        where: {
          termId: { [Op.in]: termIds },
          isActive: true,
        },
        order: [
          ['termId', 'ASC'],
          ['productId', 'DESC'],
          ['ticketType', 'ASC'],
          ['validFrom', 'DESC'],
          ['id', 'DESC'],
        ],
        transaction,
      })
    : [];

  const ratesByTerm = new Map<number, VenueCompensationTermRate[]>();
  rates.forEach((rate) => {
    if (!ratesByTerm.has(rate.termId)) {
      ratesByTerm.set(rate.termId, []);
    }
    ratesByTerm.get(rate.termId)!.push(rate);
  });

  terms.forEach((term) => {
    const key = `${term.venueId}:${term.compensationType}`;
    termMap.set(key, term);
  });

  return resolved.map(({ entry, venue }) => {
    const compensationType: 'open_bar' | 'commission' = entry.isOpenBar ? 'open_bar' : 'commission';
    const direction: 'payable' | 'receivable' = entry.isOpenBar ? 'payable' : 'receivable';
    const termKey = `${venue.id}:${compensationType}`;
    const term = termMap.get(termKey);
    if (!term) {
      const hasAnyActive = terms.some(
        (candidate) => candidate.venueId === venue.id && candidate.isActive && candidate.compensationType === compensationType,
      );
      const label = entry.isOpenBar ? 'open bar payout' : 'commission';
      if (!hasAnyActive) {
        throw new HttpError(400, `No active ${label} term is configured for ${venue.name} on ${trimmedDate}`);
      }
      throw new HttpError(
        400,
        `A ${label} term for ${venue.name} exists but its date range does not cover ${trimmedDate}. Update the term or add a new one with valid dates.`,
      );
    }

    let rateApplied = 0;
    let rateUnit: 'per_person' | 'flat' = 'per_person';
    let payoutAmount = 0;

    if (entry.isOpenBar) {
      const bucketContributions = computeOpenBarPayout(
        term,
        ratesByTerm.get(term.id) ?? [],
        {
          normal: entry.normalCount ?? 0,
          cocktail: entry.cocktailsCount ?? 0,
          brunch: entry.brunchCount ?? 0,
        },
        productId,
        trimmedDate,
      );
      payoutAmount = roundToCents(bucketContributions.total);
      rateApplied = payoutAmount;
      rateUnit = 'per_person';
    } else {
      const baseRateRaw = typeof term.rateAmount === 'number' ? term.rateAmount : Number(term.rateAmount ?? 0);
      rateApplied = roundToCents(baseRateRaw);
      rateUnit = term.rateUnit === 'flat' ? 'flat' : 'per_person';
      const units = rateUnit === 'flat' ? 1 : Math.max(entry.totalPeople, 0);
      payoutAmount = roundToCents(rateApplied * units);
    }

    return {
      orderIndex: entry.orderIndex,
      venueId: venue.id,
      venueName: venue.name ?? entry.venueName,
      totalPeople: entry.totalPeople,
      isOpenBar: entry.isOpenBar,
      normalCount: entry.normalCount,
      cocktailsCount: entry.cocktailsCount,
      brunchCount: entry.brunchCount,
      compensationTermId: term.id,
      compensationType,
      direction,
      rateApplied,
      rateUnit,
      payoutAmount,
      currencyCode: term.currencyCode ?? 'USD',
    };
  });
}

function mapReportVenuesToNormalized(venues: NightReportVenue[]): NormalizedVenue[] {
  return venues
    .slice()
    .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0))
    .map((venue, index) => ({
      orderIndex: venue.orderIndex ?? index + 1,
      venueName: venue.venueName ?? '',
      venueId: venue.venueId ?? null,
      totalPeople: venue.totalPeople ?? 0,
      isOpenBar: venue.isOpenBar ?? index === 0,
      normalCount: venue.normalCount ?? null,
      cocktailsCount: venue.cocktailsCount ?? null,
      brunchCount: venue.brunchCount ?? null,
    }));
}

type BucketCounts = {
  normal: number;
  cocktail: number;
  brunch: number;
};

const bucketOrder: Array<keyof BucketCounts | 'generic'> = ['normal', 'cocktail', 'brunch', 'generic'];

function computeOpenBarPayout(
  term: VenueCompensationTerm,
  rates: VenueCompensationTermRate[],
  counts: BucketCounts,
  productId: number | null,
  referenceDate: string,
) {
  const dateValue = referenceDate;
  const contributions: number[] = [];

  const selectRate = (ticketType: string): VenueCompensationTermRate | null => {
    const filtered = rates.filter((rate) => {
      const matchesTicket =
        rate.ticketType === ticketType ||
        (ticketType !== 'generic' && rate.ticketType === 'generic');
      if (!matchesTicket) {
        return false;
      }
      const withinStart = !rate.validFrom || rate.validFrom <= dateValue;
      const withinEnd = !rate.validTo || rate.validTo >= dateValue;
      if (!withinStart || !withinEnd) {
        return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      return null;
    }

    const productMatches = productId
      ? filtered.filter((rate) => rate.productId === productId)
      : [];
    const fallbackMatches = filtered.filter((rate) => rate.productId == null);
    const candidatePool = productMatches.length > 0 ? productMatches : fallbackMatches.length > 0 ? fallbackMatches : filtered;

    return candidatePool[0] ?? null;
  };

  const applyRate = (ticketType: keyof BucketCounts, count: number) => {
    if (!count || count <= 0) {
      return;
    }
    const rate = selectRate(ticketType);
    if (!rate) {
      const genericRate = selectRate('generic');
      if (!genericRate) {
        return;
      }
      const units = genericRate.rateUnit === 'flat' ? 1 : count;
      contributions.push(roundToCents(Number(genericRate.rateAmount ?? 0) * units));
      return;
    }
    const units = rate.rateUnit === 'flat' ? 1 : count;
    contributions.push(roundToCents(Number(rate.rateAmount ?? 0) * units));
  };

  applyRate('normal', counts.normal);
  applyRate('cocktail', counts.cocktail);
  applyRate('brunch', counts.brunch);

  if (contributions.length === 0) {
    const fallbackRate = selectRate('generic');
    if (fallbackRate) {
      const units = fallbackRate.rateUnit === 'flat' ? 1 : Math.max(counts.normal + counts.cocktail + counts.brunch, 0);
      contributions.push(roundToCents(Number(fallbackRate.rateAmount ?? 0) * units));
    } else {
      const baseRateRaw = typeof term.rateAmount === 'number' ? term.rateAmount : Number(term.rateAmount ?? 0);
      const rateApplied = roundToCents(baseRateRaw);
      const units = term.rateUnit === 'flat' ? 1 : Math.max(counts.normal + counts.cocktail + counts.brunch, 0);
      contributions.push(roundToCents(rateApplied * units));
    }
  }

  return {
    total: contributions.reduce((sum, value) => sum + value, 0),
  };
}

async function getNightReportById(reportId: number): Promise<NightReport | null> {
  return NightReport.findByPk(reportId, {
    include: [
      { model: Counter, as: 'counter' },
      { model: User, as: 'leader' },
      { model: User, as: 'reassignedBy' },
      { model: NightReportVenue, as: 'venues' },
      { model: NightReportPhoto, as: 'photos' },
    ],
    order: [
      [{ model: NightReportVenue, as: 'venues' }, 'orderIndex', 'ASC'],
      [{ model: NightReportPhoto, as: 'photos' }, 'createdAt', 'ASC'],
    ],
  });
}

export const listNightReports = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const where: Record<string, unknown> = {};

    const { status, counterId, leaderId, from, to } = req.query;

    if (typeof status === 'string' && status) {
      where.status = status;
    }

    if (typeof counterId === 'string' && counterId) {
      where.counterId = Number(counterId);
    }

    if (typeof leaderId === 'string' && leaderId) {
      where.leaderId = Number(leaderId);
    }

    if ((typeof from === 'string' && from) || (typeof to === 'string' && to)) {
      const range: Record<string | symbol, string> = {};
      if (typeof from === 'string' && from) {
        range[Op.gte] = from;
      }
      if (typeof to === 'string' && to) {
        range[Op.lte] = to;
      }
      if (Object.keys(range).length > 0) {
        where.activityDate = range;
      }
    }

    const reports = await NightReport.findAll({
      where,
      include: [
        { model: User, as: 'leader', attributes: ['id', 'firstName', 'lastName'] },
        {
          model: NightReportVenue,
          as: 'venues',
          attributes: ['id', 'orderIndex', 'totalPeople', 'isOpenBar'],
        },
      ],
      order: [
        ['activityDate', 'DESC'],
        ['id', 'DESC'],
      ],
    });

    const data = reports.map(buildSummaryRow);

    res.status(200).json([
      {
        data,
        columns: NIGHT_REPORT_COLUMNS,
      },
    ]);
  } catch (error) {
    logger.error('Failed to list night reports', error);
    res.status(500).json([{ message: 'Failed to list night reports' }]);
  }
};

export const createNightReport = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const sequelize = NightReport.sequelize;
  if (!sequelize) {
    res.status(500).json([{ message: 'Database connection unavailable' }]);
    return;
  }

  try {
    const actorId = requireActorId(req);
    const body = req.body ?? {};
    const counterId = Number(body.counterId);

    if (!Number.isInteger(counterId) || counterId <= 0) {
      throw new HttpError(400, 'counterId is required');
    }

    const counter = await Counter.findByPk(counterId);
    if (!counter) {
      throw new HttpError(404, 'Counter not found');
    }

    const leaderId = body.leaderId ? Number(body.leaderId) : counter.userId;
    if (!Number.isInteger(leaderId) || leaderId <= 0) {
      throw new HttpError(400, 'leaderId is required');
    }

    const leader = await User.findByPk(leaderId);
    if (!leader) {
      throw new HttpError(404, 'Leader not found');
    }

    const activityDate = typeof body.activityDate === 'string' && body.activityDate.trim() !== '' ? body.activityDate : counter.date;

    const existing = await NightReport.findOne({ where: { counterId } });
    if (existing) {
      throw new HttpError(409, 'Night report already exists for this counter');
    }

    const venuesInput = normalizeVenueInput(body.venues);
    const normalizedVenues = validateAndArrangeVenues(venuesInput);

    const created = await sequelize.transaction(async (transaction) => {
      const report = await NightReport.create(
        {
          counterId,
          leaderId,
          activityDate,
          status: 'draft',
          notes: body.notes ?? null,
          createdBy: actorId,
          updatedBy: actorId,
        },
        { transaction },
      );

      if (normalizedVenues.length > 0) {
        const venueRows = await resolveNightReportVenueRows(
          normalizedVenues,
          activityDate,
          counter.productId ?? null,
          transaction,
        );
        await NightReportVenue.bulkCreate(
          venueRows.map((row) => ({
            reportId: report.id,
            ...row,
          })),
          { transaction },
        );
      }

      return report;
    });

    const fullReport = await getNightReportById(created.id);
    if (!fullReport) {
      throw new HttpError(500, 'Failed to load created report');
    }

    res.status(201).json([serializeNightReport(fullReport, req)]);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json([{ message: error.message }]);
      return;
    }
    logger.error('Failed to create night report', error);
    res.status(500).json([{ message: 'Failed to create night report' }]);
  }
};

export const getNightReport = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const reportId = Number(req.params.id);
    if (!Number.isInteger(reportId) || reportId <= 0) {
      throw new HttpError(400, 'Invalid report id');
    }

    const report = await getNightReportById(reportId);
    if (!report) {
      res.status(404).json([{ message: 'Night report not found' }]);
      return;
    }

    res.status(200).json([serializeNightReport(report, req)]);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json([{ message: error.message }]);
      return;
    }
    logger.error('Failed to fetch night report', error);
    res.status(500).json([{ message: 'Failed to fetch night report' }]);
  }
};

export const updateNightReport = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const sequelize = NightReport.sequelize;
  if (!sequelize) {
    res.status(500).json([{ message: 'Database connection unavailable' }]);
    return;
  }

  try {
    const actorId = requireActorId(req);
    const reportId = Number(req.params.id);
    if (!Number.isInteger(reportId) || reportId <= 0) {
      throw new HttpError(400, 'Invalid report id');
    }

    const report = await getNightReportById(reportId);
    if (!report) {
      res.status(404).json([{ message: 'Night report not found' }]);
      return;
    }

    if (!canManageReport(report, actorId, req.authContext?.roleSlug)) {
      throw new HttpError(403, 'You do not have permission to edit this report');
    }

    const body = req.body ?? {};
    const updatePayload: Partial<NightReport> = {};

    if (typeof body.activityDate === 'string' && body.activityDate.trim() !== '') {
      updatePayload.activityDate = body.activityDate;
    }

    if (typeof body.notes === 'string' || body.notes === null) {
      updatePayload.notes = body.notes ?? null;
    }

    if (body.leaderId) {
      const leaderId = Number(body.leaderId);
      if (!Number.isInteger(leaderId) || leaderId <= 0) {
        throw new HttpError(400, 'leaderId must be a positive integer');
      }
      const leader = await User.findByPk(leaderId);
      if (!leader) {
        throw new HttpError(404, 'Leader not found');
      }
      updatePayload.leaderId = leaderId;
      updatePayload.reassignedById = report.leaderId !== leaderId ? actorId : report.reassignedById ?? null;
    }

    const rawVenuesInput = body.venues;
    const hasVenuesInput = Array.isArray(rawVenuesInput);
    const venuesInput = normalizeVenueInput(rawVenuesInput);
    const normalizedVenues = venuesInput.length > 0 ? validateAndArrangeVenues(venuesInput) : [];
    const effectiveActivityDate = updatePayload.activityDate ?? report.activityDate;
    const reportProductId = report.counter?.productId ?? null;
    const shouldRebuildForDateChange =
      !hasVenuesInput && Boolean(updatePayload.activityDate) && (report.venues?.length ?? 0) > 0;
    const normalizedExistingVenues = shouldRebuildForDateChange
      ? mapReportVenuesToNormalized(report.venues ?? [])
      : [];

    await sequelize.transaction(async (transaction) => {
      if (Object.keys(updatePayload).length > 0) {
        updatePayload.updatedBy = actorId;
        await NightReport.update(updatePayload, { where: { id: reportId }, transaction });
      }

      if (hasVenuesInput) {
        await NightReportVenue.destroy({ where: { reportId }, transaction });
        if (normalizedVenues.length > 0) {
          const venueRows = await resolveNightReportVenueRows(
            normalizedVenues,
            effectiveActivityDate,
            reportProductId,
            transaction,
          );
          await NightReportVenue.bulkCreate(
            venueRows.map((row) => ({
              reportId,
              ...row,
            })),
            { transaction },
          );
        }
      } else if (shouldRebuildForDateChange) {
        await NightReportVenue.destroy({ where: { reportId }, transaction });
        if (normalizedExistingVenues.length > 0) {
          const venueRows = await resolveNightReportVenueRows(
            normalizedExistingVenues,
            effectiveActivityDate,
            reportProductId,
            transaction,
          );
          await NightReportVenue.bulkCreate(
            venueRows.map((row) => ({
              reportId,
              ...row,
            })),
            { transaction },
          );
        }
      }
    });

    const fresh = await getNightReportById(reportId);
    if (!fresh) {
      throw new HttpError(500, 'Failed to reload report');
    }

    res.status(200).json([serializeNightReport(fresh, req)]);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json([{ message: error.message }]);
      return;
    }
    logger.error('Failed to update night report', error);
    res.status(500).json([{ message: 'Failed to update night report' }]);
  }
};

export const submitNightReport = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const sequelize = NightReport.sequelize;
  if (!sequelize) {
    res.status(500).json([{ message: 'Database connection unavailable' }]);
    return;
  }

  try {
    const actorId = requireActorId(req);
    const reportId = Number(req.params.id);
    if (!Number.isInteger(reportId) || reportId <= 0) {
      throw new HttpError(400, 'Invalid report id');
    }

    const report = await getNightReportById(reportId);
    if (!report) {
      res.status(404).json([{ message: 'Night report not found' }]);
      return;
    }

    if (!canManageReport(report, actorId, req.authContext?.roleSlug)) {
      throw new HttpError(403, 'You do not have permission to submit this report');
    }

    if (report.status === 'submitted') {
      throw new HttpError(400, 'Report is already submitted');
    }

    const normalizedNotes = (report.notes ?? '').trim().toLowerCase();
    const didNotOperate = normalizedNotes === DID_NOT_OPERATE_NOTE.toLowerCase();

    const venues = report.venues ?? [];
    const noVenueAttendance =
      venues.length === 0 ||
      venues.every((venue) => Math.max(0, Number(venue.totalPeople ?? 0)) === 0);
    const hasRecordedVenues = !didNotOperate && venues.length > 0;
    if (hasRecordedVenues) {
      const openBarVenues = venues.filter((venue) => venue.isOpenBar);
      if (openBarVenues.length !== 1 || venues[0].isOpenBar !== true) {
        throw new HttpError(400, 'Ensure the first venue is marked as the open bar with required counts');
      }

      const [openBar] = openBarVenues;
      if (
        openBar.normalCount == null ||
        openBar.cocktailsCount == null ||
        openBar.brunchCount == null ||
        openBar.normalCount < 0 ||
        openBar.cocktailsCount < 0 ||
        openBar.brunchCount < 0
      ) {
        throw new HttpError(400, 'Open bar counts must be provided before submission');
      }
    }

    const photoCount = await NightReportPhoto.count({ where: { reportId } });
    if (photoCount === 0 && !didNotOperate && !noVenueAttendance) {
      throw new HttpError(400, 'Upload the signed paper photo before submitting');
    }

    await NightReport.update(
      {
        status: 'submitted',
        submittedAt: new Date(),
        updatedBy: actorId,
      },
      { where: { id: reportId } },
    );

    const fresh = await getNightReportById(reportId);
    if (!fresh) {
      throw new HttpError(500, 'Failed to reload report');
    }

    res.status(200).json([serializeNightReport(fresh, req)]);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json([{ message: error.message }]);
      return;
    }
    logger.error('Failed to submit night report', error);
    res.status(500).json([{ message: 'Failed to submit night report' }]);
  }
};

export const deleteNightReport = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const sequelize = NightReport.sequelize;
  if (!sequelize) {
    res.status(500).json([{ message: 'Database connection unavailable' }]);
    return;
  }

  try {
    const actorId = requireActorId(req);
    const reportId = Number(req.params.id);
    if (!Number.isInteger(reportId) || reportId <= 0) {
      throw new HttpError(400, 'Invalid report id');
    }

    const report = await getNightReportById(reportId);
    if (!report) {
      res.status(404).json([{ message: 'Night report not found' }]);
      return;
    }

    if (!canManageReport(report, actorId, req.authContext?.roleSlug)) {
      throw new HttpError(403, 'You do not have permission to delete this report');
    }

    await sequelize.transaction(async (transaction) => {
      const photos = await NightReportPhoto.findAll({ where: { reportId }, transaction });
      for (const photo of photos) {
        await removePhotoFromDisk(photo.storagePath).catch((error) => {
          logger.warn(`Failed to remove photo ${photo.id} from disk`, error);
        });
      }
      await NightReportPhoto.destroy({ where: { reportId }, transaction });
      await NightReportVenue.destroy({ where: { reportId }, transaction });
      await NightReport.destroy({ where: { id: reportId }, transaction });
    });

    res.status(204).send();
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json([{ message: error.message }]);
      return;
    }
    logger.error('Failed to delete night report', error);
    res.status(500).json([{ message: 'Failed to delete night report' }]);
  }
};

export const getNightReportLeaderMetrics = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { startDate, endDate } = req.query;
    if (typeof startDate !== 'string' || !startDate) {
      res.status(400).json([{ message: 'startDate is required' }]);
      return;
    }

    const start = dayjs(startDate).startOf('day');
    const end = typeof endDate === 'string' && endDate ? dayjs(endDate).endOf('day') : start.endOf('day');
    if (!start.isValid() || !end.isValid() || end.isBefore(start)) {
      res.status(400).json([{ message: 'Provide a valid date range' }]);
      return;
    }

    const minAttendanceValue = Math.max(Number(req.query.minAttendance ?? 0) || 0, 0);
    const minReportsValue = Math.max(Number(req.query.minReports ?? 0) || 0, 0);
    const retentionThresholdRaw = Number(req.query.retentionThreshold ?? 0);
    const retentionThresholdValue = Number.isFinite(retentionThresholdRaw)
      ? Math.min(Math.max(retentionThresholdRaw, 0), 1)
      : 0;

    const stats = await fetchLeaderNightReportStats(start, end);
    if (stats.size === 0) {
      res.status(200).json([
        {
          data: {
            range: { startDate: start.format('YYYY-MM-DD'), endDate: end.format('YYYY-MM-DD') },
            thresholds: {
              minAttendance: minAttendanceValue,
              minReports: minReportsValue,
              retentionThreshold: retentionThresholdValue,
            },
            leaders: [],
            bestStaff: { userIds: [], retentionHits: 0 },
          },
          columns: [],
        },
      ]);
      return;
    }

    const userIds = Array.from(stats.keys());
    const users = await User.findAll({
      where: { id: { [Op.in]: userIds } },
      attributes: ['id', 'firstName', 'lastName'],
    });
    const nameMap = new Map<number, string>();
    users.forEach((user) => {
      const fullName = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
      nameMap.set(user.id, fullName.length > 0 ? fullName : `User #${user.id}`);
    });

    let bestRetentionHits = 0;
    const bestStaffIds = new Set<number>();

    const leaders = Array.from(stats.entries()).map(([userId, summary]) => {
      const totalReports = summary.reports.length;
      const totalPeople = summary.reports.reduce((sum, report) => sum + report.totalPeople, 0);
      const totalVenues = summary.reports.reduce((sum, report) => sum + report.venuesCount, 0);
      const totalRetention = summary.reports.reduce((sum, report) => sum + report.retentionRatio, 0);
      const totalOpenBarPayout = summary.reports.reduce((sum, report) => sum + (report.openBarPayout ?? 0), 0);
      const totalCommissionRevenue = summary.reports.reduce(
        (sum, report) => sum + (report.commissionRevenue ?? 0),
        0,
      );
      const netVenueValue = summary.reports.reduce((sum, report) => sum + (report.netVenueValue ?? 0), 0);
      const qualifiedReports = summary.reports.filter(
        (report) => report.totalPeople >= minAttendanceValue,
      );
      const retentionHits = qualifiedReports.filter(
        (report) => report.retentionRatio >= retentionThresholdValue,
      ).length;

      const meetsMinReports = qualifiedReports.length >= minReportsValue;
      if (meetsMinReports) {
        if (retentionHits > bestRetentionHits) {
          bestRetentionHits = retentionHits;
          bestStaffIds.clear();
          if (retentionHits > 0) {
            bestStaffIds.add(userId);
          }
        } else if (retentionHits === bestRetentionHits && retentionHits > 0) {
          bestStaffIds.add(userId);
        }
      }

      return {
        userId,
        leaderName: nameMap.get(userId) ?? `User #${userId}`,
        totalReports,
        totalPeople,
        totalVenues,
        averageAttendance: totalReports ? totalPeople / totalReports : 0,
        averageVenues: totalReports ? totalVenues / totalReports : 0,
        averageRetention: totalReports ? totalRetention / totalReports : 0,
        totalOpenBarPayout,
        totalCommissionRevenue,
        netVenueValue,
        averageNetVenueValue: totalReports ? netVenueValue / totalReports : 0,
        qualifiedReports: qualifiedReports.length,
        retentionHits,
        meetsMinimumReports: meetsMinReports,
        dailyReports: summary.reports.map((report) => ({
          ...report,
          meetsAttendance: report.totalPeople >= minAttendanceValue,
          meetsRetention:
            report.totalPeople >= minAttendanceValue && report.retentionRatio >= retentionThresholdValue,
        })),
      };
    });

    leaders.sort((a, b) => {
      if (b.retentionHits !== a.retentionHits) {
        return b.retentionHits - a.retentionHits;
      }
      return b.qualifiedReports - a.qualifiedReports;
    });

    res.status(200).json([
      {
        data: {
          range: { startDate: start.format('YYYY-MM-DD'), endDate: end.format('YYYY-MM-DD') },
          thresholds: {
            minAttendance: minAttendanceValue,
            minReports: minReportsValue,
            retentionThreshold: retentionThresholdValue,
          },
          leaders,
          bestStaff: { userIds: Array.from(bestStaffIds), retentionHits: bestRetentionHits },
        },
        columns: [],
      },
    ]);
  } catch (error) {
    logger.error('Failed to calculate night report leader metrics', error);
    res.status(500).json([{ message: 'Failed to load leader metrics' }]);
  }
};

export const createVenueCompensationCollectionLog = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const actorId = requireActorId(req);
    const venueId = Number(req.body.venueId);
    if (!Number.isInteger(venueId) || venueId <= 0) {
      throw new HttpError(400, 'A valid venueId is required.');
    }

    const directionInput = typeof req.body.direction === 'string' ? req.body.direction.toLowerCase() : '';
    const direction = directionInput === 'receivable' || directionInput === 'payable' ? directionInput : null;
    if (!direction) {
      throw new HttpError(400, 'Direction must be either "receivable" or "payable".');
    }

    const currency =
      typeof req.body.currency === 'string' && req.body.currency.trim().length > 0
        ? req.body.currency.trim().toUpperCase()
        : 'USD';

    const amountMinor = parseAmountToMinor(req.body.amount);
    if (amountMinor <= 0) {
      throw new HttpError(400, 'Amount must be greater than zero.');
    }

    const rangeStartRaw = typeof req.body.rangeStart === 'string' ? req.body.rangeStart : '';
    const rangeEndRaw = typeof req.body.rangeEnd === 'string' ? req.body.rangeEnd : '';
    const rangeStart = dayjs(rangeStartRaw).startOf('day');
    const rangeEnd = dayjs(rangeEndRaw).endOf('day');
    if (!rangeStart.isValid() || !rangeEnd.isValid() || rangeEnd.isBefore(rangeStart)) {
      throw new HttpError(400, 'Provide a valid rangeStart and rangeEnd.');
    }

    const financeTransactionIdRaw =
      req.body.financeTransactionId !== undefined ? Number(req.body.financeTransactionId) : null;
    let financeTransactionId: number | null = null;
    if (financeTransactionIdRaw !== null && financeTransactionIdRaw !== 0) {
      if (!Number.isInteger(financeTransactionIdRaw) || financeTransactionIdRaw <= 0) {
        throw new HttpError(400, 'financeTransactionId must be a positive integer.');
      }
      const transactionExists = await FinanceTransaction.count({ where: { id: financeTransactionIdRaw } });
      if (!transactionExists) {
        throw new HttpError(400, 'Finance transaction not found.');
      }
      financeTransactionId = financeTransactionIdRaw;
    }

    const venueExists = await Venue.count({ where: { id: venueId } });
    if (!venueExists) {
      throw new HttpError(404, 'Venue not found.');
    }

    const note =
      typeof req.body.note === 'string' && req.body.note.trim().length > 0 ? req.body.note.trim() : null;

    const record = await VenueCompensationCollectionLog.create({
      venueId,
      direction,
      currencyCode: currency,
      amountMinor,
      rangeStart: rangeStart.format('YYYY-MM-DD'),
      rangeEnd: rangeEnd.format('YYYY-MM-DD'),
      financeTransactionId,
      note,
      createdBy: actorId,
    });

    res.status(201).json([record]);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json([{ message: error.message }]);
      return;
    }
    logger.error('Failed to record venue compensation collection', error);
    res.status(500).json([{ message: 'Failed to record collection' }]);
  }
};

export const getNightReportVenueSummary = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const periodParam = typeof req.query.period === 'string' ? req.query.period : undefined;
    const startDateParam = typeof req.query.startDate === 'string' ? req.query.startDate : undefined;
    const endDateParam = typeof req.query.endDate === 'string' ? req.query.endDate : undefined;

    const { period, start, end } = resolveVenueSummaryRange(periodParam, startDateParam, endDateParam);

    const detailRows = (await NightReportVenue.findAll({
      attributes: [
        'venueId',
        'venueName',
        'currencyCode',
        'direction',
        'payoutAmount',
        'totalPeople',
        [col('report.activity_date'), 'activityDate'],
        [col('report.id'), 'reportId'],
      ],
      include: [
        {
          model: NightReport,
          as: 'report',
          attributes: [],
          required: true,
          where: {
            status: 'submitted',
            activityDate: {
              [Op.between]: [start.format('YYYY-MM-DD'), end.format('YYYY-MM-DD')],
            },
          },
        },
      ],
      raw: true,
    })) as unknown as VenueDetailAggregate[];

    const collectionRows = (await VenueCompensationCollectionLog.findAll({
      attributes: [
        'venueId',
        'currencyCode',
        'direction',
        [fn('COALESCE', fn('SUM', col('amount_minor')), 0), 'totalAmountMinor'],
      ],
      where: {
        rangeStart: start.format('YYYY-MM-DD'),
        rangeEnd: end.format('YYYY-MM-DD'),
      },
      group: ['venue_id', 'currency_code', 'direction'],
      raw: true,
    })) as unknown as CollectionAggregate[];

    const collectionMap = new Map<string, { receivable: number; payable: number }>();
    const currencyCollectionMap = new Map<string, { receivable: number; payable: number }>();
    collectionRows.forEach((row) => {
      const venueKey = `${row.venueId ?? 'null'}|${(row.currencyCode ?? 'USD').toUpperCase()}`;
      const majorAmount = roundCurrencyValue(Number(row.totalAmountMinor ?? 0) / 100);
      if (majorAmount === 0) {
        return;
      }
      const venueTotals = collectionMap.get(venueKey) ?? { receivable: 0, payable: 0 };
      venueTotals[row.direction] += majorAmount;
      collectionMap.set(venueKey, venueTotals);

      const currencyKey = (row.currencyCode ?? 'USD').toUpperCase();
      const currencyTotals = currencyCollectionMap.get(currencyKey) ?? { receivable: 0, payable: 0 };
      currencyTotals[row.direction] += majorAmount;
      currencyCollectionMap.set(currencyKey, currencyTotals);
    });

    const venueMap = new Map<
      string,
      {
        venueId: number | null;
        venueName: string;
        currency: string;
        receivable: number;
        payable: number;
        totalPeople: number;
        daily: Array<{
          date: string;
          reportId: number | null;
          totalPeople: number;
          amount: number;
          direction: 'receivable' | 'payable';
        }>;
      }
    >();
    const totalsMap = new Map<string, { receivable: number; payable: number }>();

    detailRows.forEach((row) => {
      const currency = (row.currencyCode ?? 'USD').toUpperCase();
      const direction = row.direction === 'receivable' ? 'receivable' : 'payable';
      const numericAmount = Number(row.payoutAmount ?? 0);
      const amount = Number.isFinite(numericAmount) ? numericAmount : 0;
      const numericPeople = Number(row.totalPeople ?? 0);
      const totalPeople = Number.isFinite(numericPeople) ? numericPeople : 0;
      const activityDate = row.activityDate ? dayjs(row.activityDate).format('YYYY-MM-DD') : '';
      const reportId = typeof row.reportId === 'number' ? row.reportId : null;
      const venueId = row.venueId ?? null;
      const defaultName = venueId != null ? `Venue #${venueId}` : 'Unspecified Venue';
      const venueName = (row.venueName ?? '').trim() || defaultName;
      const key = `${venueId ?? 'null'}|${venueName}|${currency}`;

      if (!venueMap.has(key)) {
        venueMap.set(key, {
          venueId,
          venueName,
          currency,
          receivable: 0,
          payable: 0,
          totalPeople: 0,
          daily: [],
        });
      }

      const existing = venueMap.get(key)!;
      existing[direction] += amount;
      existing.totalPeople += totalPeople;
      existing.daily.push({
        date: activityDate,
        reportId,
        totalPeople,
        amount: roundCurrencyValue(amount),
        direction,
      });

      if (!totalsMap.has(currency)) {
        totalsMap.set(currency, { receivable: 0, payable: 0 });
      }
      totalsMap.get(currency)![direction] += amount;
    });

    venueMap.forEach((entry) => {
      entry.daily.sort((a, b) => a.date.localeCompare(b.date));
    });

    const venues = Array.from(venueMap.values()).map((entry) => {
      const key = `${entry.venueId ?? 'null'}|${entry.currency}`;
      const collected = collectionMap.get(key) ?? { receivable: 0, payable: 0 };
      const receivable = roundCurrencyValue(entry.receivable);
      const payable = roundCurrencyValue(entry.payable);
      const receivableCollected = roundCurrencyValue(collected.receivable);
      const payableCollected = roundCurrencyValue(collected.payable);

      return {
        venueId: entry.venueId,
        venueName: entry.venueName,
        currency: entry.currency,
        receivable,
        receivableCollected,
        receivableOutstanding: roundCurrencyValue(Math.max(receivable - receivableCollected, 0)),
        payable,
        payableCollected,
        payableOutstanding: roundCurrencyValue(Math.max(payable - payableCollected, 0)),
        net: roundCurrencyValue(receivable - payable),
        totalPeople: entry.totalPeople,
        daily: entry.daily,
        rowKey: key,
      };
    });

    venues.sort((a, b) => b.net - a.net);

    const totalsByCurrency = Array.from(totalsMap.entries()).map(([currency, sums]) => {
      const collected = currencyCollectionMap.get(currency) ?? { receivable: 0, payable: 0 };
      const receivable = roundCurrencyValue(sums.receivable);
      const payable = roundCurrencyValue(sums.payable);
      const receivableCollected = roundCurrencyValue(collected.receivable);
      const payableCollected = roundCurrencyValue(collected.payable);
      return {
        currency,
        receivable,
        receivableCollected,
        receivableOutstanding: roundCurrencyValue(Math.max(receivable - receivableCollected, 0)),
        payable,
        payableCollected,
        payableOutstanding: roundCurrencyValue(Math.max(payable - payableCollected, 0)),
        net: roundCurrencyValue(sums.receivable - sums.payable),
      };
    });

    res.status(200).json([
      {
        data: {
          period,
          range: { startDate: start.format('YYYY-MM-DD'), endDate: end.format('YYYY-MM-DD') },
          totalsByCurrency,
          venues,
        },
        columns: [],
      },
    ]);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json([{ message: error.message }]);
      return;
    }
    logger.error('Failed to generate venue payout summary', error);
    res.status(500).json([{ message: 'Failed to load venue payout summary' }]);
  }
};

export const uploadNightReportPhoto = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const sequelize = NightReport.sequelize;
  if (!sequelize) {
    res.status(500).json([{ message: 'Database connection unavailable' }]);
    return;
  }

  try {
    const actorId = requireActorId(req);
    const reportId = Number(req.params.id);
    if (!Number.isInteger(reportId) || reportId <= 0) {
      throw new HttpError(400, 'Invalid report id');
    }

    const report = await getNightReportById(reportId);
    if (!report) {
      res.status(404).json([{ message: 'Night report not found' }]);
      return;
    }

    if (!canManageReport(report, actorId, req.authContext?.roleSlug)) {
      throw new HttpError(403, 'You do not have permission to upload photos for this report');
    }

    const file = req.file;
    if (!file) {
      throw new HttpError(400, 'No file uploaded');
    }

    if (!file.mimetype.startsWith('image/')) {
      throw new HttpError(400, 'Only image uploads are supported');
    }

    await ensureNightReportStorage();

    const { relativePath } = await storeNightReportPhoto({
      reportId,
      activityDate: report.activityDate,
      originalName: file.originalname,
      mimeType: file.mimetype,
      data: file.buffer,
    });

    const capturedAt =
      typeof req.body?.capturedAt === 'string' && req.body.capturedAt
        ? new Date(req.body.capturedAt)
        : null;

    const photo = await NightReportPhoto.create({
      reportId,
      uploaderId: actorId,
      storagePath: relativePath,
      originalName: file.originalname,
      mimeType: file.mimetype,
      fileSize: file.size,
      capturedAt: capturedAt ? capturedAt : null,
    });

    res.status(201).json([
      {
        id: photo.id,
        originalName: photo.originalName,
        mimeType: photo.mimeType,
        fileSize: photo.fileSize,
        capturedAt: photo.capturedAt ? photo.capturedAt.toISOString() : null,
        downloadUrl: buildPhotoDownloadUrl(req, reportId, photo.id),
      },
    ]);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json([{ message: error.message }]);
      return;
    }
    logger.error('Failed to upload night report photo', error);
    res.status(500).json([{ message: 'Failed to upload night report photo' }]);
  }
};

export const deleteNightReportPhoto = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const sequelize = NightReport.sequelize;
  if (!sequelize) {
    res.status(500).json([{ message: 'Database connection unavailable' }]);
    return;
  }

  try {
    const actorId = requireActorId(req);
    const reportId = Number(req.params.id);
    const photoId = Number(req.params.photoId);

    if (!Number.isInteger(reportId) || reportId <= 0) {
      throw new HttpError(400, 'Invalid report id');
    }
    if (!Number.isInteger(photoId) || photoId <= 0) {
      throw new HttpError(400, 'Invalid photo id');
    }

    const report = await getNightReportById(reportId);
    if (!report) {
      res.status(404).json([{ message: 'Night report not found' }]);
      return;
    }

    if (!canManageReport(report, actorId, req.authContext?.roleSlug)) {
      throw new HttpError(403, 'You do not have permission to manage photos for this report');
    }

    const photo = await NightReportPhoto.findOne({ where: { id: photoId, reportId } });
    if (!photo) {
      res.status(404).json([{ message: 'Photo not found' }]);
      return;
    }

    await sequelize.transaction(async (transaction) => {
      await NightReportPhoto.destroy({ where: { id: photoId }, transaction });
    });
    await removePhotoFromDisk(photo.storagePath).catch((error) => {
      logger.warn(`Failed to remove photo ${photo.id} from disk`, error);
    });

    res.status(204).send();
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json([{ message: error.message }]);
      return;
    }
    logger.error('Failed to delete night report photo', error);
    res.status(500).json([{ message: 'Failed to delete night report photo' }]);
  }
};

export const downloadNightReportPhoto = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const actorId = requireActorId(req);
    const reportId = Number(req.params.id);
    const photoId = Number(req.params.photoId);

    if (!Number.isInteger(reportId) || reportId <= 0) {
      throw new HttpError(400, 'Invalid report id');
    }
    if (!Number.isInteger(photoId) || photoId <= 0) {
      throw new HttpError(400, 'Invalid photo id');
    }

    const report = await getNightReportById(reportId);
    if (!report) {
      res.status(404).json([{ message: 'Night report not found' }]);
      return;
    }

    if (!canManageReport(report, actorId, req.authContext?.roleSlug)) {
      throw new HttpError(403, 'You do not have permission to access this photo');
    }

    const photo = await NightReportPhoto.findOne({ where: { id: photoId, reportId } });
    if (!photo) {
      res.status(404).json([{ message: 'Photo not found' }]);
      return;
    }

    const stream = await openNightReportPhotoStream(photo.storagePath);
    res.setHeader('Content-Type', photo.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(photo.originalName)}"`);
    stream.on('error', (error) => {
      logger.error('Failed to stream night report photo', error);
      if (!res.headersSent) {
        res.status(500).json([{ message: 'Failed to stream photo' }]);
      } else {
        res.end();
      }
    });
    stream.pipe(res);
  } catch (error) {
    if (error instanceof HttpError) {
      if (!res.headersSent) {
        res.status(error.status).json([{ message: error.message }]);
      }
      return;
    }
    logger.error('Failed to download night report photo', error);
    if (!res.headersSent) {
      res.status(500).json([{ message: 'Failed to download night report photo' }]);
    }
  }
};
