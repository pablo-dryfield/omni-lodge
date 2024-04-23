import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { Product } from '../types/products/Product';
import { DataState } from '../types/general/DataState';
import { type ServerResponse } from '../types/general/ServerResponse';
import { fetchProducts, createProduct, updateProduct, deleteProduct } from '../actions/productActions'; // Import thunks

// Define the initial state using that type
const initialState: DataState<Partial<Product>> = [{
  loading: false,
  data: [{
    data: [],
    columns: []
  }],
  error: null,
}];

const productSlice = createSlice({
  name: 'products',
  initialState,
  reducers: {
    // Synchronous actions (if any)
  },
  extraReducers: (builder) => {
    builder
      // Fetch Products
      .addCase(fetchProducts.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(fetchProducts.fulfilled, (state, action: PayloadAction<ServerResponse<Partial<Product>>>) => {
        state[0].loading = false;
        state[0].data = action.payload;
        state[0].error = null;
      })
      .addCase(fetchProducts.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || 'Failed to fetch products';
      })
      
      // Create Product
      .addCase(createProduct.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(createProduct.fulfilled, (state, action: PayloadAction<Partial<Product>>) => {
        state[0].loading = false;
        state[0].data[0].data.push(action.payload);
        state[0].error = null;
      })
      .addCase(createProduct.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || 'Failed to create product';
      })
      
      // Update Product
      .addCase(updateProduct.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(updateProduct.fulfilled, (state, action: PayloadAction<Partial<Product>>) => {
        state[0].loading = false;
        state[0].data[0].data = state[0].data[0].data.map(product => 
          product.id === action.payload.id ? action.payload : product
        );
        state[0].error = null;
      })
      .addCase(updateProduct.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || 'Failed to update product';
      })
      
      // Delete Product
      .addCase(deleteProduct.pending, (state) => {
        state[0].loading = true;
      })
      
      .addCase(deleteProduct.fulfilled, (state, action: PayloadAction<number>) => {
        state[0].loading = false;
        state[0].data[0].data = state[0].data[0].data.filter(product => product.id !== action.payload);
        state[0].error = null;
      })
      .addCase(deleteProduct.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || 'Failed to delete product';
      });
  },
});

export default productSlice.reducer;
