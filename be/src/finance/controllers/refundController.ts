import { Request, Response } from 'express';
import Stripe from 'stripe';
import stripe from '../services/stripeClient.js';

const clampLimit = (value: number, fallback: number): number => {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.min(value, 100);
};

const parseOptionalNumber = (value: unknown): number | null => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const listStripeRefunds = async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = clampLimit(Number(req.query.limit), 100);
    const maxResults = parseOptionalNumber(req.query.maxResults);

    const params: Stripe.RefundListParams = { limit };
    if (typeof req.query.charge === 'string' && req.query.charge.trim().length > 0) {
      params.charge = req.query.charge.trim();
    }
    if (typeof req.query.payment_intent === 'string' && req.query.payment_intent.trim().length > 0) {
      params.payment_intent = req.query.payment_intent.trim();
    }
    const refunds: Stripe.Refund[] = [];
    for await (const refund of stripe.refunds.list(params)) {
      refunds.push(refund);
      if (maxResults && refunds.length >= maxResults) {
        break;
      }
    }

    res.status(200).json({ data: refunds, has_more: Boolean(maxResults && refunds.length >= maxResults) });
  } catch (error) {
    res.status(500).json([{ message: (error as Error).message }]);
  }
};
