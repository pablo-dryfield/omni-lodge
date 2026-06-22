import type { Response } from 'express';
import dayjs from 'dayjs';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import { getAffiliateOverview, updateAffiliateAssignments, type AffiliateAssignmentRule } from '../services/affiliateService.js';

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

  try {
    const payload = await getAffiliateOverview({
      startDate,
      endDate,
      selectedAffiliateUserId,
      currentUserId,
      currentRoleSlug,
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
