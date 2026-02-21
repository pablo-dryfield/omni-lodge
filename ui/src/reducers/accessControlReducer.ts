import { createSlice } from "@reduxjs/toolkit";
import { fetchAccessSnapshot } from "../actions/accessControlActions";
import { logoutUser } from "../actions/userActions";
import { AccessControlState } from "../types/permissions/AccessControlState";

const createInitialState = (): AccessControlState => ({
  loading: false,
  loaded: false,
  error: null,
  pages: [],
  modules: {},
  openBarModeAccess: null,
});

const initialState: AccessControlState = createInitialState();

const accessControlSlice = createSlice({
  name: "accessControl",
  initialState,
  reducers: {
    resetAccessControl: () => createInitialState(),
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchAccessSnapshot.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchAccessSnapshot.fulfilled, (state, action) => {
        state.loading = false;
        state.loaded = true;
        state.error = null;
        state.pages = action.payload.pages;
        state.modules = action.payload.modules;
        state.openBarModeAccess = action.payload.openBarModeAccess ?? null;
      })
      .addCase(fetchAccessSnapshot.rejected, (state, action) => {
        state.loading = false;
        state.loaded = false;
        state.error = action.payload ?? action.error.message ?? "Failed to fetch access snapshot";
        state.pages = [];
        state.modules = {};
        state.openBarModeAccess = null;
      })
      .addCase(logoutUser.fulfilled, () => createInitialState());
  },
});

export const { resetAccessControl } = accessControlSlice.actions;
export default accessControlSlice.reducer;
