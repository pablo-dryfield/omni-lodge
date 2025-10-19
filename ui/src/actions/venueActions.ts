import { createAsyncThunk } from "@reduxjs/toolkit";
import axiosInstance from "../utils/axiosInstance";
import { ServerResponse } from "../types/general/ServerResponse";
import { Venue } from "../types/venues/Venue";

const unwrapSingle = <T>(payload: T | T[]): T => (Array.isArray(payload) ? payload[0] : payload);

export const fetchVenues = createAsyncThunk(
  "venues/fetchVenues",
  async (_, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get<ServerResponse<Partial<Venue>>>("/venues", {
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

export const createVenue = createAsyncThunk(
  "venues/createVenue",
  async (venueData: Partial<Venue>, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.post<Partial<Venue> | Partial<Venue>[]>("/venues", venueData, {
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

export const updateVenue = createAsyncThunk(
  "venues/updateVenue",
  async ({ venueId, venueData }: { venueId: number; venueData: Partial<Venue> }, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.put<Partial<Venue> | Partial<Venue>[]>(`/venues/${venueId}`, venueData, {
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

export const deleteVenue = createAsyncThunk(
  "venues/deleteVenue",
  async (venueId: number, { rejectWithValue }) => {
    try {
      await axiosInstance.delete(`/venues/${venueId}`, {
        withCredentials: true,
      });
      return venueId;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue("An unknown error occurred");
    }
  },
);

