import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { ProductAddon } from "../types/productAddons/ProductAddon";
import { DataState } from "../types/general/DataState";
import { ServerResponse } from "../types/general/ServerResponse";
import {
  createProductAddon,
  deleteProductAddon,
  fetchProductAddons,
  updateProductAddon,
} from "../actions/productAddonActions";

const initialState: DataState<Partial<ProductAddon>> = [
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

const productAddonSlice = createSlice({
  name: "productAddons",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchProductAddons.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(
        fetchProductAddons.fulfilled,
        (state, action: PayloadAction<ServerResponse<Partial<ProductAddon>>>) => {
          state[0].loading = false;
          state[0].data = action.payload;
          state[0].error = null;
        },
      )
      .addCase(fetchProductAddons.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error =
          action.payload?.toString() ?? action.error.message ?? "Failed to fetch product add-ons";
      })
      .addCase(createProductAddon.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(
        createProductAddon.fulfilled,
        (state, action: PayloadAction<Partial<ProductAddon> | undefined>) => {
          state[0].loading = false;
          state[0].error = null;
          if (action.payload) {
            state[0].data[0].data.push(action.payload);
          }
        },
      )
      .addCase(createProductAddon.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error =
          action.payload?.toString() ?? action.error.message ?? "Failed to create product add-on";
      })
      .addCase(updateProductAddon.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(
        updateProductAddon.fulfilled,
        (state, action: PayloadAction<Partial<ProductAddon> | undefined>) => {
          state[0].loading = false;
          state[0].error = null;
          if (action.payload?.id != null) {
            state[0].data[0].data = state[0].data[0].data.map((record) =>
              record.id === action.payload?.id ? { ...record, ...action.payload } : record,
            );
          }
        },
      )
      .addCase(updateProductAddon.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error =
          action.payload?.toString() ?? action.error.message ?? "Failed to update product add-on";
      })
      .addCase(deleteProductAddon.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(deleteProductAddon.fulfilled, (state, action: PayloadAction<number>) => {
        state[0].loading = false;
        state[0].error = null;
        state[0].data[0].data = state[0].data[0].data.filter((record) => record.id !== action.payload);
      })
      .addCase(deleteProductAddon.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error =
          action.payload?.toString() ?? action.error.message ?? "Failed to delete product add-on";
      });
  },
});

export default productAddonSlice.reducer;
