import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { CounterProduct } from '../types/counterProducts/CounterProduct';
import { DataState } from '../types/general/DataState';
import { type ServerResponse } from '../types/general/ServerResponse';
import { fetchCounterProducts, createCounterProduct, updateCounterProduct, deleteCounterProduct } from '../actions/counterProductActions'; // Import thunks

// Define the initial state using that type
const initialState: DataState<Partial<CounterProduct>> = [{
  loading: false,
  data: [{
    data: [],
    columns: []
  }],
  error: null,
}];

const counterProductSlice = createSlice({
  name: 'counterProducts',
  initialState,
  reducers: {
    // Synchronous actions (if any)
  },
  extraReducers: (builder) => {
    builder
      // Fetch CounterProducts
      .addCase(fetchCounterProducts.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(fetchCounterProducts.fulfilled, (state, action: PayloadAction<ServerResponse<Partial<CounterProduct>>>) => {
        state[0].loading = false;
        state[0].data = action.payload;
        state[0].error = null;
      })
      .addCase(fetchCounterProducts.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || 'Failed to fetch counterProducts';
      })
      
      // Create CounterProduct
      .addCase(createCounterProduct.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(createCounterProduct.fulfilled, (state, action: PayloadAction<Partial<CounterProduct>>) => {
        state[0].loading = false;
        state[0].data[0].data.push(action.payload);
        state[0].error = null;
      })
      .addCase(createCounterProduct.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || 'Failed to create counterProduct';
      })
      
      // Update CounterProduct
      .addCase(updateCounterProduct.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(updateCounterProduct.fulfilled, (state, action: PayloadAction<Partial<CounterProduct>>) => {
        state[0].loading = false;
        state[0].data[0].data = state[0].data[0].data.map(counterProduct => 
          counterProduct.id === action.payload.id ? action.payload : counterProduct
        );
        state[0].error = null;
      })
      .addCase(updateCounterProduct.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || 'Failed to update counterProduct';
      })
      
      // Delete CounterProduct
      .addCase(deleteCounterProduct.pending, (state) => {
        state[0].loading = true;
      })
      
      .addCase(deleteCounterProduct.fulfilled, (state, action: PayloadAction<number>) => {
        state[0].loading = false;
        state[0].data[0].data = state[0].data[0].data.filter(counterProduct => counterProduct.id !== action.payload);
        state[0].error = null;
      })
      .addCase(deleteCounterProduct.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || 'Failed to delete counterProduct';
      });
  },
});

export default counterProductSlice.reducer;
