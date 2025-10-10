import { createAsyncThunk } from "@reduxjs/toolkit";
import axiosInstance from "../utils/axiosInstance";
import { ServerResponse } from "../types/general/ServerResponse";
import { Addon } from "../types/addons/Addon";

const unwrapSingle = <T>(payload: T | T[]): T => (Array.isArray(payload) ? payload[0] : payload);

export const fetchAddons = createAsyncThunk(
  "addons/fetchAddons",
  async (_, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get<ServerResponse<Partial<Addon>>>("/addons", {
        params: { format: "table" },
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

export const createAddon = createAsyncThunk(
  "addons/createAddon",
  async (addonData: Partial<Addon>, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.post<Partial<Addon> | Partial<Addon>[]>("/addons", addonData, {
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

export const updateAddon = createAsyncThunk(
  "addons/updateAddon",
  async (
    { addonId, addonData }: { addonId: number; addonData: Partial<Addon> },
    { rejectWithValue },
  ) => {
    try {
      const response = await axiosInstance.put<Partial<Addon> | Partial<Addon>[]>(`/addons/${addonId}`, addonData, {
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

export const deleteAddon = createAsyncThunk(
  "addons/deleteAddon",
  async (addonId: number, { rejectWithValue }) => {
    try {
      await axiosInstance.delete(`/addons/${addonId}`, {
        withCredentials: true,
      });
      return addonId;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue("An unknown error occurred");
    }
  },
);
