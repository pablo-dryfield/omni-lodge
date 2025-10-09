import { createAsyncThunk, createSlice, type PayloadAction } from '@reduxjs/toolkit';

import axiosInstance from '../utils/axiosInstance';
import { buildMetricKey, normalizeMetric } from '../utils/counterMetrics';
import type {
  AddonConfig,
  ChannelConfig,
  CounterRegistryPayload,
  CounterStatus,
  CounterSummary,
  MetricCell,
  StaffOption,
} from '../types/counters/CounterRegistry';
import type { RootState } from './store';

type CounterRegistryState = {
  loading: boolean;
  error: string | null;
  counter: CounterRegistryPayload | null;
  channels: ChannelConfig[];
  addons: AddonConfig[];
  summary: CounterSummary | null;
  metricsByKey: Record<string, MetricCell>;
  dirtyMetricKeys: string[];
  savingMetrics: boolean;
  savingStaff: boolean;
  savingStatus: boolean;
  savingProduct: boolean;
  savingNotes: boolean;
};

type EnsureCounterPayload = {
  date: string;
  userId: number;
  productId?: number | null;
  notes?: string | null;
};

type UpdateCounterProductArgs = {
  counterId: number;
  productId: number | null;
};

type UpdateCounterManagerArgs = {
  counterId: number;
  userId: number;
};

type UpdateCounterStatusArgs = {
  counterId: number;
  status: CounterStatus;
};

type UpdateCounterStaffArgs = {
  counterId: number;
  userIds: number[];
};

type FlushMetricsResult = {
  metrics: MetricCell[];
  derivedSummary: CounterSummary | null;
};

const initialState: CounterRegistryState = {
  loading: false,
  error: null,
  counter: null,
  channels: [],
  addons: [],
  summary: null,
  metricsByKey: {},
  dirtyMetricKeys: [],
  savingMetrics: false,
  savingStaff: false,
  savingStatus: false,
  savingProduct: false,
  savingNotes: false,
};

const withCredentialsConfig = { withCredentials: true };

const ingestPayload = (state: CounterRegistryState, payload: CounterRegistryPayload) => {
  const normalizedMetrics = payload.metrics.map(normalizeMetric);
  state.counter = {
    ...payload,
    metrics: normalizedMetrics,
    staff: payload.staff.map((member) => ({ ...member })),
  };
  state.channels = payload.channels.map((channel) => ({ ...channel }));
  state.addons = payload.addons.map((addon) => ({ ...addon }));
  state.summary = payload.derivedSummary;
  state.metricsByKey = {};
  state.dirtyMetricKeys = [];
  state.error = null;
};

export const ensureCounterForDate = createAsyncThunk<
  CounterRegistryPayload,
  EnsureCounterPayload,
  { rejectValue: string }
>('counterRegistry/ensureCounterForDate', async (params, { rejectWithValue }) => {
  try {
    const response = await axiosInstance.post<CounterRegistryPayload>(
      '/counters?format=registry',
      params,
      withCredentialsConfig,
    );
    return response.data;
  } catch (error) {
    if (error instanceof Error) {
      return rejectWithValue(error.message);
    }
    return rejectWithValue('Failed to ensure counter for date');
  }
});

export const fetchCounterByDate = createAsyncThunk<
  CounterRegistryPayload,
  string,
  { rejectValue: string }
>('counterRegistry/fetchCounterByDate', async (date, { rejectWithValue }) => {
  try {
    const response = await axiosInstance.get<CounterRegistryPayload>('/counters', {
      params: { format: 'registry', date },
      withCredentials: true,
    });
    return response.data;
  } catch (error) {
    if (error instanceof Error) {
      return rejectWithValue(error.message);
    }
    return rejectWithValue('Failed to load counter for date');
  }
});

export const updateCounterProduct = createAsyncThunk<
  CounterRegistryPayload,
  UpdateCounterProductArgs,
  { rejectValue: string }
>('counterRegistry/updateProduct', async ({ counterId, productId }, { rejectWithValue }) => {
  try {
    const response = await axiosInstance.patch<CounterRegistryPayload>(
      `/counters/${counterId}?format=registry`,
      { productId },
      withCredentialsConfig,
    );
    return response.data;
  } catch (error) {
    if (error instanceof Error) {
      return rejectWithValue(error.message);
    }
    return rejectWithValue('Failed to update product');
  }
});

export const updateCounterManager = createAsyncThunk<
  CounterRegistryPayload,
  UpdateCounterManagerArgs,
  { rejectValue: string }
>('counterRegistry/updateManager', async ({ counterId, userId }, { rejectWithValue }) => {
  try {
    const response = await axiosInstance.patch<CounterRegistryPayload>(
      `/counters/${counterId}?format=registry`,
      { userId },
      withCredentialsConfig,
    );
    return response.data;
  } catch (error) {
    if (error instanceof Error) {
      return rejectWithValue(error.message);
    }
    return rejectWithValue('Failed to update manager');
  }
});

export const updateCounterStatus = createAsyncThunk<
  CounterRegistryPayload,
  UpdateCounterStatusArgs,
  { rejectValue: string }
>('counterRegistry/updateStatus', async ({ counterId, status }, { rejectWithValue }) => {
  try {
    const response = await axiosInstance.patch<CounterRegistryPayload>(
      `/counters/${counterId}?format=registry`,
      { status },
      withCredentialsConfig,
    );
    return response.data;
  } catch (error) {
    if (error instanceof Error) {
      return rejectWithValue(error.message);
    }
    return rejectWithValue('Failed to update counter status');
  }
});

export const updateCounterStaff = createAsyncThunk<
  CounterRegistryPayload,
  UpdateCounterStaffArgs,
  { rejectValue: string }
>('counterRegistry/updateStaff', async ({ counterId, userIds }, { rejectWithValue }) => {
  try {
    const response = await axiosInstance.patch<CounterRegistryPayload>(
      `/counters/${counterId}/staff?format=registry`,
      { userIds },
      withCredentialsConfig,
    );
    return response.data;
  } catch (error) {
    if (error instanceof Error) {
      return rejectWithValue(error.message);
    }
    return rejectWithValue('Failed to update counter staff');
  }
});

export const flushDirtyMetrics = createAsyncThunk<
  FlushMetricsResult,
  void,
  { state: RootState; rejectValue: string }
>('counterRegistry/flushDirtyMetrics', async (_, { getState, rejectWithValue }) => {
  const state = getState().counterRegistry;
  const counterId = state.counter?.counter.id;
  if (!counterId) {
    return {
      metrics: state.counter?.metrics ?? [],
      derivedSummary: state.summary ?? null,
    };
  }

  if (state.dirtyMetricKeys.length === 0) {
    return {
      metrics: state.counter?.metrics ?? [],
      derivedSummary: state.summary ?? null,
    };
  }

  const rows = state.dirtyMetricKeys
    .map((key) => state.metricsByKey[key])
    .filter((metric): metric is MetricCell => Boolean(metric))
    .map((metric) => ({
      channelId: metric.channelId,
      kind: metric.kind,
      addonId: metric.addonId,
      tallyType: metric.tallyType,
      period: metric.period,
      qty: metric.qty,
    }));

  if (rows.length === 0) {
    return {
      metrics: state.counter?.metrics ?? [],
      derivedSummary: state.summary ?? null,
    };
  }

  try {
    const response = await axiosInstance.put<FlushMetricsResult>(
      `/counters/${counterId}/metrics?format=registry`,
      rows,
      withCredentialsConfig,
    );
    return {
      metrics: response.data.metrics.map(normalizeMetric),
      derivedSummary: response.data.derivedSummary,
    };
  } catch (error) {
    if (error instanceof Error) {
      return rejectWithValue(error.message);
    }
    return rejectWithValue('Failed to save counter metrics');
  }
});

const counterRegistrySlice = createSlice({
  name: 'counterRegistry',
  initialState,
  reducers: {
    clearCounter: (state) => {
      state.counter = null;
      state.channels = [];
      state.addons = [];
      state.summary = null;
      state.metricsByKey = {};
      state.dirtyMetricKeys = [];
      state.error = null;
    },
    clearDirtyMetrics: (state) => {
      state.metricsByKey = {};
      state.dirtyMetricKeys = [];
    },
    setMetric: (state, action: PayloadAction<MetricCell>) => {
      const metric = normalizeMetric(action.payload);
      const key = buildMetricKey(metric);
      state.metricsByKey[key] = metric;
      if (!state.dirtyMetricKeys.includes(key)) {
        state.dirtyMetricKeys.push(key);
      }

      if (state.counter) {
        const existingIndex = state.counter.metrics.findIndex(
          (existing) => buildMetricKey(existing) === key,
        );
        if (existingIndex >= 0) {
          state.counter.metrics[existingIndex] = metric;
        } else {
          state.counter.metrics.push(metric);
        }
      }
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(ensureCounterForDate.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(ensureCounterForDate.fulfilled, (state, action) => {
        state.loading = false;
        ingestPayload(state, action.payload);
      })
      .addCase(ensureCounterForDate.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload ?? action.error.message ?? 'Failed to ensure counter';
      })
      .addCase(fetchCounterByDate.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchCounterByDate.fulfilled, (state, action) => {
        state.loading = false;
        ingestPayload(state, action.payload);
      })
      .addCase(fetchCounterByDate.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload ?? action.error.message ?? 'Failed to load counter';
      })
      .addCase(updateCounterProduct.pending, (state) => {
        state.savingProduct = true;
        state.error = null;
      })
      .addCase(updateCounterProduct.fulfilled, (state, action) => {
        state.savingProduct = false;
        ingestPayload(state, action.payload);
      })
      .addCase(updateCounterProduct.rejected, (state, action) => {
        state.savingProduct = false;
        state.error = action.payload ?? action.error.message ?? 'Failed to update product';
      })
      .addCase(updateCounterManager.pending, (state) => {
        state.loading = true;
      })
      .addCase(updateCounterManager.fulfilled, (state, action) => {
        state.loading = false;
        ingestPayload(state, action.payload);
      })
      .addCase(updateCounterManager.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload ?? action.error.message ?? 'Failed to update manager';
      })
      .addCase(updateCounterStatus.pending, (state) => {
        state.savingStatus = true;
      })
      .addCase(updateCounterStatus.fulfilled, (state, action) => {
        state.savingStatus = false;
        ingestPayload(state, action.payload);
      })
      .addCase(updateCounterStatus.rejected, (state, action) => {
        state.savingStatus = false;
        state.error = action.payload ?? action.error.message ?? 'Failed to update status';
      })
      .addCase(updateCounterStaff.pending, (state) => {
        state.savingStaff = true;
      })
      .addCase(updateCounterStaff.fulfilled, (state, action) => {
        state.savingStaff = false;
        ingestPayload(state, action.payload);
      })
      .addCase(updateCounterStaff.rejected, (state, action) => {
        state.savingStaff = false;
        state.error = action.payload ?? action.error.message ?? 'Failed to update staff';
      })
      .addCase(flushDirtyMetrics.pending, (state) => {
        state.savingMetrics = true;
      })
      .addCase(flushDirtyMetrics.fulfilled, (state, action) => {
        state.savingMetrics = false;
        const payload = action.payload;
        if (state.counter) {
          state.counter.metrics = payload.metrics.map(normalizeMetric);
        }
        state.summary = payload.derivedSummary;
        state.metricsByKey = {};
        state.dirtyMetricKeys = [];
      })
      .addCase(flushDirtyMetrics.rejected, (state, action) => {
        state.savingMetrics = false;
        state.error = action.payload ?? action.error.message ?? 'Failed to save metrics';
      });
  },
});

export const { clearCounter, clearDirtyMetrics, setMetric } = counterRegistrySlice.actions;

export const selectCounterRegistry = (state: RootState) => state.counterRegistry;

export default counterRegistrySlice.reducer;
