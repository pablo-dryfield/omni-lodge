import { createAsyncThunk } from "@reduxjs/toolkit";
import axiosInstance from "../utils/axiosInstance";
import { ServerResponse } from "../types/general/ServerResponse";
import { Module } from "../types/modules/Module";

export const fetchModules = createAsyncThunk(
  "modules/fetchModules",
  async (_, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get<ServerResponse<Partial<Module>>>("/api/modules", {
        withCredentials: true,
      });
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue("An unknown error occurred");
    }
  }
);

export const createModule = createAsyncThunk(
  "modules/createModule",
  async (moduleData: Partial<Module>, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.post<Partial<Module>[]>("/api/modules", moduleData, {
        withCredentials: true,
      });
      return response.data[0];
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue("An unknown error occurred");
    }
  }
);

export const updateModule = createAsyncThunk(
  "modules/updateModule",
  async (
    { moduleId, moduleData }: { moduleId: number; moduleData: Partial<Module> },
    { rejectWithValue }
  ) => {
    try {
      const response = await axiosInstance.put<Partial<Module>[]>(
        `/api/modules/${moduleId}`,
        moduleData,
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

export const deleteModule = createAsyncThunk(
  "modules/deleteModule",
  async (moduleId: number, { rejectWithValue }) => {
    try {
      await axiosInstance.delete(`/api/modules/${moduleId}`, {
        withCredentials: true,
      });
      return moduleId;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue("An unknown error occurred");
    }
  }
);
