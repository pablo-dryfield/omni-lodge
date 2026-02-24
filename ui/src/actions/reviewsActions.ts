import { createAsyncThunk } from "@reduxjs/toolkit";
import { ServerResponse } from "../types/general/ServerResponse";
import axiosInstance from "../utils/axiosInstance";
import { Review } from "../types/general/Reviews";

export const fetchGoogleReviews = createAsyncThunk(
  "googleReviews/fetchGoogleReviews",
  async ({ nextPageToken }: { nextPageToken?: string } = {}, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get<ServerResponse<Partial<Review>>>(
        `/reviews/googleReviews${nextPageToken ? `?pageToken=${nextPageToken}` : ""}`,
        {
          withCredentials: true,
        },
      );
      return response.data;
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : "Unknown error");
    }
  },
);

export const fetchTripAdvisorReviews = createAsyncThunk(
  "tripAdvisorReviews/fetchTripAdvisorReviews",
  async ({ offset = 0 }: { offset?: number } = {}, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get<ServerResponse<Partial<Review>>>(
        "/reviews/tripadvisorReviews",
        {
          withCredentials: true,
          params: offset ? { offset } : undefined,
        },
      );
      return response.data;
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : "Unknown error");
    }
  },
);

export const fetchAirbnbReviews = createAsyncThunk(
  "airbnbReviews/fetchAirbnbReviews",
  async ({ cursor }: { cursor?: string } = {}, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get<ServerResponse<Partial<Review>>>(
        "/reviews/airbnbReviews",
        {
          withCredentials: true,
          params: cursor ? { cursor } : undefined,
        },
      );
      return response.data;
    } catch (error: any) {
      const apiErrorMessage =
        typeof error?.response?.data?.details === "string"
          ? error.response.data.details
          : typeof error?.response?.data?.error === "string"
            ? error.response.data.error
            : null;
      return rejectWithValue(apiErrorMessage ?? (error instanceof Error ? error.message : "Unknown error"));
    }
  },
);
