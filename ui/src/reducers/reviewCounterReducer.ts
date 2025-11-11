import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { type DataState } from '../types/general/DataState';
import { type ReviewCounter } from '../types/reviewCounters/ReviewCounter';
import { type ServerResponse } from '../types/general/ServerResponse';
import { fetchReviewCounters } from '../actions/reviewCounterActions';

const initialState: DataState<ReviewCounter> = [
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

const reviewCounterSlice = createSlice({
  name: 'reviewCounters',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchReviewCounters.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(fetchReviewCounters.fulfilled, (state, action: PayloadAction<ServerResponse<ReviewCounter>>) => {
        state[0].loading = false;
        state[0].data = action.payload;
        state[0].error = null;
      })
      .addCase(fetchReviewCounters.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.payload ? String(action.payload) : action.error.message ?? 'Failed to load review counters';
      });
  },
});

export default reviewCounterSlice.reducer;
