import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { DataState } from '../types/general/DataState';
import { type ServerResponse } from '../types/general/ServerResponse';
import { fetchGoogleReviews } from '../actions/reviewsActions'; // Import thunks
import { Review } from '../types/general/Reviews';

// Define the initial state using that type
const initialState: DataState<Partial<Review>> = [{
  loading: false,
  data: [{
    data: [],
    columns: []
  }],
  error: null,
}];

const reviewsSlice = createSlice({
  name: 'reviews',
  initialState,
  reducers: {
    // Synchronous actions (if any)
  },
  extraReducers: (builder) => {
    builder
      // Fetch Pays
      .addCase(fetchGoogleReviews.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(fetchGoogleReviews.fulfilled, (state, action: PayloadAction<ServerResponse<Partial<Review>>>) => {
        state[0].loading = false;
        state[0].data = action.payload;
        state[0].error = null;
      })
      .addCase(fetchGoogleReviews.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || 'Failed to fetch reviews';
      })
  },
});

export default reviewsSlice.reducer;
