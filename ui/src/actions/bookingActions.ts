import { createAsyncThunk } from '@reduxjs/toolkit';
import axiosInstance from './../utils/axiosInstance';
import { ServerResponse } from '../types/general/ServerResponse';
import { Booking } from '../types/bookings/Booking';

/**
 * Fetches bookings from the server.
 * @returns A promise containing the server response with booking data.
 * @throws Will throw an error message string if the request fails.
 */
export const fetchBookings = createAsyncThunk(
  'bookings/fetchBookings',
  async (_, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get<ServerResponse<Partial<Booking>>>('/bookings', {
        withCredentials: true
      });
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('An unknown error occurred');
    }
  }
);

/**
 * Creates a new booking.
 * @param bookingData - The data for the new booking.
 * @returns A promise containing the created booking data.
 * @throws Will throw an error message string if the creation fails.
 */
export const createBooking = createAsyncThunk(
  'bookings/createBooking',
  async (bookingData: Partial<Booking>, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.post<Partial<Booking>>('/bookings', bookingData, {
        withCredentials: true
      });
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('An unknown error occurred');
    }
  }
);

/**
 * Updates an existing booking.
 * @param bookingId - The ID of the booking to update.
 * @param bookingData - The new data for the booking.
 * @returns A promise containing the updated booking data.
 * @throws Will throw an error message string if the update fails.
 */
export const updateBooking = createAsyncThunk(
  'bookings/updateBooking',
  async ({ bookingId, bookingData }: { bookingId: number; bookingData: Partial<Booking>; }, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.put<Partial<Booking>>(`/bookings/${bookingId}`, bookingData, {
        withCredentials: true
      });
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('An unknown error occurred');
    }
  }
);

/**
 * Deletes a booking.
 * @param bookingId - The ID of the booking to delete.
 * @returns A promise containing the ID of the deleted booking.
 * @throws Will throw an error message string if the deletion fails.
 */
export const deleteBooking = createAsyncThunk(
  'bookings/deleteBooking',
  async (bookingId: number, { rejectWithValue }) => {
    try {
      await axiosInstance.delete(`/bookings/${bookingId}`, {
        withCredentials: true
      });
      return bookingId;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('An unknown error occurred');
    }
  }
);