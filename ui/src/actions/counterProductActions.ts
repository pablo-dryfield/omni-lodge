import { createAsyncThunk } from '@reduxjs/toolkit';
import axiosInstance from './../utils/axiosInstance';
import { ServerResponse } from '../types/general/ServerResponse';
import { CounterProduct } from '../types/counterProducts/CounterProduct';

/**
 * Fetches a list of counterProducts from the server.
 * @returns A promise that resolves to the list of counterProducts or an error message string.
 * @throws Will throw an error if the server response is not as expected or if there is a network issue.
 */
export const fetchCounterProducts = createAsyncThunk(
  'counterProducts/fetchCounterProducts',
  async (_, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get<ServerResponse<Partial<CounterProduct>>>('/counterProducts', {
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
 * Creates a new counterProduct with the provided data.
 * @param counterProductData - The data for the new counterProduct to be created.
 * @returns A promise that resolves to the created counterProduct's data or an error message string.
 * @throws Will throw an error if the server response is not as expected or if there is a network issue.
 */
export const createCounterProduct = createAsyncThunk(
  'counterProducts/createCounterProduct',
  async (counterProductData: Partial<CounterProduct>, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.post<Partial<CounterProduct>>('/counterProducts', counterProductData, {
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

export const createBulkCounterProduct = createAsyncThunk(
  'counterProducts/createBulkCounterProduct',
  async (counterProductData: Partial<CounterProduct>[], { rejectWithValue }) => {
    try {
      const response = await axiosInstance.post<Partial<CounterProduct>>('/counterProducts/bulkCounterProducts', {data: counterProductData}, {
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
 * Creates a new counterProduct with the provided data.
 * @param counterProductProductData - The data for the new counterProduct to be created.
 * @returns A promise that resolves to the created counterProduct's data or an error message string.
 * @throws Will throw an error if the server response is not as expected or if there is a network issue.
 */
export const createCounterProductProduct = createAsyncThunk(
  'counterProducts/createCounterProductProduct',
  async (counterProductProductData: Partial<CounterProduct>, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.post<Partial<CounterProduct>>('/counterProductProducts', counterProductProductData, {
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
 * Updates a counterProduct with the given ID using the provided data.
 * @param counterProductId - The ID of the counterProduct to update.
 * @param counterProductData - The new data for updating the counterProduct.
 * @returns A promise that resolves to the updated counterProduct's data or an error message string.
 * @throws Will throw an error if the server response is not as expected or if there is a network issue.
 */
export const updateCounterProduct = createAsyncThunk(
  'counterProducts/updateCounterProduct',
  async ({ counterProductId, counterProductData }: { counterProductId: number; counterProductData: Partial<CounterProduct>; }, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.put<Partial<CounterProduct>>(`/counterProducts/${counterProductId}`, counterProductData, {
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
 * Deletes a counterProduct with the specified ID.
 * @param counterProductId - The ID of the counterProduct to be deleted.
 * @returns A promise that resolves to the ID of the deleted counterProduct or an error message string.
 * @throws Will throw an error if the server response is not as expected or if there is a network issue.
 */
export const deleteCounterProduct = createAsyncThunk(
  'counterProducts/deleteCounterProduct',
  async (counterProductId: number, { rejectWithValue }) => {
    try {
      await axiosInstance.delete(`/counterProducts/${counterProductId}`, {
        withCredentials: true
      });
      return counterProductId;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('An unknown error occurred');
    }
  }
);