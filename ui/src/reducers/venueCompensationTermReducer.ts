import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { DataState } from "../types/general/DataState";
import { ServerResponse } from "../types/general/ServerResponse";
import { VenueCompensationTerm } from "../types/venues/VenueCompensationTerm";
import {
  createVenueCompensationTerm,
  deleteVenueCompensationTerm,
  fetchVenueCompensationTerms,
  updateVenueCompensationTerm,
} from "../actions/venueCompensationTermActions";

const initialState: DataState<Partial<VenueCompensationTerm>> = [
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

const venueCompensationTermSlice = createSlice({
  name: "venueCompensationTerms",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchVenueCompensationTerms.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(
        fetchVenueCompensationTerms.fulfilled,
        (state, action: PayloadAction<ServerResponse<Partial<VenueCompensationTerm>>>) => {
          state[0].loading = false;
          state[0].data = action.payload;
          state[0].error = null;
        },
      )
      .addCase(fetchVenueCompensationTerms.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error =
          action.payload?.toString() ?? action.error.message ?? "Failed to fetch venue compensation terms";
      })
      .addCase(createVenueCompensationTerm.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(
        createVenueCompensationTerm.fulfilled,
        (state, action: PayloadAction<Partial<VenueCompensationTerm> | undefined>) => {
          state[0].loading = false;
          state[0].error = null;
          if (action.payload) {
            state[0].data[0].data.unshift(action.payload);
          }
        },
      )
      .addCase(createVenueCompensationTerm.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error =
          action.payload?.toString() ?? action.error.message ?? "Failed to create venue compensation term";
      })
      .addCase(updateVenueCompensationTerm.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(
        updateVenueCompensationTerm.fulfilled,
        (state, action: PayloadAction<Partial<VenueCompensationTerm> | undefined>) => {
          state[0].loading = false;
          state[0].error = null;
          if (action.payload?.id != null) {
            state[0].data[0].data = state[0].data[0].data.map((record) =>
              record.id === action.payload?.id ? { ...record, ...action.payload } : record,
            );
          }
        },
      )
      .addCase(updateVenueCompensationTerm.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error =
          action.payload?.toString() ?? action.error.message ?? "Failed to update venue compensation term";
      })
      .addCase(deleteVenueCompensationTerm.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(deleteVenueCompensationTerm.fulfilled, (state, action: PayloadAction<number>) => {
        state[0].loading = false;
        state[0].error = null;
        state[0].data[0].data = state[0].data[0].data.filter((record) => record.id !== action.payload);
      })
      .addCase(deleteVenueCompensationTerm.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error =
          action.payload?.toString() ?? action.error.message ?? "Failed to delete venue compensation term";
      });
  },
});

export default venueCompensationTermSlice.reducer;

