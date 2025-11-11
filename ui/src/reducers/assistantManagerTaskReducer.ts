import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { DataState } from '../types/general/DataState';
import type { ServerResponse } from '../types/general/ServerResponse';
import type {
  AssistantManagerTaskTemplate,
  AssistantManagerTaskLog,
} from '../types/assistantManagerTasks/AssistantManagerTask';
import { fetchAmTaskTemplates, fetchAmTaskLogs } from '../actions/assistantManagerTaskActions';

type TaskState = {
  templates: DataState<AssistantManagerTaskTemplate>;
  logs: DataState<AssistantManagerTaskLog>;
};

const initialState: TaskState = {
  templates: [
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
  ],
  logs: [
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
  ],
};

const assistantManagerTaskSlice = createSlice({
  name: 'assistantManagerTasks',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchAmTaskTemplates.pending, (state) => {
        state.templates[0].loading = true;
      })
      .addCase(fetchAmTaskTemplates.fulfilled, (state, action: PayloadAction<ServerResponse<AssistantManagerTaskTemplate>>) => {
        state.templates[0].loading = false;
        state.templates[0].data = action.payload;
        state.templates[0].error = null;
      })
      .addCase(fetchAmTaskTemplates.rejected, (state, action) => {
        state.templates[0].loading = false;
        state.templates[0].error = action.payload ? String(action.payload) : action.error.message ?? 'Failed to load templates';
      })
      .addCase(fetchAmTaskLogs.pending, (state) => {
        state.logs[0].loading = true;
      })
      .addCase(fetchAmTaskLogs.fulfilled, (state, action: PayloadAction<ServerResponse<AssistantManagerTaskLog>>) => {
        state.logs[0].loading = false;
        state.logs[0].data = action.payload;
        state.logs[0].error = null;
      })
      .addCase(fetchAmTaskLogs.rejected, (state, action) => {
        state.logs[0].loading = false;
        state.logs[0].error = action.payload ? String(action.payload) : action.error.message ?? 'Failed to load logs';
      });
  },
});

export default assistantManagerTaskSlice.reducer;
