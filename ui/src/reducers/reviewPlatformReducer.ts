import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { DataState } from '../types/general/DataState';
import type { ServerResponse } from '../types/general/ServerResponse';
import type { ReviewPlatform } from '../types/reviewPlatforms/ReviewPlatform';
import { fetchReviewPlatforms } from '../actions/reviewPlatformActions';

const initialState: DataState<ReviewPlatform> = [
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

const reviewPlatformSlice = createSlice({
  name: 'reviewPlatforms',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchReviewPlatforms.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(fetchReviewPlatforms.fulfilled, (state, action: PayloadAction<ServerResponse<ReviewPlatform>>) => {
        state[0].loading = false;
        state[0].data = action.payload;
        state[0].error = null;
      })
      .addCase(fetchReviewPlatforms.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.payload ? String(action.payload) : action.error.message ?? 'Failed to load review platforms';
      });
  },
});

export default reviewPlatformSlice.reducer;
