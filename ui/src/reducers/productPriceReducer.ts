import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { ProductPrice } from "../types/products/ProductPrice";
import { DataState } from "../types/general/DataState";
import { ServerResponse } from "../types/general/ServerResponse";
import {
  createProductPrice,
  deleteProductPrice,
  fetchProductPrices,
  updateProductPrice,
} from "../actions/productPriceActions";

const initialState: DataState<Partial<ProductPrice>> = [
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

const productPriceSlice = createSlice({
  name: "productPrices",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchProductPrices.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(
        fetchProductPrices.fulfilled,
        (state, action: PayloadAction<ServerResponse<Partial<ProductPrice>>>) => {
          state[0].loading = false;
          state[0].data = action.payload;
          state[0].error = null;
        },
      )
      .addCase(fetchProductPrices.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.payload?.toString() ?? action.error.message ?? "Failed to fetch product prices";
      })
      .addCase(createProductPrice.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(createProductPrice.fulfilled, (state, action: PayloadAction<Partial<ProductPrice> | undefined>) => {
        state[0].loading = false;
        state[0].error = null;
        if (action.payload) {
          state[0].data[0].data.unshift(action.payload);
        }
      })
      .addCase(createProductPrice.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.payload?.toString() ?? action.error.message ?? "Failed to create product price";
      })
      .addCase(updateProductPrice.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(
        updateProductPrice.fulfilled,
        (state, action: PayloadAction<Partial<ProductPrice> | undefined>) => {
          state[0].loading = false;
          state[0].error = null;
          if (action.payload?.id != null) {
            state[0].data[0].data = state[0].data[0].data.map((record) =>
              record.id === action.payload?.id ? { ...record, ...action.payload } : record,
            );
          }
        },
      )
      .addCase(updateProductPrice.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.payload?.toString() ?? action.error.message ?? "Failed to update product price";
      })
      .addCase(deleteProductPrice.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(deleteProductPrice.fulfilled, (state, action: PayloadAction<number>) => {
        state[0].loading = false;
        state[0].error = null;
        state[0].data[0].data = state[0].data[0].data.filter((record) => record.id !== action.payload);
      })
      .addCase(deleteProductPrice.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.payload?.toString() ?? action.error.message ?? "Failed to delete product price";
      });
  },
});

export default productPriceSlice.reducer;
