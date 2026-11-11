import type Stripe from 'stripe';
import { Op } from 'sequelize';
import Booking from '../../models/Booking.js';
import { getStripeClient } from '../../finance/services/stripeClient.js';
import { getEcwidOrder, type EcwidOrder } from '../ecwidService.js';
import logger from '../../utils/logger.js';
import { allocateBookingStripeFee, normalizeStripeFeeForBooking, type StripeSettlementFee } from './stripeProcessingFee.js';

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

const extractFeeSnapshotFromCharge = (charge: Stripe.Charge): StripeSettlementFee | null => {
  if (!charge.paid || !charge.captured) return null;
  const balanceTransaction = charge.balance_transaction;
  if (balanceTransaction && typeof balanceTransaction === 'object' && !('deleted' in balanceTransaction)) {
    const currency = normalizeCurrency(balanceTransaction.currency);
    const chargeCurrency = normalizeCurrency(charge.currency);
    if (Number.isSafeInteger(balanceTransaction.fee) && balanceTransaction.fee >= 0 && currency && chargeCurrency) {
      return { feeMinor: balanceTransaction.fee, currency, chargeCurrency, exchangeRate: balanceTransaction.exchange_rate ?? null };
    }
  }
  return null;
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
    let fee: StripeSettlementFee | null = null;
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
      attributes: ['id', 'currency', 'processingFee', 'processingFeeCurrency', 'paymentMethodCountry', 'ipAddress'],
      order: [['id', 'ASC']],
    });
    if (relatedBookings.length === 0) {
      return;
    }

    let allocations: Map<number, string> | null = null;
    let feeCurrency: string | null = null;
    if (fee) {
      try {
        const currencies = new Set(relatedBookings.map(row => String(row.currency ?? '').trim().toUpperCase()));
        if (currencies.size !== 1) throw new Error('Ecwid booking lines use inconsistent currencies.');
        const reporting = normalizeStripeFeeForBooking(fee, relatedBookings[0].currency);
        allocations = allocateBookingStripeFee(reporting.feeMinor, reporting.currency, relatedBookings.map(row => Number(row.id)));
        feeCurrency = reporting.currency;
      } catch (error) {
        logger.warn(`[booking-email] Retaining fee until currency-safe reconciliation for booking ${booking.id}: ${error instanceof Error ? error.message : 'Invalid fee currency'}`);
      }
    }
    const canUpdateFee = allocations != null;
    if (!canUpdateFee && paymentMethodCountry === null && orderIpAddress === null) {
      return;
    }

    let changed = false;
    for (let index = 0; index < relatedBookings.length; index += 1) {
      const related = relatedBookings[index];
      const allocatedFee = allocations?.get(Number(related.id)) ?? null;
      const feeUnchanged = !canUpdateFee
        ? true
        : related.processingFee === allocatedFee &&
          related.processingFeeCurrency === feeCurrency;
      const countryUnchanged =
        paymentMethodCountry === null || related.paymentMethodCountry === paymentMethodCountry;
      const ipUnchanged = orderIpAddress === null || related.ipAddress === orderIpAddress;
      if (feeUnchanged && countryUnchanged && ipUnchanged) {
        continue;
      }
      if (canUpdateFee && allocatedFee !== null) {
        related.processingFee = allocatedFee;
        related.processingFeeCurrency = feeCurrency;
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
