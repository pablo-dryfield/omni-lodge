import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { DataState } from '../types/general/DataState';
import type { ServerResponse } from '../types/general/ServerResponse';
import type { CompensationComponent } from '../types/compensation/CompensationComponent';
import { fetchCompensationComponents } from '../actions/compensationComponentActions';

const initialState: DataState<CompensationComponent> = [
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

const compensationComponentSlice = createSlice({
  name: 'compensationComponents',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchCompensationComponents.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(fetchCompensationComponents.fulfilled, (state, action: PayloadAction<ServerResponse<CompensationComponent>>) => {
        state[0].loading = false;
        state[0].data = action.payload;
        state[0].error = null;
      })
      .addCase(fetchCompensationComponents.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.payload ? String(action.payload) : action.error.message ?? 'Failed to load components';
      });
  },
});

export default compensationComponentSlice.reducer;
