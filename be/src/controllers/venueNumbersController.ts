import type { Response } from 'express';
import { Op } from 'sequelize';
import { DataType } from 'sequelize-typescript';
import Counter from '../models/Counter.js';
import NightReport from '../models/NightReport.js';
import NightReportVenue from '../models/NightReportVenue.js';
import Product from '../models/Product.js';
import User from '../models/User.js';
import UserType from '../models/UserType.js';
import Venue from '../models/Venue.js';
import FinanceAccount from '../finance/models/FinanceAccount.js';
import FinanceCategory from '../finance/models/FinanceCategory.js';
import FinanceClient from '../finance/models/FinanceClient.js';
import FinanceVendor from '../finance/models/FinanceVendor.js';
import logger from '../utils/logger.js';
import { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import { getNightReportVenueSummary } from './nightReportController.js';

type TableColumn = {
  header: string;
  accessorKey: string;
  type: string;
};

type ServerResponse<T> = Array<{
  data: T;
  columns: TableColumn[];
}>;

const buildTableColumns = (model: { getAttributes: () => Record<string, { type: unknown }> }): TableColumn[] =>
  Object.entries(model.getAttributes()).map(([key, attribute]) => ({
    header: key.charAt(0).toUpperCase() + key.slice(1),
    accessorKey: key,
    type: attribute.type instanceof DataType.DATE ? 'date' : 'text',
  }));

const NIGHT_REPORT_COLUMNS: TableColumn[] = [
  { header: 'ID', accessorKey: 'id', type: 'number' },
  { header: 'Date', accessorKey: 'activityDate', type: 'date' },
  { header: 'Leader', accessorKey: 'leaderName', type: 'text' },
  { header: 'Status', accessorKey: 'status', type: 'text' },
  { header: 'Total Venues', accessorKey: 'venuesCount', type: 'number' },
  { header: 'Total People', accessorKey: 'totalPeople', type: 'number' },
  { header: 'Counter ID', accessorKey: 'counterId', type: 'number' },
];

const buildNightReportSummaryRow = (report: NightReport) => {
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
};

const loadVenueSummaryResponse = async (
  req: AuthenticatedRequest,
): Promise<ServerResponse<Record<string, unknown>>> => {
  let statusCode = 200;
  let payload: unknown;
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(body: unknown) {
      payload = body;
      return this;
    },
  } as Response;

  await getNightReportVenueSummary(req, res);
  if (statusCode >= 400) {
    const message =
      Array.isArray(payload) && payload[0] && typeof payload[0].message === 'string'
        ? payload[0].message
        : 'Failed to load venue summary';
    throw new Error(message);
  }

  return payload as ServerResponse<Record<string, unknown>>;
};

export const getVenueNumbersEntriesBootstrap = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
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

    const [counters, venues, reports, users] = await Promise.all([
      Counter.findAll({
        include: [
          { model: User, as: 'manager', attributes: ['id', 'firstName', 'lastName'] },
          { model: User, as: 'createdByUser', attributes: ['id', 'firstName', 'lastName'] },
          { model: User, as: 'updatedByUser', attributes: ['id', 'firstName', 'lastName'] },
          { model: Product, as: 'product', attributes: ['id', 'name'] },
        ],
        order: [['date', 'DESC']],
      }),
      Venue.findAll({
        order: [
          ['isActive', 'DESC'],
          ['sortOrder', 'ASC'],
          ['name', 'ASC'],
        ],
      }),
      NightReport.findAll({
        where,
        include: [
          { model: User, as: 'leader', attributes: ['id', 'firstName', 'lastName'] },
          { model: NightReportVenue, as: 'venues', attributes: ['id', 'orderIndex', 'totalPeople', 'isOpenBar'] },
        ],
        order: [
          ['activityDate', 'DESC'],
          ['id', 'DESC'],
        ],
      }),
      User.findAll({
        where: { status: true },
        include: [{ model: UserType, as: 'role' }],
        order: [
          ['firstName', 'ASC'],
          ['lastName', 'ASC'],
        ],
      }),
    ]);

    const managers = users
      .map((user) => {
        const role = (user as User & { role?: UserType }).role;
        const slug = role?.slug?.toLowerCase();
        if (slug !== 'manager' && slug !== 'assistant-manager') {
          return null;
        }
        const fullName = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
        return {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          fullName,
          userTypeSlug: role?.slug ?? null,
          userTypeName: role?.name ?? null,
        };
      })
      .filter((manager) => manager != null);

    res.status(200).json({
      counters: [
        {
          data: counters,
          columns: buildTableColumns(Counter),
        },
      ],
      venues: [
        {
          data: venues,
          columns: buildTableColumns(Venue),
        },
      ],
      nightReports: [
        {
          data: reports.map(buildNightReportSummaryRow),
          columns: NIGHT_REPORT_COLUMNS,
        },
      ],
      managers,
    });
  } catch (error) {
    logger.error('Failed to bootstrap venue numbers entries', error);
    res.status(500).json({ message: 'Failed to load venue numbers entries' });
  }
};

export const getVenueNumbersSummaryBootstrap = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const [venues, accounts, categories, vendors, clients, summary] = await Promise.all([
      Venue.findAll({
        order: [
          ['isActive', 'DESC'],
          ['sortOrder', 'ASC'],
          ['name', 'ASC'],
        ],
      }),
      FinanceAccount.findAll({ order: [['name', 'ASC']] }),
      FinanceCategory.findAll({
        order: [
          ['kind', 'ASC'],
          ['parentId', 'ASC'],
          ['name', 'ASC'],
        ],
      }),
      FinanceVendor.findAll({ order: [['name', 'ASC']] }),
      FinanceClient.findAll({ order: [['name', 'ASC']] }),
      loadVenueSummaryResponse(req),
    ]);

    res.status(200).json({
      venues: [
        {
          data: venues,
          columns: buildTableColumns(Venue),
        },
      ],
      finance: {
        accounts,
        categories,
        vendors,
        clients,
      },
      summary,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load venue summary';
    logger.error('Failed to bootstrap venue numbers summary', error);
    res.status(500).json({ message });
  }
};

export const getVenueNumbersSummary = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  await getNightReportVenueSummary(req, res);
};
