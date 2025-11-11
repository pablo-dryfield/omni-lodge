import { createAsyncThunk } from '@reduxjs/toolkit';
import axiosInstance from '../utils/axiosInstance';
import type { ReviewPlatform } from '../types/reviewPlatforms/ReviewPlatform';
import type { ServerResponse } from '../types/general/ServerResponse';

export const fetchReviewPlatforms = createAsyncThunk(
  'reviewPlatforms/fetchAll',
  async (_, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get<ServerResponse<ReviewPlatform>>('/reviewPlatforms', {
        withCredentials: true,
      });
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('Failed to load review platforms');
    }
  },
);

export const createReviewPlatform = createAsyncThunk(
  'reviewPlatforms/create',
  async (payload: Partial<ReviewPlatform>, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.post('/reviewPlatforms', payload, { withCredentials: true });
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('Failed to create review platform');
    }
  },
);

export const updateReviewPlatform = createAsyncThunk(
  'reviewPlatforms/update',
  async (
    { platformId, payload }: { platformId: number; payload: Partial<ReviewPlatform> },
    { rejectWithValue },
  ) => {
    try {
      const response = await axiosInstance.put(`/reviewPlatforms/${platformId}`, payload, { withCredentials: true });
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('Failed to update review platform');
    }
  },
);

export const deleteReviewPlatform = createAsyncThunk(
  'reviewPlatforms/delete',
  async (platformId: number, { rejectWithValue }) => {
    try {
      await axiosInstance.delete(`/reviewPlatforms/${platformId}`, { withCredentials: true });
      return platformId;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('Failed to delete review platform');
    }
  },
);
