import { createAsyncThunk } from '@reduxjs/toolkit';
import axiosInstance from './../utils/axiosInstance';
import { ServerResponse } from '../types/general/ServerResponse';
import { Guest } from '../types/guests/Guest';

// Async thunk for fetching guests
export const fetchGuests = createAsyncThunk(
  'guests/fetchGuests',
  async (_, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get<ServerResponse<Partial<Guest>>>('/api/guests', {
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

// Async thunk for creating a guest
export const createGuest = createAsyncThunk(
  'guests/createGuest',
  async (guestData: Partial<Guest>, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.post<Partial<Guest>>('/api/guests', guestData, {
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

// Async thunk for updating a guest
export const updateGuest = createAsyncThunk(
  'guests/updateGuest',
  async ({ guestId, guestData }: { guestId: number; guestData: Partial<Guest>; }, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.put<Partial<Guest>>(`/api/guests/${guestId}`, guestData, {
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

// Async thunk for deleting a guest
export const deleteGuest = createAsyncThunk(
  'guests/deleteGuest',
  async (guestId: number, { rejectWithValue }) => {
    try {
      await axiosInstance.delete(`/api/guests/${guestId}`, {
        withCredentials: true
      });
      return guestId;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('An unknown error occurred');
    }
  }
);