import { createAsyncThunk } from '@reduxjs/toolkit';
import axiosInstance from '../utils/axiosInstance';
import type { ServerResponse } from '../types/general/ServerResponse';
import type { ProductAlias } from '../types/products/ProductAlias';

export const fetchProductAliases = createAsyncThunk(
  'productAliases/fetchProductAliases',
  async (_, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get<ServerResponse<Partial<ProductAlias>>>('/product-aliases', {
        withCredentials: true,
      });
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('An unknown error occurred');
    }
  },
);

export const createProductAlias = createAsyncThunk(
  'productAliases/createProductAlias',
  async (payload: Partial<ProductAlias>, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.post<Partial<ProductAlias>>('/product-aliases', payload, {
        withCredentials: true,
      });
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('An unknown error occurred');
    }
  },
);

export const updateProductAlias = createAsyncThunk(
  'productAliases/updateProductAlias',
  async ({ aliasId, payload }: { aliasId: number; payload: Partial<ProductAlias> }, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.put<Partial<ProductAlias>>(`/product-aliases/${aliasId}`, payload, {
        withCredentials: true,
      });
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('An unknown error occurred');
    }
  },
);

export const deleteProductAlias = createAsyncThunk(
  'productAliases/deleteProductAlias',
  async (aliasId: number, { rejectWithValue }) => {
    try {
      await axiosInstance.delete(`/product-aliases/${aliasId}`, {
        withCredentials: true,
      });
      return aliasId;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('An unknown error occurred');
    }
  },
);
