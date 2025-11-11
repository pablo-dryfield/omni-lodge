import { createAsyncThunk } from '@reduxjs/toolkit';
import axiosInstance from '../utils/axiosInstance';
import type {
  CompensationComponent,
  CompensationComponentAssignment,
  CompensationComponentAssignmentPayload,
  CompensationComponentPayload,
} from '../types/compensation/CompensationComponent';
import type { ServerResponse } from '../types/general/ServerResponse';

export const fetchCompensationComponents = createAsyncThunk(
  'compensationComponents/fetchAll',
  async (_, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get<ServerResponse<CompensationComponent>>('/compensationComponents', {
        withCredentials: true,
      });
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('Failed to load compensation components');
    }
  },
);

export const createCompensationComponent = createAsyncThunk(
  'compensationComponents/create',
  async (payload: CompensationComponentPayload, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.post('/compensationComponents', payload, { withCredentials: true });
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('Failed to create compensation component');
    }
  },
);

export const updateCompensationComponent = createAsyncThunk(
  'compensationComponents/update',
  async (
    { componentId, payload }: { componentId: number; payload: Partial<CompensationComponentPayload> },
    { rejectWithValue },
  ) => {
    try {
      const response = await axiosInstance.put(`/compensationComponents/${componentId}`, payload, { withCredentials: true });
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('Failed to update compensation component');
    }
  },
);

export const deleteCompensationComponent = createAsyncThunk(
  'compensationComponents/delete',
  async (componentId: number, { rejectWithValue }) => {
    try {
      await axiosInstance.delete(`/compensationComponents/${componentId}`, { withCredentials: true });
      return componentId;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('Failed to delete compensation component');
    }
  },
);

export const createCompensationComponentAssignment = createAsyncThunk(
  'compensationComponents/createAssignment',
  async (
    { componentId, payload }: { componentId: number; payload: CompensationComponentAssignmentPayload },
    { rejectWithValue },
  ) => {
    try {
      const response = await axiosInstance.post(`/compensationComponents/${componentId}/assignments`, payload, {
        withCredentials: true,
      });
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('Failed to create assignment');
    }
  },
);

export const updateCompensationComponentAssignment = createAsyncThunk(
  'compensationComponents/updateAssignment',
  async (
    {
      componentId,
      assignmentId,
      payload,
    }: { componentId: number; assignmentId: number; payload: Partial<CompensationComponentAssignmentPayload> },
    { rejectWithValue },
  ) => {
    try {
      const response = await axiosInstance.put(`/compensationComponents/${componentId}/assignments/${assignmentId}`, payload, {
        withCredentials: true,
      });
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('Failed to update assignment');
    }
  },
);

export const deleteCompensationComponentAssignment = createAsyncThunk(
  'compensationComponents/deleteAssignment',
  async ({ componentId, assignmentId }: { componentId: number; assignmentId: number }, { rejectWithValue }) => {
    try {
      await axiosInstance.delete(`/compensationComponents/${componentId}/assignments/${assignmentId}`, { withCredentials: true });
      return assignmentId;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('Failed to delete assignment');
    }
  },
);
