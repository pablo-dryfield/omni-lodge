import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { Addon } from "../types/addons/Addon";
import { DataState } from "../types/general/DataState";
import { ServerResponse } from "../types/general/ServerResponse";
import { createAddon, deleteAddon, fetchAddons, updateAddon } from "../actions/addonActions";

const initialState: DataState<Partial<Addon>> = [
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

const addonSlice = createSlice({
  name: "addons",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchAddons.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(
        fetchAddons.fulfilled,
        (state, action: PayloadAction<ServerResponse<Partial<Addon>>>) => {
          state[0].loading = false;
          state[0].data = action.payload;
          state[0].error = null;
        },
      )
      .addCase(fetchAddons.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.payload?.toString() ?? action.error.message ?? "Failed to fetch add-ons";
      })
      .addCase(createAddon.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(createAddon.fulfilled, (state, action: PayloadAction<Partial<Addon> | undefined>) => {
        state[0].loading = false;
        state[0].error = null;
        if (action.payload) {
          state[0].data[0].data.push(action.payload);
        }
      })
      .addCase(createAddon.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.payload?.toString() ?? action.error.message ?? "Failed to create add-on";
      })
      .addCase(updateAddon.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(updateAddon.fulfilled, (state, action: PayloadAction<Partial<Addon> | undefined>) => {
        state[0].loading = false;
        state[0].error = null;
        if (action.payload?.id != null) {
          state[0].data[0].data = state[0].data[0].data.map((addon) =>
            addon.id === action.payload?.id ? { ...addon, ...action.payload } : addon,
          );
        }
      })
      .addCase(updateAddon.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.payload?.toString() ?? action.error.message ?? "Failed to update add-on";
      })
      .addCase(deleteAddon.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(deleteAddon.fulfilled, (state, action: PayloadAction<number>) => {
        state[0].loading = false;
        state[0].error = null;
        state[0].data[0].data = state[0].data[0].data.filter((addon) => addon.id !== action.payload);
      })
      .addCase(deleteAddon.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.payload?.toString() ?? action.error.message ?? "Failed to delete add-on";
      });
  },
});

export default addonSlice.reducer;
