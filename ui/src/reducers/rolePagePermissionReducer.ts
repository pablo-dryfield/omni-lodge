import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { RolePagePermission } from "../types/permissions/RolePagePermission";
import { DataState } from "../types/general/DataState";
import { ServerResponse } from "../types/general/ServerResponse";
import {
  createRolePagePermission,
  deleteRolePagePermission,
  fetchRolePagePermissions,
  updateRolePagePermission,
} from "../actions/rolePagePermissionActions";

const initialState: DataState<Partial<RolePagePermission>> = [
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

const rolePagePermissionSlice = createSlice({
  name: "rolePagePermissions",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchRolePagePermissions.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(
        fetchRolePagePermissions.fulfilled,
        (state, action: PayloadAction<ServerResponse<Partial<RolePagePermission>>>) => {
          state[0].loading = false;
          state[0].data = action.payload;
          state[0].error = null;
        }
      )
      .addCase(fetchRolePagePermissions.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || "Failed to fetch page permissions";
      })
      .addCase(createRolePagePermission.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(
        createRolePagePermission.fulfilled,
        (state, action: PayloadAction<Partial<RolePagePermission> | undefined>) => {
          state[0].loading = false;
          if (action.payload) {
            state[0].data[0].data.push(action.payload);
          }
          state[0].error = null;
        }
      )
      .addCase(createRolePagePermission.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || "Failed to create page permission";
      })
      .addCase(updateRolePagePermission.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(
        updateRolePagePermission.fulfilled,
        (state, action: PayloadAction<Partial<RolePagePermission> | undefined>) => {
          state[0].loading = false;
          if (action.payload?.id !== undefined) {
            state[0].data[0].data = state[0].data[0].data.map((record) =>
              record.id === action.payload?.id ? action.payload : record
            );
          }
          state[0].error = null;
        }
      )
      .addCase(updateRolePagePermission.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || "Failed to update page permission";
      })
      .addCase(deleteRolePagePermission.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(deleteRolePagePermission.fulfilled, (state, action: PayloadAction<number>) => {
        state[0].loading = false;
        state[0].data[0].data = state[0].data[0].data.filter((record) => record.id !== action.payload);
        state[0].error = null;
      })
      .addCase(deleteRolePagePermission.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || "Failed to delete page permission";
      });
  },
});

export default rolePagePermissionSlice.reducer;
