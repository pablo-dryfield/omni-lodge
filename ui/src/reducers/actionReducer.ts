import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { Action } from "../types/actions/Action";
import { DataState } from "../types/general/DataState";
import { ServerResponse } from "../types/general/ServerResponse";
import { fetchActions } from "../actions/actionActions";

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
        state[0].error = action.error.message || "Failed to fetch actions";
      });
  },
});

export default actionSlice.reducer;
