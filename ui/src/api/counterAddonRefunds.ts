import axiosInstance from '../utils/axiosInstance';
import type { OrderExtras, UnifiedOrder } from '../store/bookingPlatformsTypes';

export type CounterAddonRefundVerification = {
  status: 'clear' | 'verified' | 'pending' | 'insufficient' | 'full_refund' | 'manual_review';
  selectionKey: string;
  amount: number;
  currency: string;
  bookingAmount: number;
  refundedAmount: number;
  availableRefundAmount: number;
  message: string;
  refunds: Array<{ id: string; amount: number; status: string | null; created: number }>;
  addons: Array<{ id: number; platformAddonName: string; quantity: number; refundQty: number; unitPrice: string; currency: string }>;
};
export type CounterAddonRefundResult = {
  bookingId: number;
  applied: boolean;
  verification: CounterAddonRefundVerification;
  metricsUpdated: boolean;
  order: UnifiedOrder | null;
};

export const counterAddonRefund = async (
  bookingId: number,
  operation: 'verify' | 'refund' | 'rectify',
  extras: Partial<OrderExtras>,
  selectionKey?: string,
  expectedExtras?: Partial<OrderExtras>,
): Promise<CounterAddonRefundResult> => {
  const response = await axiosInstance.post<CounterAddonRefundResult>(
    `/bookings/${bookingId}/counter-addon-refunds/${operation}`,
    { extras, expectedExtras, ...(selectionKey ? { selectionKey } : {}) },
    { withCredentials: true },
  );
  return response.data;
};
