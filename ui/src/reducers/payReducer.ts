import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { type Pay } from '../types/pays/Pay';
import { type DataState } from '../types/general/DataState';
import { type ServerResponse } from '../types/general/ServerResponse';
import { fetchPays } from '../actions/payActions';

const initialState: DataState<Pay> = [
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

const paySlice = createSlice({
  name: 'pays',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchPays.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(fetchPays.fulfilled, (state, action: PayloadAction<ServerResponse<Pay>>) => {
        state[0].loading = false;
        state[0].data = action.payload;
        state[0].error = null;
      })
      .addCase(fetchPays.rejected, (state, action) => {
        state[0].loading = false;
        const payloadMessage = (action.payload as string) ?? null;
        state[0].error = payloadMessage ?? action.error.message ?? 'Failed to fetch pays';
      });
  },
});

export default paySlice.reducer;
