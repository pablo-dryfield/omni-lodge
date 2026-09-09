export type PaidOrderFulfillmentSnapshot = {
  status: string;
  paymentStatus: string;
  paymentMethod: string | null;
  metadata: Record<string, unknown> | null;
  createdByUserId: number | null;
  paymentReceivedByUserId: number | null;
};

export type PaidOrderFulfillmentRequest = {
  actorId?: number;
  paymentMethod?: string;
  paymentReceivedByUserId?: number | null;
  paymentNote?: string | null;
  receivedPaymentReference?: string | null;
  clientRequestId?: string | null;
  stripePaymentIntentId?: string | null;
  fallbackPaymentMethod: string;
  systemUserId: number;
};

export type PaidOrderFulfillmentPolicy = {
  shouldProcess: boolean;
  firstSettlement: boolean;
  actorId: number;
  paymentMethod: string;
  stripePaymentIntentId?: string | null;
  metadata: Record<string, unknown> | null;
  receiptUpdates: {
    paymentReceivedByUserId?: number | null;
    paymentNote?: string | null;
  };
};

const isKnownPaymentMethod = (value: string | null | undefined): value is string =>
  Boolean(value && value !== 'unknown');

/**
 * Resolves the mutable part of a paid-order transition.
 *
 * Payment callbacks and the manual bank-transfer action can be retried. The
 * first transaction that obtains the order lock owns the receipt attribution;
 * later retries may repair projections/emails but must not rewrite that audit
 * evidence. Refunded/partially-refunded/cancelled orders are terminal and must
 * never be revived by a delayed webhook or a repeated admin action.
 */
export const resolvePaidOrderFulfillmentPolicy = (
  order: PaidOrderFulfillmentSnapshot,
  request: PaidOrderFulfillmentRequest,
): PaidOrderFulfillmentPolicy => {
  const paymentStatus = String(order.paymentStatus || '').trim().toLowerCase();
  const orderStatus = String(order.status || '').trim().toLowerCase();
  const firstSettlement = !['paid', 'partial', 'refunded'].includes(paymentStatus);
  const terminal = orderStatus === 'cancelled' || paymentStatus === 'partial' || paymentStatus === 'refunded';
  const existingPaymentMethod = isKnownPaymentMethod(order.paymentMethod)
    ? order.paymentMethod
    : null;
  const paymentMethod = firstSettlement
    ? request.paymentMethod || existingPaymentMethod || request.fallbackPaymentMethod
    : existingPaymentMethod || request.paymentMethod || request.fallbackPaymentMethod;
  const actorId = firstSettlement
    ? request.actorId ?? order.createdByUserId ?? request.systemUserId
    : order.paymentReceivedByUserId ?? order.createdByUserId ?? request.systemUserId;

  const hasReceiptMetadata = Boolean(
    request.receivedPaymentReference || request.clientRequestId,
  );
  const metadata = firstSettlement && hasReceiptMetadata
    ? {
        ...(order.metadata || {}),
        ...(request.receivedPaymentReference
          ? { receivedPaymentReference: request.receivedPaymentReference }
          : {}),
        ...(request.clientRequestId
          ? { paymentReceiptRequestId: request.clientRequestId }
          : {}),
      }
    : order.metadata;

  return {
    shouldProcess: !terminal,
    firstSettlement,
    actorId,
    paymentMethod,
    ...(firstSettlement ? { stripePaymentIntentId: request.stripePaymentIntentId } : {}),
    metadata,
    receiptUpdates: firstSettlement
      ? {
          ...(request.paymentReceivedByUserId !== undefined
            ? { paymentReceivedByUserId: request.paymentReceivedByUserId }
            : {}),
          ...(request.paymentNote !== undefined ? { paymentNote: request.paymentNote } : {}),
        }
      : {},
  };
};
