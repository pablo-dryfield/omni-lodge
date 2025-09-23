import { createAsyncThunk } from '@reduxjs/toolkit';
import axiosInstance from './../utils/axiosInstance';
import { type Pay } from '../types/pays/Pay';
import { type ServerResponse } from '../types/general/ServerResponse';

export const fetchPays = createAsyncThunk(
  'pay/pay',
  async (
    { startDate, endDate }: { startDate: string; endDate: string },
    { rejectWithValue },
  ) => {
    try {
      const response = await axiosInstance.get<ServerResponse<Pay>>(
        `/api/reports/getCommissionByDateRange?startDate=${startDate}&endDate=${endDate}`,
        {
          withCredentials: true,
        },
      );
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('An unknown error occurred');
    }
  },
);
