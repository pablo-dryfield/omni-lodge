import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { Booking } from '../types/bookings/Booking';
import { DataState } from '../types/general/DataState';
import { type ServerResponse } from '../types/general/ServerResponse';
import { fetchBookings, createBooking, updateBooking, deleteBooking } from '../actions/bookingActions'; // Import thunks

// Define the initial state using that type
const initialState: DataState<Booking> = [{
  loading: false,
  data: [{
    data: [],
    columns: []
  }],
  error: null,
}];

const bookingSlice = createSlice({
  name: 'bookings',
  initialState,
  reducers: {
    // Synchronous actions (if any)
  },
  extraReducers: (builder) => {
    builder
      // Fetch Bookings
      .addCase(fetchBookings.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(fetchBookings.fulfilled, (state, action: PayloadAction<ServerResponse<Booking>>) => {
        state[0].loading = false;
        state[0].data = action.payload;
        state[0].error = null;
      })
      .addCase(fetchBookings.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || 'Failed to fetch bookings';
      })
      
      // Create Booking
      .addCase(createBooking.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(createBooking.fulfilled, (state, action: PayloadAction<Booking>) => {
        state[0].loading = false;
        state[0].data[0].data.push(action.payload);
        state[0].error = null;
      })
      .addCase(createBooking.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || 'Failed to create booking';
      })
      
      // Update Booking
      .addCase(updateBooking.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(updateBooking.fulfilled, (state, action: PayloadAction<Booking>) => {
        state[0].loading = false;
        state[0].data[0].data = state[0].data[0].data.map(booking => 
          booking.id === action.payload.id ? action.payload : booking
        );
        state[0].error = null;
      })
      .addCase(updateBooking.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || 'Failed to update booking';
      })
      
      // Delete Booking
      .addCase(deleteBooking.pending, (state) => {
        state[0].loading = true;
      })
      
      .addCase(deleteBooking.fulfilled, (state, action: PayloadAction<number>) => {
        state[0].loading = false;
        state[0].data[0].data = state[0].data[0].data.filter(booking => booking.id !== action.payload);
        state[0].error = null;
      })
      .addCase(deleteBooking.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || 'Failed to delete booking';
      });
  },
});

export default bookingSlice.reducer;
