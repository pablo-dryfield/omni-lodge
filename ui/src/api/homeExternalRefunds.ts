import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import axiosInstance from '../utils/axiosInstance';

export type ExternalRefundAction = {
  id: string; addonKey: 'cocktails' | 'tshirts' | 'photos'; quantity: number;
  counterId: number | null; reason: string | null;
};
export type PendingExternalRefundBooking = {
  bookingId: number; customerName: string; platform: string; platformBookingId: string;
  productName: string | null; experienceDate: string | null; actions: ExternalRefundAction[];
};
export type HomeExternalRefundsResponse = {
  data: PendingExternalRefundBooking[];
  meta: { totalBookings: number; limit: number; offset: number };
};
export const HOME_EXTERNAL_REFUNDS_QUERY_KEY = ['bookings', 'pending-external-refunds'] as const;
export const useHomeExternalRefunds = (enabled: boolean, offset: number, limit: number) =>
  useQuery<HomeExternalRefundsResponse, AxiosError>({
    queryKey: [...HOME_EXTERNAL_REFUNDS_QUERY_KEY, offset, limit],
    queryFn: async () => (await axiosInstance.get<HomeExternalRefundsResponse>('/bookings/pending-external-refunds',
      { params: { limit, offset } })).data,
    enabled, staleTime: 30_000, refetchOnMount: 'always', refetchOnWindowFocus: true,
    retry: (count, error) => ![401, 403].includes(error.response?.status ?? 0) && count < 1,
  });
export const useExternalRefundAction = () => {
  const client = useQueryClient();
  return useMutation<unknown, AxiosError, { bookingId: number; actionId: string; operation: 'complete' | 'delete' }>({
    mutationFn: async ({ bookingId, actionId, operation }) => {
      const path = `/bookings/${bookingId}/addon-refund-actions/${encodeURIComponent(actionId)}`;
      // Exactly the endpoints used by Counter Summary. Completion updates the
      // booking snapshot and rebuilds the linked counter, including venue metrics.
      return operation === 'complete'
        ? (await axiosInstance.patch(path, { status: 'completed' })).data
        : (await axiosInstance.delete(path)).data;
    },
    onSettled: () => client.invalidateQueries({ queryKey: HOME_EXTERNAL_REFUNDS_QUERY_KEY }),
  });
};
export const externalRefundError = (error: unknown): string => {
  const payload = (error as AxiosError<{ message?: string }>)?.response?.data;
  return payload?.message || (error instanceof Error ? error.message : 'Please try again.');
};
