import type { Response } from 'express';
import dayjs from 'dayjs';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import { getAffiliateOverview, updateAffiliateAssignments, type AffiliateAssignmentRule } from '../services/affiliateService.js';
import { createAffiliatePayout, undoAffiliatePayout } from '../services/affiliatePayoutService.js';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

const parseOptionalAffiliateUserId = (value: unknown): number | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === 'all') {
    return null;
  }
  const numeric = Number(trimmed);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
};

const parseDate = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  if (!ISO_DATE_PATTERN.test(trimmed) || !dayjs(trimmed).isValid()) {
    return fallback;
  }
  return trimmed;
};

export const getAffiliateOverviewController = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const fallbackDate = dayjs().format('YYYY-MM-DD');
  const startDate = parseDate(req.query.startDate, dayjs().startOf('month').format('YYYY-MM-DD'));
  const endDate = parseDate(req.query.endDate, fallbackDate);
  const selectedAffiliateUserId = parseOptionalAffiliateUserId(req.query.affiliateUserId);
  const currentUserId = req.authContext?.id ?? 0;
  const currentRoleSlug = req.authContext?.roleSlug ?? null;
  const canViewStaffAssignments = ['admin', 'administrator', 'owner', 'manager'].includes(
    (currentRoleSlug ?? '').trim().toLowerCase(),
  );

  try {
    const payload = await getAffiliateOverview({
      startDate,
      endDate,
      selectedAffiliateUserId,
      currentUserId,
      currentRoleSlug,
      includeStaffAffiliateAssignments: canViewStaffAssignments,
    });
    res.status(200).json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load affiliate overview';
    res.status(500).json({ message });
  }
};

const isValidRule = (rule: unknown): rule is AffiliateAssignmentRule => {
  if (!rule || typeof rule !== 'object') {
    return false;
  }
  const candidate = rule as Partial<AffiliateAssignmentRule>;
  const userId = Number(candidate.userId ?? 0);
  return Number.isInteger(userId) && userId > 0;
};

export const updateAffiliateAssignmentsController = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const rules = (Array.isArray(req.body?.rules) ? req.body.rules.filter(isValidRule) : []) as AffiliateAssignmentRule[];
    const payload = await updateAffiliateAssignments({
      rules: rules.map((rule: AffiliateAssignmentRule, index: number) => ({
        id: typeof rule.id === 'string' && rule.id.trim().length > 0 ? rule.id.trim() : `rule-${index + 1}`,
        userId: Number(rule.userId),
        utmSource: typeof rule.utmSource === 'string' ? rule.utmSource : null,
        utmMedium: typeof rule.utmMedium === 'string' ? rule.utmMedium : null,
        utmCampaign: typeof rule.utmCampaign === 'string' ? rule.utmCampaign : null,
        notes: typeof rule.notes === 'string' ? rule.notes : null,
      })),
      actorId: req.authContext?.id ?? 0,
    });

    res.status(200).json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save affiliate assignments';
    res.status(500).json({ message });
  }
};

const parseRequiredPositiveInteger = (value: unknown, field: string): number => {
  const numeric = typeof value === 'number' ? value : Number(value ?? 0);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return numeric;
};

const parseBodyDate = (value: unknown, field: string): string => {
  if (typeof value !== 'string') {
    throw new Error(`${field} must be a valid YYYY-MM-DD date`);
  }
  const trimmed = value.trim();
  if (!ISO_DATE_PATTERN.test(trimmed) || !dayjs(trimmed).isValid()) {
    throw new Error(`${field} must be a valid YYYY-MM-DD date`);
  }
  return trimmed;
};

export const createAffiliatePayoutController = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const payload = await createAffiliatePayout({
      affiliateUserId: parseRequiredPositiveInteger(req.body?.affiliateUserId, 'affiliateUserId'),
      startDate: parseBodyDate(req.body?.startDate, 'startDate'),
      endDate: parseBodyDate(req.body?.endDate, 'endDate'),
      accountId: parseRequiredPositiveInteger(req.body?.accountId, 'accountId'),
      categoryId: parseRequiredPositiveInteger(req.body?.categoryId, 'categoryId'),
      paidDate: parseBodyDate(req.body?.paidDate, 'paidDate'),
      note: typeof req.body?.note === 'string' ? req.body.note : null,
      actorId: req.authContext?.id ?? 0,
    });

    res.status(201).json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create affiliate payout';
    res.status(400).json({ message });
  }
};

export const undoAffiliatePayoutController = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const payoutLogId = parseRequiredPositiveInteger(req.params.id, 'payoutLogId');
    await undoAffiliatePayout(payoutLogId, req.authContext?.id ?? 0);
    res.status(204).send();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to undo affiliate payout';
    res.status(message === 'Affiliate payout not found' ? 404 : 400).json({ message });
  }
};
