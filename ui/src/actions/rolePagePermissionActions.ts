import { createAsyncThunk } from "@reduxjs/toolkit";
import axiosInstance from "../utils/axiosInstance";
import { ServerResponse } from "../types/general/ServerResponse";
import { RolePagePermission } from "../types/permissions/RolePagePermission";

export const fetchRolePagePermissions = createAsyncThunk(
  "rolePagePermissions/fetchRolePagePermissions",
  async (_, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get<ServerResponse<Partial<RolePagePermission>>>(
        "/api/rolePagePermissions",
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

export const createRolePagePermission = createAsyncThunk(
  "rolePagePermissions/createRolePagePermission",
  async (payload: Partial<RolePagePermission>, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.post<Partial<RolePagePermission>[]>(
        "/api/rolePagePermissions",
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

export const updateRolePagePermission = createAsyncThunk(
  "rolePagePermissions/updateRolePagePermission",
  async (
    {
      id,
      updates,
    }: { id: number; updates: Partial<RolePagePermission> },
    { rejectWithValue }
  ) => {
    try {
      const response = await axiosInstance.put<Partial<RolePagePermission>[]>(
        `/api/rolePagePermissions/${id}`,
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

export const deleteRolePagePermission = createAsyncThunk(
  "rolePagePermissions/deleteRolePagePermission",
  async (id: number, { rejectWithValue }) => {
    try {
      await axiosInstance.delete(`/api/rolePagePermissions/${id}`, {
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
