import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { CounterUser } from '../types/counterUsers/CounterUser';
import { DataState } from '../types/general/DataState';
import { type ServerResponse } from '../types/general/ServerResponse';
import { fetchCounterUsers, createCounterUser, updateCounterUser, deleteCounterUser } from '../actions/counterUserActions'; // Import thunks

// Define the initial state using that type
const initialState: DataState<Partial<CounterUser>> = [{
  loading: false,
  data: [{
    data: [],
    columns: []
  }],
  error: null,
}];

const counterUserSlice = createSlice({
  name: 'counterUsers',
  initialState,
  reducers: {
    // Synchronous actions (if any)
  },
  extraReducers: (builder) => {
    builder
      // Fetch CounterUsers
      .addCase(fetchCounterUsers.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(fetchCounterUsers.fulfilled, (state, action: PayloadAction<ServerResponse<Partial<CounterUser>>>) => {
        state[0].loading = false;
        state[0].data = action.payload;
        state[0].error = null;
      })
      .addCase(fetchCounterUsers.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || 'Failed to fetch counterUsers';
      })
      
      // Create CounterUser
      .addCase(createCounterUser.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(createCounterUser.fulfilled, (state, action: PayloadAction<Partial<CounterUser>>) => {
        state[0].loading = false;
        state[0].data[0].data.push(action.payload);
        state[0].error = null;
      })
      .addCase(createCounterUser.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || 'Failed to create counterUser';
      })
      
      // Update CounterUser
      .addCase(updateCounterUser.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(updateCounterUser.fulfilled, (state, action: PayloadAction<Partial<CounterUser>>) => {
        state[0].loading = false;
        state[0].data[0].data = state[0].data[0].data.map(counterUser => 
          counterUser.id === action.payload.id ? action.payload : counterUser
        );
        state[0].error = null;
      })
      .addCase(updateCounterUser.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || 'Failed to update counterUser';
      })
      
      // Delete CounterUser
      .addCase(deleteCounterUser.pending, (state) => {
        state[0].loading = true;
      })
      
      .addCase(deleteCounterUser.fulfilled, (state, action: PayloadAction<number>) => {
        state[0].loading = false;
        state[0].data[0].data = state[0].data[0].data.filter(counterUser => counterUser.id !== action.payload);
        state[0].error = null;
      })
      .addCase(deleteCounterUser.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || 'Failed to delete counterUser';
      });
  },
});

export default counterUserSlice.reducer;
