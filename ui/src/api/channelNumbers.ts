import axiosInstance from '../utils/axiosInstance';
import { ChannelNumbersSummary } from '../types/channelNumbers/ChannelNumbersSummary';

export const fetchChannelNumbersSummary = async (params: {
  startDate: string;
  endDate: string;
}): Promise<ChannelNumbersSummary> => {
  const response = await axiosInstance.get<ChannelNumbersSummary>('/channelNumbers/summary', {
    params,
  });
  return response.data;
};

export const recordChannelCashCollection = async (payload: {
  channelId: number;
  currency: string;
  amount: number;
  rangeStart: string;
  rangeEnd: string;
  financeTransactionId?: number | null;
  note?: string | null;
}): Promise<void> => {
  await axiosInstance.post('/channelNumbers/cash-collections', payload, { withCredentials: true });
};
