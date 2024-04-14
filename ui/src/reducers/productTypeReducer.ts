import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { ProductType } from '../types/productTypes/ProductType';
import { DataState } from '../types/general/DataState';
import { type ServerResponse } from '../types/general/ServerResponse';
import { fetchProductTypes, createProductType, updateProductType, deleteProductType } from '../actions/productTypeActions'; // Import thunks

// Define the initial state using that type
const initialState: DataState<Partial<ProductType>> = [{
  loading: false,
  data: [{
    data: [],
    columns: []
  }],
  error: null,
}];

const productTypeSlice = createSlice({
  name: 'productTypes',
  initialState,
  reducers: {
    // Synchronous actions (if any)
  },
  extraReducers: (builder) => {
    builder
      // Fetch ProductTypes
      .addCase(fetchProductTypes.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(fetchProductTypes.fulfilled, (state, action: PayloadAction<ServerResponse<Partial<ProductType>>>) => {
        state[0].loading = false;
        state[0].data = action.payload;
        state[0].error = null;
      })
      .addCase(fetchProductTypes.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || 'Failed to fetch productTypes';
      })
      
      // Create ProductType
      .addCase(createProductType.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(createProductType.fulfilled, (state, action: PayloadAction<Partial<ProductType>>) => {
        state[0].loading = false;
        state[0].data[0].data.push(action.payload);
        state[0].error = null;
      })
      .addCase(createProductType.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || 'Failed to create productType';
      })
      
      // Update ProductType
      .addCase(updateProductType.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(updateProductType.fulfilled, (state, action: PayloadAction<Partial<ProductType>>) => {
        state[0].loading = false;
        state[0].data[0].data = state[0].data[0].data.map(productType => 
          productType.id === action.payload.id ? action.payload : productType
        );
        state[0].error = null;
      })
      .addCase(updateProductType.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || 'Failed to update productType';
      })
      
      // Delete ProductType
      .addCase(deleteProductType.pending, (state) => {
        state[0].loading = true;
      })
      
      .addCase(deleteProductType.fulfilled, (state, action: PayloadAction<number>) => {
        state[0].loading = false;
        state[0].data[0].data = state[0].data[0].data.filter(productType => productType.id !== action.payload);
        state[0].error = null;
      })
      .addCase(deleteProductType.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || 'Failed to delete productType';
      });
  },
});

export default productTypeSlice.reducer;
