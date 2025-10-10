import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { ChannelCommission } from "../types/channels/ChannelCommission";
import { DataState } from "../types/general/DataState";
import { ServerResponse } from "../types/general/ServerResponse";
import {
  createChannelCommission,
  deleteChannelCommission,
  fetchChannelCommissions,
  updateChannelCommission,
} from "../actions/channelCommissionActions";

const initialState: DataState<Partial<ChannelCommission>> = [
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

const channelCommissionSlice = createSlice({
  name: "channelCommissions",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchChannelCommissions.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(
        fetchChannelCommissions.fulfilled,
        (state, action: PayloadAction<ServerResponse<Partial<ChannelCommission>>>) => {
          state[0].loading = false;
          state[0].data = action.payload;
          state[0].error = null;
        },
      )
      .addCase(fetchChannelCommissions.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.payload?.toString() ?? action.error.message ?? "Failed to fetch channel commissions";
      })
      .addCase(createChannelCommission.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(
        createChannelCommission.fulfilled,
        (state, action: PayloadAction<Partial<ChannelCommission> | undefined>) => {
          state[0].loading = false;
          state[0].error = null;
          if (action.payload) {
            state[0].data[0].data.unshift(action.payload);
          }
        },
      )
      .addCase(createChannelCommission.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.payload?.toString() ?? action.error.message ?? "Failed to create channel commission";
      })
      .addCase(updateChannelCommission.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(
        updateChannelCommission.fulfilled,
        (state, action: PayloadAction<Partial<ChannelCommission> | undefined>) => {
          state[0].loading = false;
          state[0].error = null;
          if (action.payload?.id != null) {
            state[0].data[0].data = state[0].data[0].data.map((record) =>
              record.id === action.payload?.id ? { ...record, ...action.payload } : record,
            );
          }
        },
      )
      .addCase(updateChannelCommission.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.payload?.toString() ?? action.error.message ?? "Failed to update channel commission";
      })
      .addCase(deleteChannelCommission.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(deleteChannelCommission.fulfilled, (state, action: PayloadAction<number>) => {
        state[0].loading = false;
        state[0].error = null;
        state[0].data[0].data = state[0].data[0].data.filter((record) => record.id !== action.payload);
      })
      .addCase(deleteChannelCommission.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.payload?.toString() ?? action.error.message ?? "Failed to delete channel commission";
      });
  },
});

export default channelCommissionSlice.reducer;
