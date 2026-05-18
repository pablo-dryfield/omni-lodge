import type Stripe from 'stripe';
import { Op } from 'sequelize';
import Booking from '../../models/Booking.js';
import { getStripeClient } from '../../finance/services/stripeClient.js';
import { getEcwidOrder, type EcwidOrder } from '../ecwidService.js';
import logger from '../../utils/logger.js';

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

const normalizeCountry = (value: string | null | undefined): string | null => {
  const normalized = String(value ?? '').trim().toUpperCase();
  return normalized.length > 0 ? normalized.slice(0, 5) : null;
};

const normalizeIpAddress = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, 45);
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

const resolveBookingOrderWhere = (orderId: string) => ({
  platform: 'ecwid',
  [Op.or]: [
    { platformOrderId: orderId },
    { platformOrderId: { [Op.like]: `${orderId}-%` } },
    { platformBookingId: orderId },
    { platformBookingId: { [Op.like]: `${orderId}-%` } },
  ],
});

const parseFeeToCents = (value: string): number => {
  const parsed = Number.parseFloat(String(value ?? '').trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.round(parsed * 100);
};

const centsToMoneyString = (value: number): string => (value / 100).toFixed(2);

export const syncEcwidBookingProcessingFeeByBookingId = async (bookingId: number): Promise<void> => {
  const booking = await Booking.findByPk(bookingId, {
    attributes: [
      'id',
      'platform',
      'platformBookingId',
      'platformOrderId',
      'processingFee',
      'processingFeeCurrency',
      'paymentMethodCountry',
      'ipAddress',
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
    const orderIpAddress = normalizeIpAddress((ecwidOrder as Record<string, unknown>).ipAddress);

    let paymentMethodCountry: string | null = null;
    let fee: FeeSnapshot | null = null;
    if (externalTransactionId) {
      const stripe = getStripeClient();
      const charge = await resolveStripeChargeFromExternalTransaction(stripe, externalTransactionId);
      if (charge) {
        paymentMethodCountry = normalizeCountry(charge.payment_method_details?.card?.country ?? null);
        fee = extractFeeSnapshotFromCharge(charge);
      }
    }

    const relatedBookings = await Booking.findAll({
      where: resolveBookingOrderWhere(orderId),
      attributes: ['id', 'processingFee', 'processingFeeCurrency', 'paymentMethodCountry', 'ipAddress'],
      order: [['id', 'ASC']],
    });
    if (relatedBookings.length === 0) {
      return;
    }

    const canUpdateFee = Boolean(fee && parseFeeToCents(fee.feeAmount) > 0);
    if (!canUpdateFee && paymentMethodCountry === null && orderIpAddress === null) {
      return;
    }

    const feeCents = canUpdateFee && fee ? parseFeeToCents(fee.feeAmount) : 0;
    const baseCents = canUpdateFee ? Math.floor(feeCents / relatedBookings.length) : 0;
    const remainderCents = canUpdateFee ? feeCents % relatedBookings.length : 0;

    let changed = false;
    for (let index = 0; index < relatedBookings.length; index += 1) {
      const related = relatedBookings[index];
      const allocatedCents = canUpdateFee ? baseCents + (index < remainderCents ? 1 : 0) : 0;
      const allocatedFee = canUpdateFee ? centsToMoneyString(allocatedCents) : null;
      const feeUnchanged = !canUpdateFee
        ? true
        : related.processingFee === allocatedFee &&
          related.processingFeeCurrency === fee?.feeCurrency;
      const countryUnchanged =
        paymentMethodCountry === null || related.paymentMethodCountry === paymentMethodCountry;
      const ipUnchanged = orderIpAddress === null || related.ipAddress === orderIpAddress;
      if (feeUnchanged && countryUnchanged && ipUnchanged) {
        continue;
      }
      if (canUpdateFee && allocatedFee !== null) {
        related.processingFee = allocatedFee;
        related.processingFeeCurrency = fee?.feeCurrency ?? null;
      }
      if (paymentMethodCountry !== null) {
        related.paymentMethodCountry = paymentMethodCountry;
      }
      if (orderIpAddress !== null) {
        related.ipAddress = orderIpAddress;
      }
      await related.save();
      changed = true;
    }

    if (!changed) {
      return;
    }
  } catch (error) {
    logger.warn(
      `[booking-email] Unable to sync Ecwid processing fee for booking ${booking.id} (order ${orderId})`,
      error,
    );
  }
};
