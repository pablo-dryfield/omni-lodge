import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { DataState } from "../types/general/DataState";
import { type ServerResponse } from "../types/general/ServerResponse";
import { fetchAirbnbReviews, fetchGoogleReviews, fetchTripAdvisorReviews } from "../actions/reviewsActions";
import { Review } from "../types/general/Reviews";

type ReviewsSliceState = {
  google: DataState<Partial<Review>>;
  tripadvisor: DataState<Partial<Review>>;
  airbnb: DataState<Partial<Review>>;
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
  airbnb: createInitialDataState(),
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
          const metadata = action.payload[0].columns?.[0] ?? {};
          const offset = metadata?.offset ?? 0;
          if (offset > 0) {
            state.tripadvisor[0].data[0].data.push(...action.payload[0].data);
          } else {
            state.tripadvisor[0].data[0].data = action.payload[0].data;
          }
          state.tripadvisor[0].data[0].columns[0] = metadata;
          state.tripadvisor[0].error = null;
        },
      )
      .addCase(fetchTripAdvisorReviews.rejected, (state, action) => {
        state.tripadvisor[0].loading = false;
        state.tripadvisor[0].error = action.error.message || "Failed to fetch TripAdvisor reviews";
      })
      .addCase(fetchAirbnbReviews.pending, (state) => {
        state.airbnb[0].loading = true;
      })
      .addCase(
        fetchAirbnbReviews.fulfilled,
        (state, action: PayloadAction<ServerResponse<Partial<Review>>>) => {
          state.airbnb[0].loading = false;
          const metadata = action.payload[0].columns?.[0] ?? {};
          const cursorUsed = metadata?.cursorUsed ?? null;
          if (cursorUsed) {
            state.airbnb[0].data[0].data.push(...action.payload[0].data);
          } else {
            state.airbnb[0].data[0].data = action.payload[0].data;
          }
          state.airbnb[0].data[0].columns[0] = metadata;
          state.airbnb[0].error = null;
        },
      )
      .addCase(fetchAirbnbReviews.rejected, (state, action) => {
        state.airbnb[0].loading = false;
        state.airbnb[0].error =
          (typeof action.payload === "string" ? action.payload : null) ||
          action.error.message ||
          "Failed to fetch Airbnb reviews";
      });
  },
});

export default reviewsSlice.reducer;
