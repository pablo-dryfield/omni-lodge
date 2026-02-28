import type { Response } from 'express';
import dayjs from 'dayjs';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import { getMarketingOverview } from '../services/marketingService.js';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

export const getMarketingOverviewController = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  const fallbackDate = typeof req.query.date === 'string' ? req.query.date.trim() : dayjs().format('YYYY-MM-DD');
  const rawStartDate =
    typeof req.query.startDate === 'string' ? req.query.startDate.trim() : fallbackDate;
  const rawEndDate =
    typeof req.query.endDate === 'string' ? req.query.endDate.trim() : fallbackDate;

  if (
    !ISO_DATE_PATTERN.test(rawStartDate) ||
    !ISO_DATE_PATTERN.test(rawEndDate) ||
    !dayjs(rawStartDate).isValid() ||
    !dayjs(rawEndDate).isValid()
  ) {
    res.status(400).json({ message: 'startDate and endDate must be in YYYY-MM-DD format' });
    return;
  }

  if (dayjs(rawEndDate).isBefore(dayjs(rawStartDate), 'day')) {
    res.status(400).json({ message: 'endDate must be on or after startDate' });
    return;
  }

  try {
    const payload = await getMarketingOverview(rawStartDate, rawEndDate);
    res.status(200).json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load marketing overview';
    res.status(500).json({ message });
  }
};
