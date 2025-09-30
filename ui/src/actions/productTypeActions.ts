import { createAsyncThunk } from '@reduxjs/toolkit';
import axiosInstance from './../utils/axiosInstance';
import { ServerResponse } from '../types/general/ServerResponse';
import { ProductType } from '../types/productTypes/ProductType';

// Async thunk for fetching productTypes
export const fetchProductTypes = createAsyncThunk(
  'productTypes/fetchProductTypes',
  async (_, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get<ServerResponse<Partial<ProductType>>>('/productTypes', {
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

// Async thunk for creating a productType
export const createProductType = createAsyncThunk(
  'productTypes/createProductType',
  async (productTypeData: Partial<ProductType>, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.post<Partial<ProductType>>('/productTypes', productTypeData, {
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

// Async thunk for updating a productType
export const updateProductType = createAsyncThunk(
  'productTypes/updateProductType',
  async ({ productTypeId, productTypeData }: { productTypeId: number; productTypeData: Partial<ProductType>; }, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.put<Partial<ProductType>>(`/productTypes/${productTypeId}`, productTypeData, {
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

// Async thunk for deleting a productType
export const deleteProductType = createAsyncThunk(
  'productTypes/deleteProductType',
  async (productTypeId: number, { rejectWithValue }) => {
    try {
      await axiosInstance.delete(`/productTypes/${productTypeId}`, {
        withCredentials: true
      });
      return productTypeId;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('An unknown error occurred');
    }
  }
);