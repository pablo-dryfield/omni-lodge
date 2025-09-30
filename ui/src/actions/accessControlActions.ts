import { createAsyncThunk } from "@reduxjs/toolkit";
import axiosInstance from "../utils/axiosInstance";
import { AccessSnapshot } from "../types/permissions/AccessSnapshot";

export const fetchAccessSnapshot = createAsyncThunk<
  AccessSnapshot,
  void,
  { rejectValue: string }
>("accessControl/fetchSnapshot", async (_, { rejectWithValue }) => {
  try {
    const response = await axiosInstance.get<AccessSnapshot>("/accessControl/me", {
      withCredentials: true,
    });

    return response.data;
  } catch (error) {
    if (error instanceof Error) {
      return rejectWithValue(error.message);
    }

    return rejectWithValue("An unknown error occurred");
  }
});
