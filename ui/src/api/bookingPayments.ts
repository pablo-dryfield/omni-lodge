import axiosInstance from '../utils/axiosInstance';

export type PaymentMethodDetails = {
  type: string; brand: string | null; last4: string | null; expiryMonth: number | null; expiryYear: number | null;
  country: string | null; funding: string | null; wallet: string | null;
  threeDSecure: { result: string | null; version: string | null; flow: string | null } | null;
};
export type PaymentRequestReference = {
  id: string; created: number; source: 'refresh' | 'event'; description: string;
  method: string | null; path: string | null; status: number | null; dashboardUrl: string;
};
export type PaymentHistoryEvent = {
  id: string; type: string; created: number; objectId: string | null; status: string | null;
  amount: number | null; currency: string | null; requestId: string | null; dashboardUrl: string;
};
export type PaymentActivity = {
  id: string; source: 'stripe' | 'omnilodge'; title: string; created: number; status: string | null;
  amount: number | null; currency: string | null; actor: string | null; reference: string | null;
};
export type PaymentItem = { id: string; created: number; status: string | null; amount: number; currency: string; reason: string | null; description: string | null; dashboardUrl: string };
export type BookingPaymentDetails = {
  bookingId: number; state: 'available' | 'not_stripe' | 'not_linked' | 'unavailable'; message: string | null;
  recorded: { amount: string | null; currency: string | null; paymentStatus: string | null; paymentMethod: string | null; refundedAmount: string | null; refundedCurrency?: string | null };
  scope: 'order' | 'booking'; orderReference: string | null; merchant: string | null;
  payment: {
    id: string; paymentIntentId: string | null; chargeId: string | null; mode: 'live' | 'test'; accountId: string | null;
    amount: number; amountReceived: number; amountCapturable: number; amountRefunded: number; currency: string;
    status: string; created: number; canceledAt: number | null; receiptEmail: string | null; billingName: string | null;
    receiptUrl: string | null; description: string | null; statementDescriptor: string | null;
    paymentMethod: PaymentMethodDetails | null; dashboardUrl: string;
    settlement: { amount: number; fee: number; net: number; currency: string } | null;
  } | null;
  charges: PaymentItem[]; refunds: PaymentItem[]; disputes: PaymentItem[];
  truncated: Array<'charges' | 'refunds' | 'disputes' | 'activity'>;
  activity: PaymentActivity[]; requests: PaymentRequestReference[]; warnings: string[]; checkedAt: string;
};
export type BookingPaymentEvents = {
  paymentId: string; mode: 'live' | 'test';
  events: PaymentHistoryEvent[]; requests: PaymentRequestReference[]; hasMore: boolean; nextCursor: string | null;
  scanned: number; from: number; to: number; checkedAt: string;
};
export const getBookingPaymentDetails = async (bookingId: number, signal?: AbortSignal) =>
  (await axiosInstance.get<BookingPaymentDetails>(`/bookings/${bookingId}/payments`, { signal })).data;
export const getBookingPaymentEvents = async (bookingId: number, cursor?: string, signal?: AbortSignal) =>
  (await axiosInstance.get<BookingPaymentEvents>(`/bookings/${bookingId}/payments/events`, { params: cursor ? { cursor } : undefined, signal })).data;
