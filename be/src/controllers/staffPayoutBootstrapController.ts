import type { Response } from 'express';
import dayjs from 'dayjs';
import FinanceAccount from '../finance/models/FinanceAccount.js';
import FinanceCategory from '../finance/models/FinanceCategory.js';
import FinanceVendor from '../finance/models/FinanceVendor.js';
import CompensationComponent from '../models/CompensationComponent.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import logger from '../utils/logger.js';
import { getCommissionByDateRange } from './reportController.js';

const PAYOUT_MANAGEMENT_ROLES = new Set(['admin', 'manager', 'owner']);

const normalizeRoleSlug = (value: string | null | undefined): string => {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  return normalized === 'administrator' ? 'admin' : normalized;
};

type CapturedResponse = {
  statusCode: number;
  body: unknown;
};

const runCommissionReport = async (
  req: AuthenticatedRequest,
): Promise<CapturedResponse> => {
  let statusCode = 200;
  let body: unknown = null;
  const reportRequest = {
    ...req,
    query: {
      ...req.query,
      scope: req.staffPayoutAccessScope,
    },
    authContext: req.authContext,
    staffPayoutAccessScope: req.staffPayoutAccessScope,
  } as unknown as AuthenticatedRequest;
  const captureResponse = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
      return this;
    },
  } as unknown as Response;

  await getCommissionByDateRange(reportRequest, captureResponse);
  return { statusCode, body };
};

const removeSelfServiceSettlementIntents = (payload: unknown): unknown => {
  if (!Array.isArray(payload)) {
    return payload;
  }
  return payload.map((envelope) => {
    if (!envelope || typeof envelope !== 'object') {
      return envelope;
    }
    const typedEnvelope = envelope as { data?: unknown };
    if (!Array.isArray(typedEnvelope.data)) {
      return envelope;
    }
    return {
      ...typedEnvelope,
      data: typedEnvelope.data.map((summary) => {
        if (!summary || typeof summary !== 'object') {
          return summary;
        }
        const typedSummary = summary as { settlementSources?: unknown };
        return {
          ...typedSummary,
          settlementSources: Array.isArray(typedSummary.settlementSources)
            ? typedSummary.settlementSources.map((source) => (
                source && typeof source === 'object'
                  ? { ...source, settlementIntent: null }
                  : source
              ))
            : typedSummary.settlementSources,
        };
      }),
    };
  });
};

const loadManagementSetup = async () => {
  const [accounts, categories, vendors, components] = await Promise.all([
    FinanceAccount.findAll({
      attributes: ['id', 'name', 'type', 'currency', 'isActive'],
      order: [['name', 'ASC']],
    }),
    FinanceCategory.findAll({
      attributes: ['id', 'name', 'kind', 'parentId', 'isActive'],
      order: [
        ['kind', 'ASC'],
        ['parentId', 'ASC'],
        ['name', 'ASC'],
      ],
    }),
    FinanceVendor.findAll({
      attributes: ['id', 'name', 'defaultCategoryId', 'isActive'],
      order: [['name', 'ASC']],
    }),
    CompensationComponent.findAll({
      attributes: [
        'id',
        'name',
        'slug',
        'category',
        'calculationMethod',
        'config',
        'currencyCode',
        'defaultFinanceAccountId',
        'defaultFinanceCategoryId',
        'isActive',
      ],
      order: [
        ['category', 'ASC'],
        ['name', 'ASC'],
      ],
    }),
  ]);

  return {
    finance: { accounts, categories, vendors },
    compensationComponents: components.map((component) => ({
      ...component.get({ plain: true }),
      assignments: [],
    })),
  };
};

export const getStaffPayoutBootstrap = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    res.setHeader('Cache-Control', 'private, no-store');
    const accessScope = req.staffPayoutAccessScope;
    if (!accessScope) {
      res.status(403).json([{ message: 'Forbidden' }]);
      return;
    }

    const startDate = typeof req.query.startDate === 'string' ? req.query.startDate : '';
    const endDate = typeof req.query.endDate === 'string' ? req.query.endDate : '';
    const parsedStart = dayjs(startDate);
    const parsedEnd = dayjs(endDate);
    const datesAreValid = /^\d{4}-\d{2}-\d{2}$/.test(startDate)
      && /^\d{4}-\d{2}-\d{2}$/.test(endDate)
      && parsedStart.isValid()
      && parsedEnd.isValid()
      && parsedStart.format('YYYY-MM-DD') === startDate
      && parsedEnd.format('YYYY-MM-DD') === endDate
      && !parsedEnd.isBefore(parsedStart, 'day');
    if (!datesAreValid) {
      res.status(400).json([{ message: 'Valid startDate and endDate are required' }]);
      return;
    }

    const canManagePayouts = accessScope === 'all'
      && PAYOUT_MANAGEMENT_ROLES.has(normalizeRoleSlug(req.authContext?.roleSlug));
    const [report, managementSetup] = await Promise.all([
      runCommissionReport(req),
      canManagePayouts ? loadManagementSetup() : Promise.resolve(null),
    ]);

    if (report.statusCode < 200 || report.statusCode >= 300) {
      res.status(report.statusCode).json(report.body);
      return;
    }

    res.status(200).json([{
      data: {
        pays: accessScope === 'self'
          ? removeSelfServiceSettlementIntents(report.body)
          : report.body,
        scope: accessScope,
        canManagePayouts,
        finance: managementSetup?.finance ?? null,
        compensationComponents: managementSetup?.compensationComponents ?? null,
      },
      columns: [],
    }]);
  } catch (error) {
    logger.error('Failed to load staff payout bootstrap', error);
    res.status(500).json([{ message: 'Failed to load staff payments' }]);
  }
};
