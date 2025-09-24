import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { RoleModulePermission } from "../types/permissions/RoleModulePermission";
import { DataState } from "../types/general/DataState";
import { ServerResponse } from "../types/general/ServerResponse";
import {
  createRoleModulePermission,
  deleteRoleModulePermission,
  fetchRoleModulePermissions,
  updateRoleModulePermission,
} from "../actions/roleModulePermissionActions";

const initialState: DataState<Partial<RoleModulePermission>> = [
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

const roleModulePermissionSlice = createSlice({
  name: "roleModulePermissions",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchRoleModulePermissions.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(
        fetchRoleModulePermissions.fulfilled,
        (state, action: PayloadAction<ServerResponse<Partial<RoleModulePermission>>>) => {
          state[0].loading = false;
          state[0].data = action.payload;
          state[0].error = null;
        }
      )
      .addCase(fetchRoleModulePermissions.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || "Failed to fetch module permissions";
      })
      .addCase(createRoleModulePermission.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(
        createRoleModulePermission.fulfilled,
        (state, action: PayloadAction<Partial<RoleModulePermission> | undefined>) => {
          state[0].loading = false;
          if (action.payload) {
            state[0].data[0].data.push(action.payload);
          }
          state[0].error = null;
        }
      )
      .addCase(createRoleModulePermission.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || "Failed to create module permission";
      })
      .addCase(updateRoleModulePermission.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(
        updateRoleModulePermission.fulfilled,
        (state, action: PayloadAction<Partial<RoleModulePermission> | undefined>) => {
          state[0].loading = false;
          if (action.payload?.id !== undefined) {
            state[0].data[0].data = state[0].data[0].data.map((record) =>
              record.id === action.payload?.id ? action.payload : record
            );
          }
          state[0].error = null;
        }
      )
      .addCase(updateRoleModulePermission.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || "Failed to update module permission";
      })
      .addCase(deleteRoleModulePermission.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(deleteRoleModulePermission.fulfilled, (state, action: PayloadAction<number>) => {
        state[0].loading = false;
        state[0].data[0].data = state[0].data[0].data.filter((record) => record.id !== action.payload);
        state[0].error = null;
      })
      .addCase(deleteRoleModulePermission.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || "Failed to delete module permission";
      });
  },
});

export default roleModulePermissionSlice.reducer;
