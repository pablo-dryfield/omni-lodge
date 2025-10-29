import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { StaffProfile } from "../types/staffProfiles/StaffProfile";
import type { DataState } from "../types/general/DataState";
import type { ServerResponse } from "../types/general/ServerResponse";
import {
  createStaffProfile,
  deleteStaffProfile,
  fetchStaffProfiles,
  updateStaffProfile,
} from "../actions/staffProfileActions";

const initialState: DataState<Partial<StaffProfile>> = [
  {
    loading: false,
    data: [
      {
        data: [],
        columns: [],
      },
    ],
    error: null,
  },
];

const toRecord = (payload: Partial<StaffProfile> | Partial<StaffProfile>[] | undefined) => {
  if (!payload) {
    return undefined;
  }
  if (Array.isArray(payload)) {
    return payload[0];
  }
  return payload;
};

const staffProfileSlice = createSlice({
  name: "staffProfiles",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchStaffProfiles.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(
        fetchStaffProfiles.fulfilled,
        (state, action: PayloadAction<ServerResponse<Partial<StaffProfile>>>) => {
          state[0].loading = false;
          state[0].data = action.payload;
          state[0].error = null;
        },
      )
      .addCase(fetchStaffProfiles.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error =
          (typeof action.payload === "string" && action.payload) ||
          action.error.message ||
          "Failed to fetch staff profiles";
      })
      .addCase(createStaffProfile.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(createStaffProfile.fulfilled, (state, action: PayloadAction<Partial<StaffProfile>>) => {
        state[0].loading = false;
        const record = toRecord(action.payload);
        if (record) {
          state[0].data[0].data.push(record);
        }
        state[0].error = null;
      })
      .addCase(createStaffProfile.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error =
          (typeof action.payload === "string" && action.payload) ||
          action.error.message ||
          "Failed to create staff profile";
      })
      .addCase(updateStaffProfile.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(updateStaffProfile.fulfilled, (state, action: PayloadAction<Partial<StaffProfile>>) => {
        state[0].loading = false;
        const record = toRecord(action.payload);
        if (record?.userId != null) {
          state[0].data[0].data = state[0].data[0].data.map((item) =>
            item.userId === record.userId ? { ...item, ...record } : item,
          );
        }
        state[0].error = null;
      })
      .addCase(updateStaffProfile.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error =
          (typeof action.payload === "string" && action.payload) ||
          action.error.message ||
          "Failed to update staff profile";
      })
      .addCase(deleteStaffProfile.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(deleteStaffProfile.fulfilled, (state, action: PayloadAction<number>) => {
        state[0].loading = false;
        state[0].data[0].data = state[0].data[0].data.filter((item) => item.userId !== action.payload);
        state[0].error = null;
      })
      .addCase(deleteStaffProfile.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error =
          (typeof action.payload === "string" && action.payload) ||
          action.error.message ||
          "Failed to delete staff profile";
      });
  },
});

export default staffProfileSlice.reducer;
