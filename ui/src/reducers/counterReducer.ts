import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { Counter } from '../types/counters/Counter';
import { DataState } from '../types/general/DataState';
import { type ServerResponse } from '../types/general/ServerResponse';
import { fetchCounters, createCounter, updateCounter, deleteCounter } from '../actions/counterActions'; // Import thunks

// Define the initial state using that type
const initialState: DataState<Partial<Counter>> = [{
  loading: false,
  data: [{
    data: [],
    columns: []
  }],
  error: null,
}];

const counterSlice = createSlice({
  name: 'counters',
  initialState,
  reducers: {
    setCountersData(state, action: PayloadAction<ServerResponse<Partial<Counter>>>) {
      state[0].loading = false;
      state[0].data = action.payload;
      state[0].error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch Counters
      .addCase(fetchCounters.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(fetchCounters.fulfilled, (state, action: PayloadAction<ServerResponse<Partial<Counter>>>) => {
        state[0].loading = false;
        state[0].data = action.payload;
        state[0].error = null;
      })
      .addCase(fetchCounters.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || 'Failed to fetch counters';
      })
      
      // Create Counter
      .addCase(createCounter.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(createCounter.fulfilled, (state, action: PayloadAction<Partial<Counter>>) => {
        state[0].loading = false;
        state[0].data[0].data.push(action.payload);
        state[0].error = null;
      })
      .addCase(createCounter.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || 'Failed to create counter';
      })
      
      // Update Counter
      .addCase(updateCounter.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(updateCounter.fulfilled, (state, action: PayloadAction<Partial<Counter>>) => {
        state[0].loading = false;
        state[0].data[0].data = state[0].data[0].data.map(counter => 
          counter.id === action.payload.id ? action.payload : counter
        );
        state[0].error = null;
      })
      .addCase(updateCounter.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || 'Failed to update counter';
      })
      
      // Delete Counter
      .addCase(deleteCounter.pending, (state) => {
        state[0].loading = true;
      })
      
      .addCase(deleteCounter.fulfilled, (state, action: PayloadAction<number>) => {
        state[0].loading = false;
        state[0].data[0].data = state[0].data[0].data.filter(counter => counter.id !== action.payload);
        state[0].error = null;
      })
      .addCase(deleteCounter.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || 'Failed to delete counter';
      });
  },
});

export const { setCountersData } = counterSlice.actions;
export default counterSlice.reducer;
