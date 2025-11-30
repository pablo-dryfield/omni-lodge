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
