import { createAsyncThunk } from "@reduxjs/toolkit";
import { ServerResponse } from "../types/general/ServerResponse";
import axiosInstance from "../utils/axiosInstance";
import { Review } from "../types/general/Reviews";

export const fetchGoogleReviews = createAsyncThunk(
  'googleReviews/fetchGoogleReviews',
  async (_, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get<ServerResponse<Partial<Review>>>('/api/reviews/googleReviews', {
        withCredentials: true
      });
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('An unknown error occurred');
    }
  }
);