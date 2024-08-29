import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { Pay } from '../types/pays/Pay';
import { DataState } from '../types/general/DataState';
import { type ServerResponse } from '../types/general/ServerResponse';
import { fetchPays } from '../actions/payActions'; // Import thunks

// Define the initial state using that type
const initialState: DataState<Partial<Pay>> = [{
  loading: false,
  data: [{
    data: [],
    columns: []
  }],
  error: null,
}];

const paySlice = createSlice({
  name: 'pays',
  initialState,
  reducers: {
    // Synchronous actions (if any)
  },
  extraReducers: (builder) => {
    builder
      // Fetch Pays
      .addCase(fetchPays.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(fetchPays.fulfilled, (state, action: PayloadAction<ServerResponse<Partial<Pay>>>) => {
        state[0].loading = false;
        state[0].data = action.payload;
        state[0].error = null;
      })
      .addCase(fetchPays.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || 'Failed to fetch pays';
      })
  },
});

export default paySlice.reducer;
