import { createAsyncThunk } from "@reduxjs/toolkit";
import axiosInstance from "../utils/axiosInstance";
import type { ServerResponse } from "../types/general/ServerResponse";
import type { VenueCompensationTerm } from "../types/venues/VenueCompensationTerm";

const unwrapSingle = <T>(payload: T | T[]): T => (Array.isArray(payload) ? payload[0] : payload);

type FetchFilters = {
  venueId?: number;
  activeOnly?: boolean;
  type?: "open_bar" | "commission";
};

export const fetchVenueCompensationTerms = createAsyncThunk<
  ServerResponse<Partial<VenueCompensationTerm>>,
  FetchFilters | undefined,
  { rejectValue: string }
>("venueCompensationTerms/fetchAll", async (filters = {}, { rejectWithValue }) => {
  try {
    const response = await axiosInstance.get<ServerResponse<Partial<VenueCompensationTerm>>>(
      "/venueCompensationTerms",
      {
        params: {
          venueId: filters.venueId,
          active: filters.activeOnly ? "true" : undefined,
          type: filters.type,
        },
        withCredentials: true,
      },
    );
    return response.data;
  } catch (error) {
    if (error instanceof Error) {
      return rejectWithValue(error.message);
    }
    return rejectWithValue("Failed to load venue compensation terms");
  }
});

export const createVenueCompensationTerm = createAsyncThunk<
  VenueCompensationTerm | undefined,
  Partial<VenueCompensationTerm>,
  { rejectValue: string }
>("venueCompensationTerms/create", async (payload, { rejectWithValue }) => {
  try {
    const response = await axiosInstance.post<VenueCompensationTerm | VenueCompensationTerm[]>(
      "/venueCompensationTerms",
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
    return rejectWithValue("Failed to create venue compensation term");
  }
});

export const updateVenueCompensationTerm = createAsyncThunk<
  VenueCompensationTerm | undefined,
  { termId: number; payload: Partial<VenueCompensationTerm> },
  { rejectValue: string }
>("venueCompensationTerms/update", async ({ termId, payload }, { rejectWithValue }) => {
  try {
    const response = await axiosInstance.patch<VenueCompensationTerm | VenueCompensationTerm[]>(
      `/venueCompensationTerms/${termId}`,
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
    return rejectWithValue("Failed to update venue compensation term");
  }
});

export const deleteVenueCompensationTerm = createAsyncThunk<
  number,
  number,
  { rejectValue: string }
>("venueCompensationTerms/delete", async (termId, { rejectWithValue }) => {
  try {
    await axiosInstance.delete(`/venueCompensationTerms/${termId}`, {
      withCredentials: true,
    });
    return termId;
  } catch (error) {
    if (error instanceof Error) {
      return rejectWithValue(error.message);
    }
    return rejectWithValue("Failed to delete venue compensation term");
  }
});

