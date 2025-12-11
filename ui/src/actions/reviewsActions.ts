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

export const fetchGetYourGuideReviews = createAsyncThunk(
  "getYourGuideReviews/fetchGetYourGuideReviews",
  async (
    { forceRefresh = false, limit }: { forceRefresh?: boolean; limit?: number } = {},
    { rejectWithValue },
  ) => {
    try {
      const params: Record<string, any> = {};
      if (forceRefresh) params.forceRefresh = true;
      if (typeof limit === "number") params.limit = limit;
      const response = await axiosInstance.get<ServerResponse<Partial<Review>>>("/reviews/getyourguideReviews", {
        withCredentials: true,
        params: Object.keys(params).length ? params : undefined,
      });
      return response.data;
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : "Unknown error");
    }
  },
);
