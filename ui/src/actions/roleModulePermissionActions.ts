import { createAsyncThunk } from "@reduxjs/toolkit";
import axiosInstance from "../utils/axiosInstance";
import { ServerResponse } from "../types/general/ServerResponse";
import { RoleModulePermission } from "../types/permissions/RoleModulePermission";

export const fetchRoleModulePermissions = createAsyncThunk(
  "roleModulePermissions/fetchRoleModulePermissions",
  async (_, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get<ServerResponse<Partial<RoleModulePermission>>>(
        "/api/roleModulePermissions",
        {
          withCredentials: true,
        }
      );
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue("An unknown error occurred");
    }
  }
);

export const createRoleModulePermission = createAsyncThunk(
  "roleModulePermissions/createRoleModulePermission",
  async (payload: Partial<RoleModulePermission>, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.post<Partial<RoleModulePermission>[]>(
        "/api/roleModulePermissions",
        payload,
        {
          withCredentials: true,
        }
      );
      return response.data[0];
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue("An unknown error occurred");
    }
  }
);

export const updateRoleModulePermission = createAsyncThunk(
  "roleModulePermissions/updateRoleModulePermission",
  async (
    {
      id,
      updates,
    }: { id: number; updates: Partial<RoleModulePermission> },
    { rejectWithValue }
  ) => {
    try {
      const response = await axiosInstance.put<Partial<RoleModulePermission>[]>(
        `/api/roleModulePermissions/${id}`,
        updates,
        {
          withCredentials: true,
        }
      );
      return response.data[0];
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue("An unknown error occurred");
    }
  }
);

export const deleteRoleModulePermission = createAsyncThunk(
  "roleModulePermissions/deleteRoleModulePermission",
  async (id: number, { rejectWithValue }) => {
    try {
      await axiosInstance.delete(`/api/roleModulePermissions/${id}`, {
        withCredentials: true,
      });
      return id;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue("An unknown error occurred");
    }
  }
);
