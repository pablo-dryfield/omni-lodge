import { createAsyncThunk } from '@reduxjs/toolkit';
import axios from 'axios';
import axiosInstance from '../utils/axiosInstance';
import type { ServerResponse } from '../types/general/ServerResponse';
import type {
  NightReport,
  NightReportSummary,
  NightReportCreatePayload,
  NightReportUpdatePayload,
  NightReportPhotoUploadResponse,
} from '../types/nightReports/NightReport';

const extractErrorMessage = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string }[] | undefined;
    if (Array.isArray(data) && data[0]?.message) {
      return data[0].message;
    }
    return error.response?.statusText ?? error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'An unknown error occurred';
};

type NightReportFilters = Partial<{
  status: string;
  counterId: number;
  leaderId: number;
  from: string;
  to: string;
}>;

export const fetchNightReports = createAsyncThunk<
  ServerResponse<NightReportSummary>,
  NightReportFilters | undefined,
  { rejectValue: string }
>('nightReports/fetchNightReports', async (filters = {}, { rejectWithValue }) => {
  try {
    const response = await axiosInstance.get<ServerResponse<NightReportSummary>>('/nightReports', {
      withCredentials: true,
      params: filters,
    });
    return response.data;
  } catch (error) {
    return rejectWithValue(extractErrorMessage(error));
  }
});

export const fetchNightReportById = createAsyncThunk<
  NightReport,
  number,
  { rejectValue: string }
>('nightReports/fetchNightReportById', async (reportId, { rejectWithValue }) => {
  try {
    const response = await axiosInstance.get<NightReport[]>(`/nightReports/${reportId}`, {
      withCredentials: true,
    });
    const payload = response.data?.[0];
    if (!payload) {
      throw new Error('Night report payload missing');
    }
    return payload;
  } catch (error) {
    return rejectWithValue(extractErrorMessage(error));
  }
});

export const createNightReport = createAsyncThunk<
  NightReport,
  NightReportCreatePayload,
  { rejectValue: string }
>('nightReports/createNightReport', async (payload, { rejectWithValue }) => {
  try {
    const response = await axiosInstance.post<NightReport[]>('/nightReports', payload, {
      withCredentials: true,
    });
    const created = response.data?.[0];
    if (!created) {
      throw new Error('Night report payload missing');
    }
    return created;
  } catch (error) {
    return rejectWithValue(extractErrorMessage(error));
  }
});

export const updateNightReport = createAsyncThunk<
  NightReport,
  { reportId: number; payload: NightReportUpdatePayload },
  { rejectValue: string }
>('nightReports/updateNightReport', async ({ reportId, payload }, { rejectWithValue }) => {
  try {
    const response = await axiosInstance.patch<NightReport[]>(`/nightReports/${reportId}`, payload, {
      withCredentials: true,
    });
    const updated = response.data?.[0];
    if (!updated) {
      throw new Error('Night report payload missing');
    }
    return updated;
  } catch (error) {
    return rejectWithValue(extractErrorMessage(error));
  }
});

export const submitNightReport = createAsyncThunk<
  NightReport,
  number,
  { rejectValue: string }
>('nightReports/submitNightReport', async (reportId, { rejectWithValue }) => {
  try {
    const response = await axiosInstance.post<NightReport[]>(`/nightReports/${reportId}/submit`, null, {
      withCredentials: true,
    });
    const updated = response.data?.[0];
    if (!updated) {
      throw new Error('Night report payload missing');
    }
    return updated;
  } catch (error) {
    return rejectWithValue(extractErrorMessage(error));
  }
});

export const uploadNightReportPhoto = createAsyncThunk<
  NightReportPhotoUploadResponse,
  { reportId: number; file: File; capturedAt?: string | null },
  { rejectValue: string }
>('nightReports/uploadNightReportPhoto', async ({ reportId, file, capturedAt }, { rejectWithValue }) => {
  try {
    const formData = new FormData();
    formData.append('file', file);
    if (capturedAt) {
      formData.append('capturedAt', capturedAt);
    }
    const response = await axiosInstance.post<NightReportPhotoUploadResponse[]>(
      `/nightReports/${reportId}/photos`,
      formData,
      {
        withCredentials: true,
        headers: { 'Content-Type': 'multipart/form-data' },
      },
    );
    const uploaded = response.data?.[0];
    if (!uploaded) {
      throw new Error('Photo payload missing');
    }
    return uploaded;
  } catch (error) {
    return rejectWithValue(extractErrorMessage(error));
  }
});

export const deleteNightReportPhoto = createAsyncThunk<
  { reportId: number; photoId: number },
  { reportId: number; photoId: number },
  { rejectValue: string }
>('nightReports/deleteNightReportPhoto', async ({ reportId, photoId }, { rejectWithValue }) => {
  try {
    await axiosInstance.delete(`/nightReports/${reportId}/photos/${photoId}`, {
      withCredentials: true,
    });
    return { reportId, photoId };
  } catch (error) {
    return rejectWithValue(extractErrorMessage(error));
  }
});

