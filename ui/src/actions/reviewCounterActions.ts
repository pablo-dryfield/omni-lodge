import { createAsyncThunk } from '@reduxjs/toolkit';
import axiosInstance from '../utils/axiosInstance';
import { type ReviewCounter, type ReviewCounterPayload, type ReviewCounterEntryPayload } from '../types/reviewCounters/ReviewCounter';
import { type ServerResponse } from '../types/general/ServerResponse';

export const fetchReviewCounters = createAsyncThunk(
  'reviewCounters/fetchAll',
  async (_, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get<ServerResponse<ReviewCounter>>('/reviewCounters', { withCredentials: true });
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('Failed to load review counters');
    }
  },
);

export const createReviewCounter = createAsyncThunk(
  'reviewCounters/create',
  async (payload: ReviewCounterPayload, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.post('/reviewCounters', payload, { withCredentials: true });
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('Failed to create review counter');
    }
  },
);

export const updateReviewCounter = createAsyncThunk(
  'reviewCounters/update',
  async (
    { counterId, payload }: { counterId: number; payload: Partial<ReviewCounterPayload> },
    { rejectWithValue },
  ) => {
    try {
      const response = await axiosInstance.put(`/reviewCounters/${counterId}`, payload, { withCredentials: true });
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('Failed to update review counter');
    }
  },
);

export const deleteReviewCounter = createAsyncThunk(
  'reviewCounters/delete',
  async (counterId: number, { rejectWithValue }) => {
    try {
      await axiosInstance.delete(`/reviewCounters/${counterId}`, { withCredentials: true });
      return counterId;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('Failed to delete review counter');
    }
  },
);

export const createReviewCounterEntry = createAsyncThunk(
  'reviewCounters/createEntry',
  async (
    { counterId, payload }: { counterId: number; payload: ReviewCounterEntryPayload },
    { rejectWithValue },
  ) => {
    try {
      const response = await axiosInstance.post(`/reviewCounters/${counterId}/entries`, payload, { withCredentials: true });
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('Failed to create review counter entry');
    }
  },
);

export const updateReviewCounterEntry = createAsyncThunk(
  'reviewCounters/updateEntry',
  async (
    { counterId, entryId, payload }: { counterId: number; entryId: number; payload: ReviewCounterEntryPayload },
    { rejectWithValue },
  ) => {
    try {
      const response = await axiosInstance.put(`/reviewCounters/${counterId}/entries/${entryId}`, payload, { withCredentials: true });
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('Failed to update review counter entry');
    }
  },
);

export const deleteReviewCounterEntry = createAsyncThunk(
  'reviewCounters/deleteEntry',
  async (
    { counterId, entryId }: { counterId: number; entryId: number },
    { rejectWithValue },
  ) => {
    try {
      await axiosInstance.delete(`/reviewCounters/${counterId}/entries/${entryId}`, { withCredentials: true });
      return entryId;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('Failed to delete review counter entry');
    }
  },
);
