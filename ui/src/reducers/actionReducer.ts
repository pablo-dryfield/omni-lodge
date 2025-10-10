import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { Action } from "../types/actions/Action";
import { DataState } from "../types/general/DataState";
import { ServerResponse } from "../types/general/ServerResponse";
import { createAction, deleteAction, fetchActions, updateAction } from "../actions/actionActions";

const initialState: DataState<Partial<Action>> = [
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

const actionSlice = createSlice({
  name: "actions",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchActions.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(
        fetchActions.fulfilled,
        (state, action: PayloadAction<ServerResponse<Partial<Action>>>) => {
          state[0].loading = false;
          state[0].data = action.payload;
          state[0].error = null;
        }
      )
      .addCase(fetchActions.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.payload?.toString() ?? action.error.message ?? "Failed to fetch actions";
      })
      .addCase(createAction.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(createAction.fulfilled, (state, action: PayloadAction<Partial<Action> | undefined>) => {
        state[0].loading = false;
        state[0].error = null;
        if (action.payload) {
          state[0].data[0].data.push(action.payload);
        }
      })
      .addCase(createAction.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.payload?.toString() ?? action.error.message ?? "Failed to create action";
      })
      .addCase(updateAction.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(updateAction.fulfilled, (state, action: PayloadAction<Partial<Action> | undefined>) => {
        state[0].loading = false;
        state[0].error = null;
        if (action.payload?.id != null) {
          state[0].data[0].data = state[0].data[0].data.map((record) =>
            record.id === action.payload?.id ? { ...record, ...action.payload } : record,
          );
        }
      })
      .addCase(updateAction.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.payload?.toString() ?? action.error.message ?? "Failed to update action";
      })
      .addCase(deleteAction.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(deleteAction.fulfilled, (state, action: PayloadAction<number>) => {
        state[0].loading = false;
        state[0].error = null;
        state[0].data[0].data = state[0].data[0].data.filter((record) => record.id !== action.payload);
      })
      .addCase(deleteAction.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.payload?.toString() ?? action.error.message ?? "Failed to delete action";
      });
  },
});

export default actionSlice.reducer;
