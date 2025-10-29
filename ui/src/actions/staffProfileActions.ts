import { createAsyncThunk } from "@reduxjs/toolkit";
import axios from "axios";
import axiosInstance from "../utils/axiosInstance";
import type { StaffProfile } from "../types/staffProfiles/StaffProfile";
import type { ServerResponse } from "../types/general/ServerResponse";

const extractErrorMessage = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string }[] | undefined;
    if (Array.isArray(data) && data[0]?.message) {
      return data[0].message;
    }
    return error.response?.statusText ?? error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "An unknown error occurred";
};

export const fetchStaffProfiles = createAsyncThunk(
  "staffProfiles/fetch",
  async (_, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get<ServerResponse<Partial<StaffProfile>>>("/staffProfiles", {
        withCredentials: true,
      });
      return response.data;
    } catch (error) {
      return rejectWithValue(extractErrorMessage(error));
    }
  },
);

export const createStaffProfile = createAsyncThunk(
  "staffProfiles/create",
  async (payload: Partial<StaffProfile>, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.post<Partial<StaffProfile>>("/staffProfiles", payload, {
        withCredentials: true,
      });
      return response.data;
    } catch (error) {
      return rejectWithValue(extractErrorMessage(error));
    }
  },
);

export const updateStaffProfile = createAsyncThunk(
  "staffProfiles/update",
  async (
    { userId, data }: { userId: number; data: Partial<StaffProfile> },
    { rejectWithValue },
  ) => {
    try {
      const response = await axiosInstance.patch<Partial<StaffProfile>>(`/staffProfiles/${userId}`, data, {
        withCredentials: true,
      });
      return response.data;
    } catch (error) {
      return rejectWithValue(extractErrorMessage(error));
    }
  },
);

export const deleteStaffProfile = createAsyncThunk(
  "staffProfiles/delete",
  async (userId: number, { rejectWithValue }) => {
    try {
      await axiosInstance.delete(`/staffProfiles/${userId}`, {
        withCredentials: true,
      });
      return userId;
    } catch (error) {
      return rejectWithValue(extractErrorMessage(error));
    }
  },
);
