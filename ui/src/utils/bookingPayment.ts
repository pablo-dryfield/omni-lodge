import type { UnifiedOrder } from "../store/bookingPlatformsTypes";

type BookingPaymentFields = Pick<UnifiedOrder, "paymentStatus" | "paymentMethod" | "rawData">;

const EXPLICITLY_UNPAID_STATUSES = new Set([
  "unpaid",
  "pending",
  "pending_payment",
  "payment_pending",
  "awaiting_payment",
  "awaiting_transfer",
  "requires_payment_method",
  "not_paid",
]);

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const normalizePaymentValue = (value: unknown): string =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

export const getBookingPaymentStatus = (order: BookingPaymentFields): string => {
  const raw = asRecord(order.rawData);
  return normalizePaymentValue(
    order.paymentStatus ?? raw.paymentStatus ?? raw.payment_status,
  ) || "unknown";
};

export const getBookingPaymentMethod = (order: BookingPaymentFields): string => {
  const raw = asRecord(order.rawData);
  return normalizePaymentValue(
    order.paymentMethod ?? raw.paymentMethod ?? raw.payment_method,
  ) || "unknown";
};

export const isExplicitlyUnpaidBooking = (order: BookingPaymentFields): boolean =>
  EXPLICITLY_UNPAID_STATUSES.has(getBookingPaymentStatus(order));

export const isBankTransferBooking = (order: BookingPaymentFields): boolean => {
  const method = getBookingPaymentMethod(order);
  return method === "bank_transfer" || method === "banktransfer";
};

/**
 * Legacy bookings often have no stored payment method, so they retain the
 * existing Stripe-backed actions. New bank-transfer and explicitly unpaid
 * bookings must never enter a Stripe refund workflow.
 */
export const canUseStripeRefundActions = (order: BookingPaymentFields): boolean =>
  !isBankTransferBooking(order) && !isExplicitlyUnpaidBooking(order);
