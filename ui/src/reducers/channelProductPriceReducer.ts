import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { ChannelProductPrice } from "../types/channels/ChannelProductPrice";
import { DataState } from "../types/general/DataState";
import { ServerResponse } from "../types/general/ServerResponse";
import {
  createChannelProductPrice,
  deleteChannelProductPrice,
  fetchChannelProductPrices,
  updateChannelProductPrice,
} from "../actions/channelProductPriceActions";

const initialState: DataState<Partial<ChannelProductPrice>> = [
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

const channelProductPriceSlice = createSlice({
  name: "channelProductPrices",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchChannelProductPrices.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(
        fetchChannelProductPrices.fulfilled,
        (state, action: PayloadAction<ServerResponse<Partial<ChannelProductPrice>>>) => {
          state[0].loading = false;
          state[0].data = action.payload;
          state[0].error = null;
        },
      )
      .addCase(fetchChannelProductPrices.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error =
          action.payload?.toString() ?? action.error.message ?? "Failed to fetch channel product prices";
      })
      .addCase(createChannelProductPrice.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(
        createChannelProductPrice.fulfilled,
        (state, action: PayloadAction<Partial<ChannelProductPrice> | undefined>) => {
          state[0].loading = false;
          state[0].error = null;
          if (action.payload) {
            state[0].data[0].data.unshift(action.payload);
          }
        },
      )
      .addCase(createChannelProductPrice.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error =
          action.payload?.toString() ?? action.error.message ?? "Failed to create channel product price";
      })
      .addCase(updateChannelProductPrice.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(
        updateChannelProductPrice.fulfilled,
        (state, action: PayloadAction<Partial<ChannelProductPrice> | undefined>) => {
          state[0].loading = false;
          state[0].error = null;
          if (action.payload?.id != null) {
            state[0].data[0].data = state[0].data[0].data.map((record) =>
              record.id === action.payload?.id ? { ...record, ...action.payload } : record,
            );
          }
        },
      )
      .addCase(updateChannelProductPrice.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error =
          action.payload?.toString() ?? action.error.message ?? "Failed to update channel product price";
      })
      .addCase(deleteChannelProductPrice.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(deleteChannelProductPrice.fulfilled, (state, action: PayloadAction<number>) => {
        state[0].loading = false;
        state[0].error = null;
        state[0].data[0].data = state[0].data[0].data.filter((record) => record.id !== action.payload);
      })
      .addCase(deleteChannelProductPrice.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error =
          action.payload?.toString() ?? action.error.message ?? "Failed to delete channel product price";
      });
  },
});

export default channelProductPriceSlice.reducer;
