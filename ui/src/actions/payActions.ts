import { createAsyncThunk } from '@reduxjs/toolkit';
import axios from 'axios';
import axiosInstance from './../utils/axiosInstance';
import { type Pay } from '../types/pays/Pay';
import { type ServerResponse } from '../types/general/ServerResponse';
import type { CompensationComponent } from '../types/compensation/CompensationComponent';
import type { FinanceAccount, FinanceCategory, FinanceVendor } from '../types/finance';

export type StaffPayoutFinanceAccount = Pick<
  FinanceAccount,
  'id' | 'name' | 'type' | 'currency' | 'isActive'
>;
export type StaffPayoutFinanceCategory = Pick<
  FinanceCategory,
  'id' | 'name' | 'kind' | 'parentId' | 'isActive'
>;
export type StaffPayoutFinanceVendor = Pick<
  FinanceVendor,
  'id' | 'name' | 'defaultCategoryId' | 'isActive'
>;

export type StaffPayoutBootstrapResponse = {
  pays: ServerResponse<Pay>;
  scope: 'all' | 'self';
  canManagePayouts: boolean;
  finance: {
    accounts: StaffPayoutFinanceAccount[];
    categories: StaffPayoutFinanceCategory[];
    vendors: StaffPayoutFinanceVendor[];
  } | null;
  compensationComponents: CompensationComponent[] | null;
};

type FetchPaysParams = {
  startDate: string;
  endDate: string;
  scope?: 'self' | 'all';
};

const bootstrapRequests = new Map<string, Promise<StaffPayoutBootstrapResponse>>();

const extractBootstrapData = (payload: unknown): StaffPayoutBootstrapResponse => {
  if (Array.isArray(payload)) {
    const first = payload[0] as { data?: unknown } | undefined;
    if (first?.data && typeof first.data === 'object') {
      return first.data as StaffPayoutBootstrapResponse;
    }
  }
  throw new Error('Staff payments bootstrap returned no data');
};

const requestPaysBootstrap = (params: FetchPaysParams): Promise<StaffPayoutBootstrapResponse> => {
  const key = `${params.startDate}|${params.endDate}|${params.scope ?? 'all'}`;
  const inFlightRequest = bootstrapRequests.get(key);
  if (inFlightRequest) {
    return inFlightRequest;
  }

  const searchParams = new URLSearchParams({
    startDate: params.startDate,
    endDate: params.endDate,
  });
  const request = axiosInstance
    .get(`/reports/staffPayouts/bootstrap?${searchParams.toString()}`, {
      withCredentials: true,
    })
    .then((response) => extractBootstrapData(response.data));
  const trackedRequest = request.finally(() => {
    if (bootstrapRequests.get(key) === trackedRequest) {
      bootstrapRequests.delete(key);
    }
  });
  bootstrapRequests.set(key, trackedRequest);
  return trackedRequest;
};

export const fetchPays = createAsyncThunk<
  StaffPayoutBootstrapResponse,
  FetchPaysParams,
  { rejectValue: string }
>(
  'pay/pay',
  async (
    params,
    { rejectWithValue },
  ) => {
    try {
      const bootstrap = await requestPaysBootstrap(params);
      return bootstrap;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const responseData = error.response?.data as
          | Array<{ message?: string }>
          | { message?: string }
          | string
          | undefined;
        let serverMessage: string | undefined;
        if (Array.isArray(responseData)) {
          serverMessage = responseData[0]?.message;
        } else if (responseData && typeof responseData === 'object') {
          serverMessage = responseData.message;
        } else if (typeof responseData === 'string') {
          serverMessage = responseData;
        }
        return rejectWithValue(serverMessage ?? error.message ?? 'Request failed');
      }
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('An unknown error occurred');
    }
  },
);
