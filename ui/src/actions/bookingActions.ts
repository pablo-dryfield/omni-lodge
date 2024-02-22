import { createAsyncThunk } from '@reduxjs/toolkit';
import axiosInstance from './../utils/axiosInstance';
import { ServerResponse } from '../types/general/ServerResponse';
import { Booking } from '../types/bookings/Booking';

// Async thunk for fetching bookings
export const fetchBookings = createAsyncThunk(
  'bookings/fetchBookings',
  async (_, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get<ServerResponse<Booking>>('/api/bookings');
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('An unknown error occurred');
    }
  }
);

// Async thunk for creating a booking
export const createBooking = createAsyncThunk(
  'bookings/createBooking',
  async (bookingData: Booking, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.post<Booking>('/api/bookings', bookingData);
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('An unknown error occurred');
    }
  }
);

// Async thunk for updating a booking
export const updateBooking = createAsyncThunk(
  'bookings/updateBooking',
  async ({ bookingId, bookingData }: { bookingId: number; bookingData: Booking; }, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.put<Booking>(`/api/bookings/${bookingId}`, bookingData);
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('An unknown error occurred');
    }
  }
);

// Async thunk for deleting a booking
export const deleteBooking = createAsyncThunk(
  'bookings/deleteBooking',
  async (bookingId: number, { rejectWithValue }) => {
    try {
      await axiosInstance.delete(`/api/bookings/${bookingId}`);
      return bookingId;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('An unknown error occurred');
    }
  }
);