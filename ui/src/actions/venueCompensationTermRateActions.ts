import { createAsyncThunk } from "@reduxjs/toolkit";
import axiosInstance from "../utils/axiosInstance";
import { ServerResponse } from "../types/general/ServerResponse";
import { VenueCompensationTermRate } from "../types/venues/VenueCompensationTermRate";

type FetchFilters = {
  termId?: number;
  venueId?: number;
};

const unwrapSingle = <T>(payload: T | T[]): T => (Array.isArray(payload) ? payload[0] : payload);

export const fetchVenueCompensationTermRates = createAsyncThunk<
  ServerResponse<Partial<VenueCompensationTermRate>>,
  FetchFilters | undefined,
  { rejectValue: string }
>("venueCompensationTermRates/fetch", async (filters = {}, { rejectWithValue }) => {
  try {
    const response = await axiosInstance.get<ServerResponse<Partial<VenueCompensationTermRate>>>(
      "/venueCompensationTermRates",
      {
        params: {
          termId: filters.termId,
          venueId: filters.venueId,
        },
        withCredentials: true,
      },
    );
    return response.data;
  } catch (error) {
    if (error instanceof Error) {
      return rejectWithValue(error.message);
    }
    return rejectWithValue("Failed to load compensation rate bands");
  }
});

export const createVenueCompensationTermRate = createAsyncThunk<
  VenueCompensationTermRate | undefined,
  Partial<VenueCompensationTermRate>,
  { rejectValue: string }
>("venueCompensationTermRates/create", async (payload, { rejectWithValue }) => {
  try {
    const response = await axiosInstance.post<VenueCompensationTermRate | VenueCompensationTermRate[]>(
      "/venueCompensationTermRates",
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
    return rejectWithValue("Failed to create compensation rate band");
  }
});

export const updateVenueCompensationTermRate = createAsyncThunk<
  VenueCompensationTermRate | undefined,
  { rateId: number; payload: Partial<VenueCompensationTermRate> },
  { rejectValue: string }
>("venueCompensationTermRates/update", async ({ rateId, payload }, { rejectWithValue }) => {
  try {
    const response = await axiosInstance.patch<VenueCompensationTermRate | VenueCompensationTermRate[]>(
      `/venueCompensationTermRates/${rateId}`,
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
    return rejectWithValue("Failed to update compensation rate band");
  }
});

export const deleteVenueCompensationTermRate = createAsyncThunk<
  number,
  number,
  { rejectValue: string }
>("venueCompensationTermRates/delete", async (rateId, { rejectWithValue }) => {
  try {
    await axiosInstance.delete(`/venueCompensationTermRates/${rateId}`, {
      withCredentials: true,
    });
    return rateId;
  } catch (error) {
    if (error instanceof Error) {
      return rejectWithValue(error.message);
    }
    return rejectWithValue("Failed to delete compensation rate band");
  }
});

