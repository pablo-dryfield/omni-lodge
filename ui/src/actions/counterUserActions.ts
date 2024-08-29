import { createAsyncThunk } from '@reduxjs/toolkit';
import axiosInstance from './../utils/axiosInstance';
import { ServerResponse } from '../types/general/ServerResponse';
import { CounterUser } from '../types/counterUsers/CounterUser';

/**
 * Fetches a list of counterUsers from the server.
 * @returns A promise that resolves to the list of counterUsers or an error message string.
 * @throws Will throw an error if the server response is not as expected or if there is a network issue.
 */
export const fetchCounterUsers = createAsyncThunk(
  'counterUsers/fetchCounterUsers',
  async (_, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get<ServerResponse<Partial<CounterUser>>>('/api/counterUsers', {
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
 * Creates a new counterUser with the provided data.
 * @param counterUserData - The data for the new counterUser to be created.
 * @returns A promise that resolves to the created counterUser's data or an error message string.
 * @throws Will throw an error if the server response is not as expected or if there is a network issue.
 */
export const createCounterUser = createAsyncThunk(
  'counterUsers/createCounterUser',
  async (counterUserData: Partial<CounterUser>, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.post<Partial<CounterUser>>('/api/counterUsers', counterUserData, {
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

export const createBulkCounterUser = createAsyncThunk(
  'counterUsers/createBulkCounterUser',
  async (counterUserData: Partial<CounterUser>[], { rejectWithValue }) => {
    try {
      const response = await axiosInstance.post<Partial<CounterUser>>('/api/counterUsers/bulkCounterUsers', {data: counterUserData}, {
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
 * Updates a counterUser with the given ID using the provided data.
 * @param counterUserId - The ID of the counterUser to update.
 * @param counterUserData - The new data for updating the counterUser.
 * @returns A promise that resolves to the updated counterUser's data or an error message string.
 * @throws Will throw an error if the server response is not as expected or if there is a network issue.
 */
export const updateCounterUser = createAsyncThunk(
  'counterUsers/updateCounterUser',
  async ({ counterUserId, counterUserData }: { counterUserId: number; counterUserData: Partial<CounterUser>; }, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.put<Partial<CounterUser>>(`/api/counterUsers/${counterUserId}`, counterUserData, {
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
 * Deletes a counterUser with the specified ID.
 * @param counterUserId - The ID of the counterUser to be deleted.
 * @returns A promise that resolves to the ID of the deleted counterUser or an error message string.
 * @throws Will throw an error if the server response is not as expected or if there is a network issue.
 */
export const deleteCounterUser = createAsyncThunk(
  'counterUsers/deleteCounterUser',
  async (counterUserId: number, { rejectWithValue }) => {
    try {
      await axiosInstance.delete(`/api/counterUsers/${counterUserId}`, {
        withCredentials: true
      });
      return counterUserId;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('An unknown error occurred');
    }
  }
);