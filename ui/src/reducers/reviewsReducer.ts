import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { DataState } from "../types/general/DataState";
import { type ServerResponse } from "../types/general/ServerResponse";
import { fetchGoogleReviews, fetchTripAdvisorReviews, fetchGetYourGuideReviews } from "../actions/reviewsActions";
import { Review } from "../types/general/Reviews";

type ReviewsSliceState = {
  google: DataState<Partial<Review>>;
  tripadvisor: DataState<Partial<Review>>;
  getyourguide: DataState<Partial<Review>>;
};

const createInitialDataState = (): DataState<Partial<Review>> => [
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

const initialState: ReviewsSliceState = {
  google: createInitialDataState(),
  tripadvisor: createInitialDataState(),
  getyourguide: createInitialDataState(),
};

const reviewsSlice = createSlice({
  name: "reviews",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchGoogleReviews.pending, (state) => {
        state.google[0].loading = true;
      })
      .addCase(
        fetchGoogleReviews.fulfilled,
        (state, action: PayloadAction<ServerResponse<Partial<Review>>> ) => {
          state.google[0].loading = false;
          const newReviews = action.payload[0].data;
          state.google[0].data[0].data.push(...newReviews);
          state.google[0].data[0].columns[0] = action.payload[0].columns[0] ?? "";
          state.google[0].error = null;
        },
      )
      .addCase(fetchGoogleReviews.rejected, (state, action) => {
        state.google[0].loading = false;
        state.google[0].error = action.error.message || "Failed to fetch reviews";
      })
      .addCase(fetchTripAdvisorReviews.pending, (state) => {
        state.tripadvisor[0].loading = true;
      })
      .addCase(
        fetchTripAdvisorReviews.fulfilled,
        (state, action: PayloadAction<ServerResponse<Partial<Review>>>) => {
          state.tripadvisor[0].loading = false;
          state.tripadvisor[0].data[0].data = action.payload[0].data;
          state.tripadvisor[0].data[0].columns[0] = action.payload[0].columns[0] ?? "";
          state.tripadvisor[0].error = null;
        },
      )
      .addCase(fetchTripAdvisorReviews.rejected, (state, action) => {
        state.tripadvisor[0].loading = false;
        state.tripadvisor[0].error = action.error.message || "Failed to fetch TripAdvisor reviews";
      })
      .addCase(fetchGetYourGuideReviews.pending, (state) => {
        state.getyourguide[0].loading = true;
      })
      .addCase(
        fetchGetYourGuideReviews.fulfilled,
        (state, action: PayloadAction<ServerResponse<Partial<Review>>>) => {
          state.getyourguide[0].loading = false;
          state.getyourguide[0].data[0].data = action.payload[0].data;
          state.getyourguide[0].data[0].columns[0] = action.payload[0].columns[0] ?? "";
          state.getyourguide[0].error = null;
        },
      )
      .addCase(fetchGetYourGuideReviews.rejected, (state, action) => {
        state.getyourguide[0].loading = false;
        state.getyourguide[0].error = action.error.message || "Failed to fetch GetYourGuide reviews";
      });
  },
});

export default reviewsSlice.reducer;
