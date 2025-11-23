import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { DataState } from "../types/general/DataState";
import { ServerResponse } from "../types/general/ServerResponse";
import { VenueCompensationTermRate } from "../types/venues/VenueCompensationTermRate";
import {
  createVenueCompensationTermRate,
  deleteVenueCompensationTermRate,
  fetchVenueCompensationTermRates,
  updateVenueCompensationTermRate,
} from "../actions/venueCompensationTermRateActions";

const initialState: DataState<Partial<VenueCompensationTermRate>> = [
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

const venueCompensationTermRateSlice = createSlice({
  name: "venueCompensationTermRates",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchVenueCompensationTermRates.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(
        fetchVenueCompensationTermRates.fulfilled,
        (state, action: PayloadAction<ServerResponse<Partial<VenueCompensationTermRate>>>) => {
          state[0].loading = false;
          state[0].data = action.payload;
          state[0].error = null;
        },
      )
      .addCase(fetchVenueCompensationTermRates.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error =
          action.payload?.toString() ?? action.error.message ?? "Failed to fetch compensation rate bands";
      })
      .addCase(createVenueCompensationTermRate.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(
        createVenueCompensationTermRate.fulfilled,
        (state, action: PayloadAction<Partial<VenueCompensationTermRate> | undefined>) => {
          state[0].loading = false;
          state[0].error = null;
          if (action.payload) {
            state[0].data[0].data.unshift(action.payload);
          }
        },
      )
      .addCase(createVenueCompensationTermRate.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error =
          action.payload?.toString() ?? action.error.message ?? "Failed to create compensation rate band";
      })
      .addCase(updateVenueCompensationTermRate.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(
        updateVenueCompensationTermRate.fulfilled,
        (state, action: PayloadAction<Partial<VenueCompensationTermRate> | undefined>) => {
          state[0].loading = false;
          state[0].error = null;
          if (action.payload?.id != null) {
            state[0].data[0].data = state[0].data[0].data.map((record) =>
              record.id === action.payload?.id ? { ...record, ...action.payload } : record,
            );
          }
        },
      )
      .addCase(updateVenueCompensationTermRate.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error =
          action.payload?.toString() ?? action.error.message ?? "Failed to update compensation rate band";
      })
      .addCase(deleteVenueCompensationTermRate.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(deleteVenueCompensationTermRate.fulfilled, (state, action: PayloadAction<number>) => {
        state[0].loading = false;
        state[0].error = null;
        state[0].data[0].data = state[0].data[0].data.filter((record) => record.id !== action.payload);
      })
      .addCase(deleteVenueCompensationTermRate.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error =
          action.payload?.toString() ?? action.error.message ?? "Failed to delete compensation rate band";
      });
  },
});

export default venueCompensationTermRateSlice.reducer;

