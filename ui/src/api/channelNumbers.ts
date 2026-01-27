import axiosInstance from '../utils/axiosInstance';
import {
  ChannelNumbersSummary,
  type ChannelNumbersDetailMetric,
  type ChannelNumbersDetailResponse,
} from '../types/channelNumbers/ChannelNumbersSummary';
import type { FinanceAccount } from '../types/finance/Account';
import type { FinanceCategory } from '../types/finance/Category';
import type { FinanceClient } from '../types/finance/Client';
import type { FinanceVendor } from '../types/finance/Vendor';

export const fetchChannelNumbersSummary = async (params: {
  startDate: string;
  endDate: string;
}): Promise<ChannelNumbersSummary> => {
  const response = await axiosInstance.get<ChannelNumbersSummary>('/channelNumbers/summary', {
    params,
  });
  return response.data;
};

export const fetchChannelNumbersBootstrap = async (params: {
  startDate: string;
  endDate: string;
}): Promise<{
  summary: ChannelNumbersSummary;
  finance: {
    accounts: FinanceAccount[];
    categories: FinanceCategory[];
    vendors: FinanceVendor[];
    clients: FinanceClient[];
  };
}> => {
  const response = await axiosInstance.get<{
    summary: ChannelNumbersSummary;
    finance: {
      accounts: FinanceAccount[];
      categories: FinanceCategory[];
      vendors: FinanceVendor[];
      clients: FinanceClient[];
    };
  }>('/channelNumbers/bootstrap', {
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

export const fetchChannelNumbersDetails = async (params: {
  startDate: string;
  endDate: string;
  metric: ChannelNumbersDetailMetric;
  channelId?: number;
  productId?: number | null;
  addonKey?: string;
}): Promise<ChannelNumbersDetailResponse> => {
  const query: Record<string, string | number> = {
    startDate: params.startDate,
    endDate: params.endDate,
    metric: params.metric,
  };
  if (typeof params.channelId === 'number') {
    query.channelId = params.channelId;
  }
  if (params.productId !== undefined) {
    query.productId = params.productId === null ? 'null' : params.productId;
  }
  if (params.addonKey) {
    query.addonKey = params.addonKey;
  }

  const response = await axiosInstance.get<ChannelNumbersDetailResponse>('/channelNumbers/details', {
    params: query,
  });
  return response.data;
};
