import { createAsyncThunk } from '@reduxjs/toolkit';
import axiosInstance from '../utils/axiosInstance';
import type {
  AssistantManagerTaskTemplate,
  AssistantManagerTaskAssignment,
  AssistantManagerTaskLog,
  ManualAssistantManagerTaskPayload,
  TaskLogMetaUpdatePayload,
} from '../types/assistantManagerTasks/AssistantManagerTask';
import type { ServerResponse } from '../types/general/ServerResponse';

export const fetchAmTaskTemplates = createAsyncThunk(
  'assistantManagerTasks/fetchTemplates',
  async (_, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get<ServerResponse<AssistantManagerTaskTemplate>>('/assistantManagerTasks/templates', {
        withCredentials: true,
      });
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('Failed to load assistant manager task templates');
    }
  },
);

export const createAmTaskTemplate = createAsyncThunk(
  'assistantManagerTasks/createTemplate',
  async (payload: Partial<AssistantManagerTaskTemplate>, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.post('/assistantManagerTasks/templates', payload, { withCredentials: true });
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('Failed to create task template');
    }
  },
);

export const updateAmTaskTemplate = createAsyncThunk(
  'assistantManagerTasks/updateTemplate',
  async ({ templateId, payload }: { templateId: number; payload: Partial<AssistantManagerTaskTemplate> }, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.put(`/assistantManagerTasks/templates/${templateId}`, payload, { withCredentials: true });
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('Failed to update task template');
    }
  },
);

export const deleteAmTaskTemplate = createAsyncThunk(
  'assistantManagerTasks/deleteTemplate',
  async (templateId: number, { rejectWithValue }) => {
    try {
      await axiosInstance.delete(`/assistantManagerTasks/templates/${templateId}`, { withCredentials: true });
      return templateId;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('Failed to delete task template');
    }
  },
);

export const createAmTaskAssignment = createAsyncThunk(
  'assistantManagerTasks/createAssignment',
  async ({ templateId, payload }: { templateId: number; payload: Partial<AssistantManagerTaskAssignment> }, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.post(`/assistantManagerTasks/templates/${templateId}/assignments`, payload, { withCredentials: true });
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('Failed to create task assignment');
    }
  },
);

export const updateAmTaskAssignment = createAsyncThunk(
  'assistantManagerTasks/updateAssignment',
  async (
    {
      templateId,
      assignmentId,
      payload,
    }: { templateId: number; assignmentId: number; payload: Partial<AssistantManagerTaskAssignment> },
    { rejectWithValue },
  ) => {
    try {
      const response = await axiosInstance.put(`/assistantManagerTasks/templates/${templateId}/assignments/${assignmentId}`, payload, {
        withCredentials: true,
      });
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('Failed to update task assignment');
    }
  },
);

export const deleteAmTaskAssignment = createAsyncThunk(
  'assistantManagerTasks/deleteAssignment',
  async ({ templateId, assignmentId }: { templateId: number; assignmentId: number }, { rejectWithValue }) => {
    try {
      await axiosInstance.delete(`/assistantManagerTasks/templates/${templateId}/assignments/${assignmentId}`, { withCredentials: true });
      return assignmentId;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('Failed to delete task assignment');
    }
  },
);

export const fetchAmTaskLogs = createAsyncThunk(
  'assistantManagerTasks/fetchLogs',
  async (params: { startDate: string; endDate: string; scope?: 'self' | 'all'; userId?: number }, { rejectWithValue }) => {
    try {
      const searchParams = new URLSearchParams({
        startDate: params.startDate,
        endDate: params.endDate,
      });
      if (params.scope) {
        searchParams.set('scope', params.scope);
      }
      if (params.userId) {
        searchParams.set('userId', String(params.userId));
      }
      const response = await axiosInstance.get<ServerResponse<AssistantManagerTaskLog>>(`/assistantManagerTasks/logs?${searchParams.toString()}`, {
        withCredentials: true,
      });
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('Failed to load task logs');
    }
  },
);

export const updateAmTaskLogStatus = createAsyncThunk(
  'assistantManagerTasks/updateLog',
  async ({ logId, payload }: { logId: number; payload: Partial<AssistantManagerTaskLog> }, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.put(`/assistantManagerTasks/logs/${logId}`, payload, { withCredentials: true });
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('Failed to update task log');
    }
  },
);

export const createManualAmTaskLog = createAsyncThunk(
  'assistantManagerTasks/createManualLog',
  async (payload: ManualAssistantManagerTaskPayload, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.post('/assistantManagerTasks/logs/manual', payload, { withCredentials: true });
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('Failed to create manual task log');
    }
  },
);

export const updateAmTaskLogMeta = createAsyncThunk(
  'assistantManagerTasks/updateLogMeta',
  async ({ logId, payload }: { logId: number; payload: TaskLogMetaUpdatePayload }, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.patch(`/assistantManagerTasks/logs/${logId}/meta`, payload, { withCredentials: true });
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('Failed to update task log metadata');
    }
  },
);
