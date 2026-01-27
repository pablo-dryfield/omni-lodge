import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { type ServerResponse } from '../types/general/ServerResponse';
import type { DataState } from '../types/general/DataState';
import type { ProductAlias } from '../types/products/ProductAlias';
import {
  fetchProductAliases,
  createProductAlias,
  updateProductAlias,
  deleteProductAlias,
} from '../actions/productAliasActions';

const initialState: DataState<Partial<ProductAlias>> = [
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

const productAliasSlice = createSlice({
  name: 'productAliases',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchProductAliases.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(
        fetchProductAliases.fulfilled,
        (state, action: PayloadAction<ServerResponse<Partial<ProductAlias>>>) => {
          state[0].loading = false;
          state[0].data = action.payload;
          state[0].error = null;
        },
      )
      .addCase(fetchProductAliases.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || 'Failed to fetch product aliases';
      })
      .addCase(createProductAlias.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(createProductAlias.fulfilled, (state, action: PayloadAction<Partial<ProductAlias>>) => {
        state[0].loading = false;
        state[0].data[0].data.push(action.payload);
        state[0].error = null;
      })
      .addCase(createProductAlias.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || 'Failed to create product alias';
      })
      .addCase(updateProductAlias.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(updateProductAlias.fulfilled, (state, action: PayloadAction<Partial<ProductAlias>>) => {
        state[0].loading = false;
        state[0].data[0].data = state[0].data[0].data.map((alias) =>
          alias.id === action.payload.id ? action.payload : alias,
        );
        state[0].error = null;
      })
      .addCase(updateProductAlias.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || 'Failed to update product alias';
      })
      .addCase(deleteProductAlias.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(deleteProductAlias.fulfilled, (state, action: PayloadAction<number>) => {
        state[0].loading = false;
        state[0].data[0].data = state[0].data[0].data.filter((alias) => alias.id !== action.payload);
        state[0].error = null;
      })
      .addCase(deleteProductAlias.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || 'Failed to delete product alias';
      });
  },
});

export default productAliasSlice.reducer;
