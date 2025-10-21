import type { Response } from 'express';
import { Op } from 'sequelize';
import Counter from '../models/Counter.js';
import NightReport, { type NightReportStatus } from '../models/NightReport.js';
import NightReportVenue from '../models/NightReportVenue.js';
import NightReportPhoto from '../models/NightReportPhoto.js';
import User from '../models/User.js';
import HttpError from '../errors/HttpError.js';
import { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import logger from '../utils/logger.js';
import {
  ensureNightReportStorage,
  storeNightReportPhoto,
  deleteNightReportPhoto as removePhotoFromDisk,
  openNightReportPhotoStream,
} from '../services/nightReportStorageService.js';

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
    totalPeople: number;
    isOpenBar: boolean;
    normalCount: number | null;
    cocktailsCount: number | null;
    brunchCount: number | null;
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
  let normalizedBase = basePath;
  if (!normalizedBase) {
    normalizedBase = '/api/nightReports';
  } else if (!normalizedBase.startsWith('/api')) {
    normalizedBase = normalizedBase.startsWith('/')
      ? `/api${normalizedBase}`
      : `/api/${normalizedBase}`;
  }
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
      totalPeople: venue.totalPeople,
      isOpenBar: venue.isOpenBar,
      normalCount: venue.normalCount,
      cocktailsCount: venue.cocktailsCount,
      brunchCount: venue.brunchCount,
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
        const venueRows = normalizedVenues.map((venue) => ({
          reportId: report.id,
          orderIndex: venue.orderIndex,
          venueName: venue.venueName,
          totalPeople: venue.totalPeople,
          isOpenBar: venue.isOpenBar,
          normalCount: venue.normalCount,
          cocktailsCount: venue.cocktailsCount,
          brunchCount: venue.brunchCount,
        }));

        await NightReportVenue.bulkCreate(venueRows, { transaction });
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

    if (report.status === 'submitted') {
      throw new HttpError(400, 'Submitted reports cannot be edited');
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

    const venuesInput = normalizeVenueInput(body.venues);
    const normalizedVenues = venuesInput.length > 0 ? validateAndArrangeVenues(venuesInput) : null;

    await sequelize.transaction(async (transaction) => {
      if (Object.keys(updatePayload).length > 0) {
        updatePayload.updatedBy = actorId;
        await NightReport.update(updatePayload, { where: { id: reportId }, transaction });
      }

      if (normalizedVenues) {
        await NightReportVenue.destroy({ where: { reportId }, transaction });
        const venueRows = normalizedVenues.map((venue) => ({
          reportId,
          orderIndex: venue.orderIndex,
          venueName: venue.venueName,
          totalPeople: venue.totalPeople,
          isOpenBar: venue.isOpenBar,
          normalCount: venue.normalCount,
          cocktailsCount: venue.cocktailsCount,
          brunchCount: venue.brunchCount,
        }));
        if (venueRows.length > 0) {
          await NightReportVenue.bulkCreate(venueRows, { transaction });
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

    const venues = report.venues ?? [];
    if (venues.length === 0) {
      throw new HttpError(400, 'At least one venue must be recorded before submission');
    }

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

    const photoCount = await NightReportPhoto.count({ where: { reportId } });
    if (photoCount === 0) {
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

    const { relativePath } = await storeNightReportPhoto(reportId, file.originalname, file.mimetype, file.buffer);

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

    const stream = openNightReportPhotoStream(photo.storagePath);
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
