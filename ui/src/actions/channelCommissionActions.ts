import { createAsyncThunk } from "@reduxjs/toolkit";
import axiosInstance from "../utils/axiosInstance";
import { ServerResponse } from "../types/general/ServerResponse";
import { ChannelCommission } from "../types/channels/ChannelCommission";

const unwrapSingle = <T>(payload: T | T[]): T => (Array.isArray(payload) ? payload[0] : payload);

export const fetchChannelCommissions = createAsyncThunk(
  "channelCommissions/fetchChannelCommissions",
  async (params: { channelId?: number } | undefined, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get<ServerResponse<Partial<ChannelCommission>>>(
        "/channelCommissions",
        {
          params,
          withCredentials: true,
        },
      );
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue("An unknown error occurred");
    }
  },
);

export const createChannelCommission = createAsyncThunk(
  "channelCommissions/createChannelCommission",
  async (payload: Partial<ChannelCommission>, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.post<Partial<ChannelCommission> | Partial<ChannelCommission>[]>(
        "/channelCommissions",
        payload,
        {
          withCredentials: true,
        },
      );
      return unwrapSingle(response.data);
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue("An unknown error occurred");
    }
  },
);

export const updateChannelCommission = createAsyncThunk(
  "channelCommissions/updateChannelCommission",
  async (
    { commissionId, payload }: { commissionId: number; payload: Partial<ChannelCommission> },
    { rejectWithValue },
  ) => {
    try {
      const response = await axiosInstance.put<Partial<ChannelCommission> | Partial<ChannelCommission>[]>(
        `/channelCommissions/${commissionId}`,
        payload,
        {
          withCredentials: true,
        },
      );
      return unwrapSingle(response.data);
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue("An unknown error occurred");
    }
  },
);

export const deleteChannelCommission = createAsyncThunk(
  "channelCommissions/deleteChannelCommission",
  async (commissionId: number, { rejectWithValue }) => {
    try {
      await axiosInstance.delete(`/channelCommissions/${commissionId}`, {
        withCredentials: true,
      });
      return commissionId;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue("An unknown error occurred");
    }
  },
);
