import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { PaymentMethod } from "../types/paymentMethods/PaymentMethod";
import { DataState } from "../types/general/DataState";
import { ServerResponse } from "../types/general/ServerResponse";
import {
  createPaymentMethod,
  deletePaymentMethod,
  fetchPaymentMethods,
  updatePaymentMethod,
} from "../actions/paymentMethodActions";

const initialState: DataState<Partial<PaymentMethod>> = [
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

const paymentMethodSlice = createSlice({
  name: "paymentMethods",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchPaymentMethods.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(
        fetchPaymentMethods.fulfilled,
        (state, action: PayloadAction<ServerResponse<Partial<PaymentMethod>>>) => {
          state[0].loading = false;
          state[0].data = action.payload;
          state[0].error = null;
        },
      )
      .addCase(fetchPaymentMethods.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.payload?.toString() ?? action.error.message ?? "Failed to fetch payment methods";
      })
      .addCase(createPaymentMethod.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(createPaymentMethod.fulfilled, (state, action: PayloadAction<Partial<PaymentMethod> | undefined>) => {
        state[0].loading = false;
        state[0].error = null;
        if (action.payload) {
          state[0].data[0].data.push(action.payload);
        }
      })
      .addCase(createPaymentMethod.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.payload?.toString() ?? action.error.message ?? "Failed to create payment method";
      })
      .addCase(updatePaymentMethod.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(updatePaymentMethod.fulfilled, (state, action: PayloadAction<Partial<PaymentMethod> | undefined>) => {
        state[0].loading = false;
        state[0].error = null;
        if (action.payload?.id != null) {
          state[0].data[0].data = state[0].data[0].data.map((method) =>
            method.id === action.payload?.id ? { ...method, ...action.payload } : method,
          );
        }
      })
      .addCase(updatePaymentMethod.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.payload?.toString() ?? action.error.message ?? "Failed to update payment method";
      })
      .addCase(deletePaymentMethod.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(deletePaymentMethod.fulfilled, (state, action: PayloadAction<number>) => {
        state[0].loading = false;
        state[0].error = null;
        state[0].data[0].data = state[0].data[0].data.filter((method) => method.id !== action.payload);
      })
      .addCase(deletePaymentMethod.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.payload?.toString() ?? action.error.message ?? "Failed to delete payment method";
      });
  },
});

export default paymentMethodSlice.reducer;
