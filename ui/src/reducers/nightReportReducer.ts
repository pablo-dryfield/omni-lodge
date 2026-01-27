import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { DataState } from '../types/general/DataState';
import type { ServerResponse } from '../types/general/ServerResponse';
import type {
  NightReport,
  NightReportSummary,
  NightReportPhoto,
  NightReportPhotoUploadResponse,
} from '../types/nightReports/NightReport';
import {
  fetchNightReports,
  fetchNightReportById,
  createNightReport,
  updateNightReport,
  submitNightReport,
  uploadNightReportPhoto,
  deleteNightReportPhoto,
} from '../actions/nightReportActions';

type NightReportDetailState = {
  loading: boolean;
  data: NightReport | null;
  error: string | null;
};

type NightReportUiState = {
  saving: boolean;
  submitting: boolean;
  uploadingPhoto: boolean;
  lastError: string | null;
};

export type NightReportsState = {
  list: DataState<NightReportSummary>;
  detail: NightReportDetailState;
  ui: NightReportUiState;
};

const initialListState: DataState<NightReportSummary> = [
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

const initialState: NightReportsState = {
  list: initialListState,
  detail: {
    loading: false,
    data: null,
    error: null,
  },
  ui: {
    saving: false,
    submitting: false,
    uploadingPhoto: false,
    lastError: null,
  },
};

const nightReportSlice = createSlice({
  name: 'nightReports',
  initialState,
  reducers: {
    clearNightReportError(state) {
      state.ui.lastError = null;
    },
    setNightReportList(state, action: PayloadAction<ServerResponse<NightReportSummary>>) {
      state.list[0].loading = false;
      state.list[0].data = action.payload;
      state.list[0].error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchNightReports.pending, (state) => {
        state.list[0].loading = true;
        state.list[0].error = null;
      })
      .addCase(
        fetchNightReports.fulfilled,
        (state, action: PayloadAction<ServerResponse<NightReportSummary>>) => {
          state.list[0].loading = false;
          state.list[0].data = action.payload;
          state.list[0].error = null;
        },
      )
      .addCase(fetchNightReports.rejected, (state, action) => {
        state.list[0].loading = false;
        state.list[0].error =
          (action.payload as string | undefined) ?? action.error.message ?? 'Failed to load night reports';
      })

      .addCase(fetchNightReportById.pending, (state) => {
        state.detail.loading = true;
        state.detail.error = null;
      })
      .addCase(fetchNightReportById.fulfilled, (state, action: PayloadAction<NightReport>) => {
        state.detail.loading = false;
        state.detail.data = action.payload;
        state.detail.error = null;
      })
      .addCase(fetchNightReportById.rejected, (state, action) => {
        state.detail.loading = false;
        state.detail.error =
          (action.payload as string | undefined) ?? action.error.message ?? 'Failed to load the night report';
      })

      .addCase(createNightReport.pending, (state) => {
        state.ui.saving = true;
        state.ui.lastError = null;
      })
      .addCase(createNightReport.fulfilled, (state, action: PayloadAction<NightReport>) => {
        state.ui.saving = false;
        state.detail.data = action.payload;
        state.detail.loading = false;
      })
      .addCase(createNightReport.rejected, (state, action) => {
        state.ui.saving = false;
        state.ui.lastError =
          (action.payload as string | undefined) ?? action.error.message ?? 'Failed to create night report';
      })

      .addCase(updateNightReport.pending, (state) => {
        state.ui.saving = true;
        state.ui.lastError = null;
      })
      .addCase(updateNightReport.fulfilled, (state, action: PayloadAction<NightReport>) => {
        state.ui.saving = false;
        state.detail.data = action.payload;
        state.detail.error = null;
      })
      .addCase(updateNightReport.rejected, (state, action) => {
        state.ui.saving = false;
        state.ui.lastError =
          (action.payload as string | undefined) ?? action.error.message ?? 'Failed to update night report';
      })

      .addCase(submitNightReport.pending, (state) => {
        state.ui.submitting = true;
        state.ui.lastError = null;
      })
      .addCase(submitNightReport.fulfilled, (state, action: PayloadAction<NightReport>) => {
        state.ui.submitting = false;
        state.detail.data = action.payload;
        state.detail.error = null;
      })
      .addCase(submitNightReport.rejected, (state, action) => {
        state.ui.submitting = false;
        state.ui.lastError =
          (action.payload as string | undefined) ?? action.error.message ?? 'Failed to submit night report';
      })

      .addCase(uploadNightReportPhoto.pending, (state) => {
        state.ui.uploadingPhoto = true;
        state.ui.lastError = null;
      })
      .addCase(
        uploadNightReportPhoto.fulfilled,
        (state, action: PayloadAction<NightReportPhotoUploadResponse>) => {
        state.ui.uploadingPhoto = false;
        if (state.detail.data) {
          const nextPhoto: NightReportPhoto = {
            id: action.payload.id,
            originalName: action.payload.originalName,
            mimeType: action.payload.mimeType,
            fileSize: action.payload.fileSize,
            capturedAt: action.payload.capturedAt,
            downloadUrl: action.payload.downloadUrl,
          };
          state.detail.data.photos = [...state.detail.data.photos, nextPhoto];
        }
      })
      .addCase(uploadNightReportPhoto.rejected, (state, action) => {
        state.ui.uploadingPhoto = false;
        state.ui.lastError =
          (action.payload as string | undefined) ??
          action.error.message ??
          'Failed to upload night report photo';
      })

      .addCase(deleteNightReportPhoto.fulfilled, (state, action) => {
        if (state.detail.data) {
          state.detail.data.photos = state.detail.data.photos.filter(
            (photo) => photo.id !== action.payload.photoId,
          );
        }
      })
      .addCase(deleteNightReportPhoto.rejected, (state, action) => {
        state.ui.lastError =
          (action.payload as string | undefined) ??
          action.error.message ??
          'Failed to delete night report photo';
      });
  },
});

export const { clearNightReportError, setNightReportList } = nightReportSlice.actions;
export default nightReportSlice.reducer;
