import { createAsyncThunk } from "@reduxjs/toolkit";
import axiosInstance from "../utils/axiosInstance";
import { ServerResponse } from "../types/general/ServerResponse";
import { ProductPrice } from "../types/products/ProductPrice";

const unwrapSingle = <T>(payload: T | T[]): T => (Array.isArray(payload) ? payload[0] : payload);

export const fetchProductPrices = createAsyncThunk(
  "productPrices/fetchProductPrices",
  async (params: { productId?: number } | undefined, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get<ServerResponse<Partial<ProductPrice>>>("/productPrices", {
        params,
        withCredentials: true,
      });
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue("An unknown error occurred");
    }
  },
);

export const createProductPrice = createAsyncThunk(
  "productPrices/createProductPrice",
  async (payload: Partial<ProductPrice>, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.post<Partial<ProductPrice> | Partial<ProductPrice>[]>("/productPrices", payload, {
        withCredentials: true,
      });
      return unwrapSingle(response.data);
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue("An unknown error occurred");
    }
  },
);

export const updateProductPrice = createAsyncThunk(
  "productPrices/updateProductPrice",
  async (
    { productPriceId, payload }: { productPriceId: number; payload: Partial<ProductPrice> },
    { rejectWithValue },
  ) => {
    try {
      const response = await axiosInstance.put<Partial<ProductPrice> | Partial<ProductPrice>[]>(`/productPrices/${productPriceId}`, payload, {
        withCredentials: true,
      });
      return unwrapSingle(response.data);
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue("An unknown error occurred");
    }
  },
);

export const deleteProductPrice = createAsyncThunk(
  "productPrices/deleteProductPrice",
  async (productPriceId: number, { rejectWithValue }) => {
    try {
      await axiosInstance.delete(`/productPrices/${productPriceId}`, {
        withCredentials: true,
      });
      return productPriceId;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue("An unknown error occurred");
    }
  },
);
