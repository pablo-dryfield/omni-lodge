import { createAsyncThunk } from "@reduxjs/toolkit";
import axiosInstance from "../utils/axiosInstance";
import { ServerResponse } from "../types/general/ServerResponse";
import { Action } from "../types/actions/Action";

const unwrapSingle = <T>(payload: T | T[]): T => (Array.isArray(payload) ? payload[0] : payload);

export const fetchActions = createAsyncThunk(
  "actions/fetchActions",
  async (_, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get<ServerResponse<Partial<Action>>>(
        "/actions",
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

export const createAction = createAsyncThunk(
  "actions/createAction",
  async (payload: Partial<Action>, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.post<Partial<Action> | Partial<Action>[]>("/actions", payload, {
        withCredentials: true,
      });
      return unwrapSingle(response.data);
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue("An unknown error occurred");
    }
  },
);

export const updateAction = createAsyncThunk(
  "actions/updateAction",
  async (
    { actionId, payload }: { actionId: number; payload: Partial<Action> },
    { rejectWithValue },
  ) => {
    try {
      const response = await axiosInstance.put<Partial<Action> | Partial<Action>[]>(`/actions/${actionId}`, payload, {
        withCredentials: true,
      });
      return unwrapSingle(response.data);
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue("An unknown error occurred");
    }
  },
);

export const deleteAction = createAsyncThunk(
  "actions/deleteAction",
  async (actionId: number, { rejectWithValue }) => {
    try {
      await axiosInstance.delete(`/actions/${actionId}`, {
        withCredentials: true,
      });
      return actionId;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue("An unknown error occurred");
    }
  },
);
