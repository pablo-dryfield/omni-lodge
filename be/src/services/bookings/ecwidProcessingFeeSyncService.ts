import type Stripe from 'stripe';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { Op } from 'sequelize';
import Booking from '../../models/Booking.js';
import { getStripeClient } from '../../finance/services/stripeClient.js';
import { getEcwidOrder, type EcwidOrder } from '../ecwidService.js';
import logger from '../../utils/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const STORE_TIMEZONE = 'Europe/Warsaw';

const stripEcwidItemSuffix = (value: string): string => value.replace(/-\d+$/, '');

const normalizeExternalTransactionId = (order: EcwidOrder): string | null => {
  const candidate = (order as { externalTransactionId?: unknown }).externalTransactionId;
  if (typeof candidate === 'string' && candidate.trim().length > 0) {
    return candidate.trim();
  }
  if (typeof candidate === 'number' && Number.isFinite(candidate)) {
    return String(candidate);
  }
  return null;
};

const isStripeResourceMissing = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') {
    return false;
  }
  return (error as { code?: string }).code === 'resource_missing';
};

const normalizeCurrency = (value: string | null | undefined): string | null => {
  const normalized = String(value ?? '').trim().toUpperCase();
  return normalized.length > 0 ? normalized.slice(0, 3) : null;
};

const normalizeMoney = (value: number | null): string | null => {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  return value.toFixed(2);
};

const resolveStripeChargeFromExternalTransaction = async (
  stripe: Stripe,
  externalTransactionId: string,
): Promise<Stripe.Charge | null> => {
  const trimmed = externalTransactionId.trim();
  if (!trimmed) {
    return null;
  }

  const tryPaymentIntent = async (): Promise<Stripe.Charge | null> => {
    try {
      const intent = await stripe.paymentIntents.retrieve(trimmed);
      let latestChargeId: string | null = null;
      if (typeof intent.latest_charge === 'string' && intent.latest_charge.trim().length > 0) {
        latestChargeId = intent.latest_charge.trim();
      } else if (intent.latest_charge && typeof intent.latest_charge === 'object') {
        latestChargeId = intent.latest_charge.id ?? null;
      }
      if (!latestChargeId) {
        return null;
      }
      const charge = await stripe.charges.retrieve(latestChargeId, {
        expand: ['balance_transaction'],
      });
      if ('deleted' in charge && charge.deleted) {
        return null;
      }
      return charge as Stripe.Charge;
    } catch (error) {
      if (isStripeResourceMissing(error)) {
        return null;
      }
      throw error;
    }
  };

  const tryCharge = async (): Promise<Stripe.Charge | null> => {
    try {
      const charge = await stripe.charges.retrieve(trimmed, {
        expand: ['balance_transaction'],
      });
      if ('deleted' in charge && charge.deleted) {
        return null;
      }
      return charge as Stripe.Charge;
    } catch (error) {
      if (isStripeResourceMissing(error)) {
        return null;
      }
      throw error;
    }
  };

  if (trimmed.startsWith('pi_')) {
    return (await tryPaymentIntent()) ?? (await tryCharge());
  }
  if (trimmed.startsWith('ch_')) {
    return (await tryCharge()) ?? (await tryPaymentIntent());
  }
  return (await tryPaymentIntent()) ?? (await tryCharge());
};

type FeeSnapshot = {
  feeAmount: string;
  feeCurrency: string | null;
};

const extractFeeSnapshotFromCharge = (charge: Stripe.Charge): FeeSnapshot | null => {
  let feeAmount: number | null = null;
  let feeCurrency: string | null = normalizeCurrency(charge.currency ?? null);
  const balanceTransaction = charge.balance_transaction;
  if (balanceTransaction && typeof balanceTransaction === 'object' && !('deleted' in balanceTransaction)) {
    const rawFee = Number(balanceTransaction.fee ?? 0);
    if (Number.isFinite(rawFee)) {
      feeAmount = Math.max(rawFee / 100, 0);
    }
    feeCurrency = normalizeCurrency(balanceTransaction.currency ?? charge.currency ?? null);
  }

  if (feeAmount === null || feeAmount <= 0) {
    return null;
  }

  return {
    feeAmount: normalizeMoney(feeAmount) ?? '0.00',
    feeCurrency,
  };
};

type StripeFeeWindowResult = {
  feeByTransactionId: Map<string, FeeSnapshot>;
  requestCount: number;
};

const loadStripeFeeWindow = async (
  stripe: Stripe,
  startDate: string,
  endDate: string,
): Promise<StripeFeeWindowResult> => {
  const startUnix = dayjs.tz(startDate, 'YYYY-MM-DD', STORE_TIMEZONE).startOf('day').unix();
  const endUnixExclusive = dayjs.tz(endDate, 'YYYY-MM-DD', STORE_TIMEZONE).add(1, 'day').startOf('day').unix();

  const feeByTransactionId = new Map<string, FeeSnapshot>();
  let requestCount = 0;
  let startingAfter: string | undefined;

  for (;;) {
    const page = await stripe.charges.list({
      limit: 100,
      starting_after: startingAfter,
      created: {
        gte: startUnix,
        lt: endUnixExclusive,
      },
      expand: ['data.balance_transaction'],
    });
    requestCount += 1;

    for (const charge of page.data) {
      const fee = extractFeeSnapshotFromCharge(charge);
      if (!fee) {
        continue;
      }

      const chargeId = String(charge.id ?? '').trim();
      if (chargeId) {
        feeByTransactionId.set(chargeId, fee);
      }

      const paymentIntentId =
        typeof charge.payment_intent === 'string'
          ? charge.payment_intent.trim()
          : charge.payment_intent && typeof charge.payment_intent === 'object'
            ? String(charge.payment_intent.id ?? '').trim()
            : '';
      if (paymentIntentId) {
        feeByTransactionId.set(paymentIntentId, fee);
      }
    }

    if (!page.has_more || page.data.length === 0) {
      break;
    }
    startingAfter = page.data[page.data.length - 1]?.id;
    if (!startingAfter) {
      break;
    }
  }

  return {
    feeByTransactionId,
    requestCount,
  };
};

type EcwidProcessingFeeBackfillParams = {
  orderIds: string[];
  startDate: string;
  endDate: string;
  knownExternalTransactionByOrderId?: Record<string, string>;
};

export type EcwidProcessingFeeBackfillResult = {
  requestedOrders: number;
  updatedOrders: number;
  updatedBookings: number;
  skippedNoExternalTransaction: number;
  unresolvedStripeMatch: number;
  stripeListRequests: number;
  stripeFallbackLookups: number;
};

const resolveBookingOrderWhere = (orderId: string) => ({
  platform: 'ecwid',
  [Op.or]: [
    { platformOrderId: orderId },
    { platformOrderId: { [Op.like]: `${orderId}-%` } },
    { platformBookingId: orderId },
    { platformBookingId: { [Op.like]: `${orderId}-%` } },
  ],
});

export const backfillEcwidProcessingFeesByOrderIds = async (
  params: EcwidProcessingFeeBackfillParams,
): Promise<EcwidProcessingFeeBackfillResult> => {
  const orderIds = Array.from(
    new Set(
      (Array.isArray(params.orderIds) ? params.orderIds : [])
        .map((value) => stripEcwidItemSuffix(String(value ?? '').trim()))
        .filter((value) => value.length > 0),
    ),
  );

  if (orderIds.length === 0) {
    return {
      requestedOrders: 0,
      updatedOrders: 0,
      updatedBookings: 0,
      skippedNoExternalTransaction: 0,
      unresolvedStripeMatch: 0,
      stripeListRequests: 0,
      stripeFallbackLookups: 0,
    };
  }

  const knownByOrderId = new Map<string, string>();
  const knownEntries = Object.entries(params.knownExternalTransactionByOrderId ?? {});
  for (const [orderIdRaw, transactionIdRaw] of knownEntries) {
    const orderId = stripEcwidItemSuffix(String(orderIdRaw ?? '').trim());
    const transactionId = String(transactionIdRaw ?? '').trim();
    if (orderId && transactionId) {
      knownByOrderId.set(orderId, transactionId);
    }
  }

  const stripe = getStripeClient();
  const stripeWindow = await loadStripeFeeWindow(stripe, params.startDate, params.endDate);
  const feeByTransactionId = stripeWindow.feeByTransactionId;

  let updatedOrders = 0;
  let updatedBookings = 0;
  let skippedNoExternalTransaction = 0;
  let unresolvedStripeMatch = 0;
  let stripeFallbackLookups = 0;

  for (const orderId of orderIds) {
    let externalTransactionId = knownByOrderId.get(orderId) ?? null;

    if (!externalTransactionId) {
      try {
        const ecwidOrder = await getEcwidOrder(orderId);
        externalTransactionId = normalizeExternalTransactionId(ecwidOrder);
      } catch (error) {
        logger.warn(`[booking-email] Unable to load Ecwid order while fee backfill: ${orderId}`, error);
        externalTransactionId = null;
      }
    }

    if (!externalTransactionId) {
      skippedNoExternalTransaction += 1;
      continue;
    }

    let fee = feeByTransactionId.get(externalTransactionId) ?? null;
    if (!fee) {
      try {
        stripeFallbackLookups += 1;
        const charge = await resolveStripeChargeFromExternalTransaction(stripe, externalTransactionId);
        if (charge) {
          fee = extractFeeSnapshotFromCharge(charge);
          if (fee) {
            const chargeId = String(charge.id ?? '').trim();
            if (chargeId) {
              feeByTransactionId.set(chargeId, fee);
            }
            const paymentIntentId =
              typeof charge.payment_intent === 'string'
                ? charge.payment_intent.trim()
                : charge.payment_intent && typeof charge.payment_intent === 'object'
                  ? String(charge.payment_intent.id ?? '').trim()
                  : '';
            if (paymentIntentId) {
              feeByTransactionId.set(paymentIntentId, fee);
            }
            feeByTransactionId.set(externalTransactionId, fee);
          }
        }
      } catch (error) {
        logger.warn(`[booking-email] Stripe fallback lookup failed for external tx ${externalTransactionId}`, error);
      }
    }

    if (!fee) {
      unresolvedStripeMatch += 1;
      continue;
    }

    const [affected] = await Booking.update(
      {
        processingFee: fee.feeAmount,
        processingFeeCurrency: fee.feeCurrency,
      },
      {
        where: resolveBookingOrderWhere(orderId),
      },
    );

    if (affected > 0) {
      updatedOrders += 1;
      updatedBookings += affected;
    }
  }

  return {
    requestedOrders: orderIds.length,
    updatedOrders,
    updatedBookings,
    skippedNoExternalTransaction,
    unresolvedStripeMatch,
    stripeListRequests: stripeWindow.requestCount,
    stripeFallbackLookups,
  };
};

export const syncEcwidBookingProcessingFeeByBookingId = async (bookingId: number): Promise<void> => {
  const booking = await Booking.findByPk(bookingId, {
    attributes: [
      'id',
      'platform',
      'platformBookingId',
      'platformOrderId',
      'processingFee',
      'processingFeeCurrency',
    ],
  });
  if (!booking || booking.platform !== 'ecwid') {
    return;
  }

  const rawOrderId = booking.platformOrderId?.trim() || booking.platformBookingId?.trim() || '';
  const orderId = stripEcwidItemSuffix(rawOrderId);
  if (!orderId) {
    return;
  }

  try {
    const ecwidOrder = await getEcwidOrder(orderId);
    const externalTransactionId = normalizeExternalTransactionId(ecwidOrder);
    if (!externalTransactionId) {
      return;
    }

    const stripe = getStripeClient();
    const charge = await resolveStripeChargeFromExternalTransaction(stripe, externalTransactionId);
    if (!charge) {
      return;
    }

    const fee = extractFeeSnapshotFromCharge(charge);
    if (!fee) {
      return;
    }

    if (
      booking.processingFee === fee.feeAmount &&
      booking.processingFeeCurrency === fee.feeCurrency
    ) {
      return;
    }

    booking.processingFee = fee.feeAmount;
    booking.processingFeeCurrency = fee.feeCurrency;
    await booking.save();
  } catch (error) {
    logger.warn(
      `[booking-email] Unable to sync Ecwid processing fee for booking ${booking.id} (order ${orderId})`,
      error,
    );
  }
};
