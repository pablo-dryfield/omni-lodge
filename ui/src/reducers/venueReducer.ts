import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { Venue } from "../types/venues/Venue";
import { DataState } from "../types/general/DataState";
import { ServerResponse } from "../types/general/ServerResponse";
import { createVenue, deleteVenue, fetchVenues, updateVenue } from "../actions/venueActions";

const initialState: DataState<Partial<Venue>> = [
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

const venueSlice = createSlice({
  name: "venues",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchVenues.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(fetchVenues.fulfilled, (state, action: PayloadAction<ServerResponse<Partial<Venue>>>) => {
        state[0].loading = false;
        state[0].data = action.payload;
        state[0].error = null;
      })
      .addCase(fetchVenues.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.payload?.toString() ?? action.error.message ?? "Failed to fetch venues";
      })

      .addCase(createVenue.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(createVenue.fulfilled, (state, action: PayloadAction<Partial<Venue> | undefined>) => {
        state[0].loading = false;
        state[0].error = null;
        if (action.payload) {
          state[0].data[0].data.push(action.payload);
        }
      })
      .addCase(createVenue.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.payload?.toString() ?? action.error.message ?? "Failed to create venue";
      })

      .addCase(updateVenue.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(updateVenue.fulfilled, (state, action: PayloadAction<Partial<Venue> | undefined>) => {
        state[0].loading = false;
        state[0].error = null;
        if (action.payload?.id != null) {
          state[0].data[0].data = state[0].data[0].data.map((venue) =>
            venue.id === action.payload?.id ? { ...venue, ...action.payload } : venue,
          );
        }
      })
      .addCase(updateVenue.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.payload?.toString() ?? action.error.message ?? "Failed to update venue";
      })

      .addCase(deleteVenue.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(deleteVenue.fulfilled, (state, action: PayloadAction<number>) => {
        state[0].loading = false;
        state[0].error = null;
        state[0].data[0].data = state[0].data[0].data.filter((venue) => venue.id !== action.payload);
      })
      .addCase(deleteVenue.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.payload?.toString() ?? action.error.message ?? "Failed to delete venue";
      });
  },
});

export default venueSlice.reducer;

