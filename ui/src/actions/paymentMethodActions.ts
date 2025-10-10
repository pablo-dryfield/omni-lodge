import { createAsyncThunk } from "@reduxjs/toolkit";
import axiosInstance from "../utils/axiosInstance";
import { ServerResponse } from "../types/general/ServerResponse";
import { PaymentMethod } from "../types/paymentMethods/PaymentMethod";

const unwrapSingle = <T>(payload: T | T[]): T => (Array.isArray(payload) ? payload[0] : payload);

export const fetchPaymentMethods = createAsyncThunk(
  "paymentMethods/fetchPaymentMethods",
  async (_, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get<ServerResponse<Partial<PaymentMethod>>>("/paymentMethods", {
        withCredentials: true,
      });
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue("An unknown error occurred");
    }
  },
);

export const createPaymentMethod = createAsyncThunk(
  "paymentMethods/createPaymentMethod",
  async (payload: Partial<PaymentMethod>, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.post<Partial<PaymentMethod> | Partial<PaymentMethod>[]>("/paymentMethods", payload, {
        withCredentials: true,
      });
      return unwrapSingle(response.data);
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue("An unknown error occurred");
    }
  },
);

export const updatePaymentMethod = createAsyncThunk(
  "paymentMethods/updatePaymentMethod",
  async (
    { paymentMethodId, payload }: { paymentMethodId: number; payload: Partial<PaymentMethod> },
    { rejectWithValue },
  ) => {
    try {
      const response = await axiosInstance.put<Partial<PaymentMethod> | Partial<PaymentMethod>[]>(`/paymentMethods/${paymentMethodId}`, payload, {
        withCredentials: true,
      });
      return unwrapSingle(response.data);
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue("An unknown error occurred");
    }
  },
);

export const deletePaymentMethod = createAsyncThunk(
  "paymentMethods/deletePaymentMethod",
  async (paymentMethodId: number, { rejectWithValue }) => {
    try {
      await axiosInstance.delete(`/paymentMethods/${paymentMethodId}`, {
        withCredentials: true,
      });
      return paymentMethodId;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue("An unknown error occurred");
    }
  },
);
