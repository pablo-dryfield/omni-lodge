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
  async (_, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get<ServerResponse<Partial<Review>>>("/reviews/tripadvisorReviews", {
        withCredentials: true,
      });
      return response.data;
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : "Unknown error");
    }
  },
);
