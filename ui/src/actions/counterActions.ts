import { createAsyncThunk } from '@reduxjs/toolkit';
import axiosInstance from './../utils/axiosInstance';
import { ServerResponse } from '../types/general/ServerResponse';
import { Counter } from '../types/counters/Counter';

/**
 * Fetches a list of counters from the server.
 * @returns A promise that resolves to the list of counters or an error message string.
 * @throws Will throw an error if the server response is not as expected or if there is a network issue.
 */
export const fetchCounters = createAsyncThunk(
  'counters/fetchCounters',
  async (_, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get<ServerResponse<Partial<Counter>>>('/api/counters', {
        withCredentials: true
      });
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('An unknown error occurred');
    }
  }
);

/**
 * Creates a new counter with the provided data.
 * @param counterData - The data for the new counter to be created.
 * @returns A promise that resolves to the created counter's data or an error message string.
 * @throws Will throw an error if the server response is not as expected or if there is a network issue.
 */
export const createCounter = createAsyncThunk(
  'counters/createCounter',
  async (counterData: Partial<Counter>, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.post<Partial<Counter>>('/api/counters', counterData, {
        withCredentials: true
      });
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('An unknown error occurred');
    }
  }
);

/**
 * Updates a counter with the given ID using the provided data.
 * @param counterId - The ID of the counter to update.
 * @param counterData - The new data for updating the counter.
 * @returns A promise that resolves to the updated counter's data or an error message string.
 * @throws Will throw an error if the server response is not as expected or if there is a network issue.
 */
export const updateCounter = createAsyncThunk(
  'counters/updateCounter',
  async ({ counterId, counterData }: { counterId: number; counterData: Partial<Counter>; }, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.put<Partial<Counter>>(`/api/counters/${counterId}`, counterData, {
        withCredentials: true
      });
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('An unknown error occurred');
    }
  }
);

/**
 * Deletes a counter with the specified ID.
 * @param counterId - The ID of the counter to be deleted.
 * @returns A promise that resolves to the ID of the deleted counter or an error message string.
 * @throws Will throw an error if the server response is not as expected or if there is a network issue.
 */
export const deleteCounter = createAsyncThunk(
  'counters/deleteCounter',
  async (counterId: number, { rejectWithValue }) => {
    try {
      await axiosInstance.delete(`/api/counters/${counterId}`, {
        withCredentials: true
      });
      return counterId;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('An unknown error occurred');
    }
  }
);