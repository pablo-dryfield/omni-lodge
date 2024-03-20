import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { Guest } from '../types/guests/Guest';
import { DataState } from '../types/general/DataState';
import { type ServerResponse } from '../types/general/ServerResponse';
import { fetchGuests, createGuest, updateGuest, deleteGuest } from '../actions/guestActions'; // Import thunks

// Define the initial state using that type
const initialState: DataState<Partial<Guest>> = [{
  loading: false,
  data: [{
    data: [],
    columns: []
  }],
  error: null,
}];

const guestSlice = createSlice({
  name: 'guests',
  initialState,
  reducers: {
    // Synchronous actions (if any)
  },
  extraReducers: (builder) => {
    builder
      // Fetch Guests
      .addCase(fetchGuests.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(fetchGuests.fulfilled, (state, action: PayloadAction<ServerResponse<Partial<Guest>>>) => {
        state[0].loading = false;
        state[0].data = action.payload;
        state[0].error = null;
      })
      .addCase(fetchGuests.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || 'Failed to fetch guests';
      })
      
      // Create Guest
      .addCase(createGuest.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(createGuest.fulfilled, (state, action: PayloadAction<Partial<Guest>>) => {
        state[0].loading = false;
        state[0].data[0].data.push(action.payload);
        state[0].error = null;
      })
      .addCase(createGuest.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || 'Failed to create guest';
      })
      
      // Update Guest
      .addCase(updateGuest.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(updateGuest.fulfilled, (state, action: PayloadAction<Partial<Guest>>) => {
        state[0].loading = false;
        state[0].data[0].data = state[0].data[0].data.map(guest => 
          guest.id === action.payload.id ? action.payload : guest
        );
        state[0].error = null;
      })
      .addCase(updateGuest.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || 'Failed to update guest';
      })
      
      // Delete Guest
      .addCase(deleteGuest.pending, (state) => {
        state[0].loading = true;
      })
      
      .addCase(deleteGuest.fulfilled, (state, action: PayloadAction<number>) => {
        state[0].loading = false;
        state[0].data[0].data = state[0].data[0].data.filter(guest => guest.id !== action.payload);
        state[0].error = null;
      })
      .addCase(deleteGuest.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || 'Failed to delete guest';
      });
  },
});

export default guestSlice.reducer;
