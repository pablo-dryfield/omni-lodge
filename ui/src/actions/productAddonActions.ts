import { createAsyncThunk } from "@reduxjs/toolkit";
import axiosInstance from "../utils/axiosInstance";
import { ServerResponse } from "../types/general/ServerResponse";
import { ProductAddon } from "../types/productAddons/ProductAddon";

const unwrapSingle = <T>(payload: T | T[]): T => (Array.isArray(payload) ? payload[0] : payload);

export const fetchProductAddons = createAsyncThunk(
  "productAddons/fetchProductAddons",
  async (_, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get<ServerResponse<Partial<ProductAddon>>>("/productAddons", {
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

export const createProductAddon = createAsyncThunk(
  "productAddons/createProductAddon",
  async (payload: Partial<ProductAddon>, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.post<Partial<ProductAddon> | Partial<ProductAddon>[]>("/productAddons", payload, {
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

export const updateProductAddon = createAsyncThunk(
  "productAddons/updateProductAddon",
  async (
    { productAddonId, payload }: { productAddonId: number; payload: Partial<ProductAddon> },
    { rejectWithValue },
  ) => {
    try {
      const response = await axiosInstance.put<Partial<ProductAddon> | Partial<ProductAddon>[]>(`/productAddons/${productAddonId}`, payload, {
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

export const deleteProductAddon = createAsyncThunk(
  "productAddons/deleteProductAddon",
  async (productAddonId: number, { rejectWithValue }) => {
    try {
      await axiosInstance.delete(`/productAddons/${productAddonId}`, {
        withCredentials: true,
      });
      return productAddonId;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue("An unknown error occurred");
    }
  },
);
