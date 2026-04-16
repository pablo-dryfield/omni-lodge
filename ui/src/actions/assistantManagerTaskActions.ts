import { createAsyncThunk } from '@reduxjs/toolkit';
import axios from 'axios';
import axiosInstance from '../utils/axiosInstance';
import type {
  AssistantManagerTaskTemplate,
  AssistantManagerTaskAssignment,
  AssistantManagerTaskLog,
  ManualAssistantManagerTaskPayload,
  TaskLogMetaUpdatePayload,
  UploadAmTaskEvidenceImageResponse,
} from '../types/assistantManagerTasks/AssistantManagerTask';
import type { ServerResponse } from '../types/general/ServerResponse';

const extractApiErrorMessage = (error: unknown, fallbackMessage: string) => {
  if (axios.isAxiosError(error)) {
    const responseData = error.response?.data;
    if (typeof responseData === 'string' && responseData.trim()) {
      return responseData.trim();
    }
    if (Array.isArray(responseData)) {
      const firstMessage = responseData.find(
        (entry) =>
          entry &&
          typeof entry === 'object' &&
          'message' in entry &&
          typeof (entry as { message?: unknown }).message === 'string',
      ) as { message: string } | undefined;
      if (firstMessage?.message?.trim()) {
        return firstMessage.message.trim();
      }
    }
    if (
      responseData &&
      typeof responseData === 'object' &&
      'message' in responseData &&
      typeof (responseData as { message?: unknown }).message === 'string'
    ) {
      const message = (responseData as { message: string }).message.trim();
      if (message) {
        return message;
      }
    }
    if (error.message?.trim()) {
      return error.message.trim();
    }
    return fallbackMessage;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }

  return fallbackMessage;
};

const extractEnvelopeData = <T>(payload: unknown): T | null => {
  if (Array.isArray(payload)) {
    const first = payload[0] as { data?: unknown } | undefined;
    if (first && typeof first === 'object' && 'data' in first) {
      return (first.data as T) ?? null;
    }
  }
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return ((payload as { data?: unknown }).data as T) ?? null;
  }
  return null;
};

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

export const bulkCreateAmTaskAssignments = createAsyncThunk(
  'assistantManagerTasks/bulkCreateAssignments',
  async (
    {
      templateIds,
      payload,
    }: { templateIds: number[]; payload: Partial<AssistantManagerTaskAssignment> },
    { rejectWithValue },
  ) => {
    try {
      const response = await axiosInstance.post(
        '/assistantManagerTasks/templates/assignments/bulk',
        { templateIds, payload },
        { withCredentials: true },
      );
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('Failed to bulk create task assignments');
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

export type SyncAmTaskLogsWithTemplateConfigResponse = {
  startDate: string;
  endDate: string;
  totalCount: number;
  updatedCount: number;
  unchangedCount: number;
  skippedManualCount: number;
  skippedMissingTemplateCount: number;
  skippedInvalidDateCount: number;
};

export const syncAmTaskLogsWithTemplateConfig = async (
  params: { startDate: string; endDate: string; templateId?: number | null },
): Promise<SyncAmTaskLogsWithTemplateConfigResponse> => {
  try {
    const response = await axiosInstance.post(
      '/assistantManagerTasks/logs/sync-template-config',
      {
        startDate: params.startDate,
        endDate: params.endDate,
        templateId: params.templateId ?? null,
      },
      { withCredentials: true },
    );
    const data = extractEnvelopeData<Partial<SyncAmTaskLogsWithTemplateConfigResponse>>(
      response.data,
    );
    return {
      startDate:
        typeof data?.startDate === 'string' ? data.startDate : params.startDate,
      endDate: typeof data?.endDate === 'string' ? data.endDate : params.endDate,
      totalCount:
        typeof data?.totalCount === 'number' ? data.totalCount : 0,
      updatedCount:
        typeof data?.updatedCount === 'number' ? data.updatedCount : 0,
      unchangedCount:
        typeof data?.unchangedCount === 'number' ? data.unchangedCount : 0,
      skippedManualCount:
        typeof data?.skippedManualCount === 'number'
          ? data.skippedManualCount
          : 0,
      skippedMissingTemplateCount:
        typeof data?.skippedMissingTemplateCount === 'number'
          ? data.skippedMissingTemplateCount
          : 0,
      skippedInvalidDateCount:
        typeof data?.skippedInvalidDateCount === 'number'
          ? data.skippedInvalidDateCount
          : 0,
    };
  } catch (error) {
    throw new Error(
      extractApiErrorMessage(error, 'Failed to update existing task logs'),
    );
  }
};

export const updateAmTaskLogStatus = createAsyncThunk(
  'assistantManagerTasks/updateLog',
  async ({ logId, payload }: { logId: number; payload: Partial<AssistantManagerTaskLog> }, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.put(`/assistantManagerTasks/logs/${logId}`, payload, { withCredentials: true });
      return response.data;
    } catch (error) {
      return rejectWithValue(extractApiErrorMessage(error, 'Failed to update task log'));
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
      return rejectWithValue(extractApiErrorMessage(error, 'Failed to update task log metadata'));
    }
  },
);

export const uploadAmTaskEvidenceImage = createAsyncThunk(
  'assistantManagerTasks/uploadEvidenceImage',
  async (
    {
      logId,
      ruleKey,
      file,
    }: { logId: number; ruleKey: string; file: File },
    { rejectWithValue },
  ) => {
    try {
      const formData = new FormData();
      formData.append('ruleKey', ruleKey);
      formData.append('file', file);
      const response = await axiosInstance.post<UploadAmTaskEvidenceImageResponse[]>(
        `/assistantManagerTasks/logs/${logId}/evidence-files`,
        formData,
        {
          withCredentials: true,
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        },
      );
      return response.data;
    } catch (error) {
      return rejectWithValue(extractApiErrorMessage(error, 'Failed to upload task evidence image'));
    }
  },
);

export type AmTaskPushConfig = {
  enabled: boolean;
  publicKey: string | null;
};

export const fetchAmTaskPushConfig = async (): Promise<AmTaskPushConfig> => {
  const response = await axiosInstance.get('/assistantManagerTasks/push/config', {
    withCredentials: true,
  });
  const data = extractEnvelopeData<Partial<AmTaskPushConfig>>(response.data);
  return {
    enabled: data?.enabled === true,
    publicKey:
      typeof data?.publicKey === 'string' && data.publicKey.trim()
        ? data.publicKey.trim()
        : null,
  };
};

export const saveAmTaskPushSubscription = async (
  subscription: PushSubscriptionJSON,
): Promise<void> => {
  await axiosInstance.put(
    '/assistantManagerTasks/push/subscription',
    { subscription },
    { withCredentials: true },
  );
};

export const removeAmTaskPushSubscription = async (
  endpoint: string,
): Promise<void> => {
  await axiosInstance.delete('/assistantManagerTasks/push/subscription', {
    withCredentials: true,
    data: { endpoint },
  });
};

export type AmTaskPushTestResponse = {
  userId: number;
  sent: boolean;
};

export const sendAmTaskPushTestNotification = async (
  userId: number,
): Promise<AmTaskPushTestResponse> => {
  const response = await axiosInstance.post(
    '/assistantManagerTasks/push/test',
    { userId },
    { withCredentials: true },
  );
  const data = extractEnvelopeData<Partial<AmTaskPushTestResponse>>(response.data);
  return {
    userId: typeof data?.userId === 'number' ? data.userId : userId,
    sent: data?.sent === true,
  };
};
