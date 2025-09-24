import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { Module } from "../types/modules/Module";
import { DataState } from "../types/general/DataState";
import { ServerResponse } from "../types/general/ServerResponse";
import {
  createModule,
  deleteModule,
  fetchModules,
  updateModule,
} from "../actions/moduleActions";

const initialState: DataState<Partial<Module>> = [
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

const moduleSlice = createSlice({
  name: "modules",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchModules.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(
        fetchModules.fulfilled,
        (state, action: PayloadAction<ServerResponse<Partial<Module>>>) => {
          state[0].loading = false;
          state[0].data = action.payload;
          state[0].error = null;
        }
      )
      .addCase(fetchModules.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || "Failed to fetch modules";
      })
      .addCase(createModule.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(createModule.fulfilled, (state, action: PayloadAction<Partial<Module> | undefined>) => {
        state[0].loading = false;
        if (action.payload) {
          state[0].data[0].data.push(action.payload);
        }
        state[0].error = null;
      })
      .addCase(createModule.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || "Failed to create module";
      })
      .addCase(updateModule.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(updateModule.fulfilled, (state, action: PayloadAction<Partial<Module> | undefined>) => {
        state[0].loading = false;
        if (action.payload?.id !== undefined) {
          state[0].data[0].data = state[0].data[0].data.map((moduleRecord) =>
            moduleRecord.id === action.payload?.id ? action.payload : moduleRecord
          );
        }
        state[0].error = null;
      })
      .addCase(updateModule.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || "Failed to update module";
      })
      .addCase(deleteModule.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(deleteModule.fulfilled, (state, action: PayloadAction<number>) => {
        state[0].loading = false;
        state[0].data[0].data = state[0].data[0].data.filter(
          (moduleRecord) => moduleRecord.id !== action.payload
        );
        state[0].error = null;
      })
      .addCase(deleteModule.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || "Failed to delete module";
      });
  },
});

export default moduleSlice.reducer;
