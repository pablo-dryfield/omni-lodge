import { createAsyncThunk } from '@reduxjs/toolkit';
import axios from 'axios';
import axiosInstance from './../utils/axiosInstance';
import { type Pay } from '../types/pays/Pay';
import { type ServerResponse } from '../types/general/ServerResponse';

export const fetchPays = createAsyncThunk(
  'pay/pay',
  async (
    { startDate, endDate, scope }: { startDate: string; endDate: string; scope?: 'self' | 'all' },
    { rejectWithValue },
  ) => {
    try {
      const scopeQuery = scope ? `&scope=${scope}` : '';
      const response = await axiosInstance.get<ServerResponse<Pay>>(
        `/reports/getCommissionByDateRange?startDate=${startDate}&endDate=${endDate}${scopeQuery}`,
        {
          withCredentials: true,
        },
      );
      return response.data;
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
