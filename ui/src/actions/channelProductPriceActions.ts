import { createAsyncThunk } from "@reduxjs/toolkit";
import axiosInstance from "../utils/axiosInstance";
import { ServerResponse } from "../types/general/ServerResponse";
import { ChannelProductPrice } from "../types/channels/ChannelProductPrice";

const unwrapSingle = <T>(payload: T | T[]): T => (Array.isArray(payload) ? payload[0] : payload);

export const fetchChannelProductPrices = createAsyncThunk(
  "channelProductPrices/fetchChannelProductPrices",
  async (params: { channelId?: number; productId?: number } | undefined, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get<ServerResponse<Partial<ChannelProductPrice>>>("/channelProductPrices", {
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

export const createChannelProductPrice = createAsyncThunk(
  "channelProductPrices/createChannelProductPrice",
  async (payload: Partial<ChannelProductPrice>, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.post<
        Partial<ChannelProductPrice> | Partial<ChannelProductPrice>[]
      >("/channelProductPrices", payload, {
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

export const updateChannelProductPrice = createAsyncThunk(
  "channelProductPrices/updateChannelProductPrice",
  async (
    { recordId, payload }: { recordId: number; payload: Partial<ChannelProductPrice> },
    { rejectWithValue },
  ) => {
    try {
      const response = await axiosInstance.put<
        Partial<ChannelProductPrice> | Partial<ChannelProductPrice>[]
      >(`/channelProductPrices/${recordId}`, payload, {
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

export const deleteChannelProductPrice = createAsyncThunk(
  "channelProductPrices/deleteChannelProductPrice",
  async (recordId: number, { rejectWithValue }) => {
    try {
      await axiosInstance.delete(`/channelProductPrices/${recordId}`, {
        withCredentials: true,
      });
      return recordId;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue("An unknown error occurred");
    }
  },
);
