import { createAsyncThunk } from '@reduxjs/toolkit';
import axiosInstance from './../utils/axiosInstance';
import { ServerResponse } from '../types/general/ServerResponse';
import { User } from '../types/users/User';

export const loginUser = createAsyncThunk(
  'users/loginUser',
  async (credentials: Partial<User>, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.post<[{message:string}]>('/api/users/login', credentials, {
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

// Async thunk for fetching users
export const fetchUsers = createAsyncThunk(
  'users/fetchUsers',
  async (_, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get<ServerResponse<User>>('/api/users', {
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

// Async thunk for creating a user
export const createUser = createAsyncThunk(
  'users/createUser',
  async (userData: User, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.post<User>('/api/users/register', userData, {
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

// Async thunk for updating a user
export const updateUser = createAsyncThunk(
  'users/updateUser',
  async ({ userId, userData }: { userId: number; userData: User; }, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.put<User>(`/api/users/${userId}`, userData, {
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

// Async thunk for deleting a user
export const deleteUser = createAsyncThunk(
  'users/deleteUser',
  async (userId: number, { rejectWithValue }) => {
    try {
      await axiosInstance.delete(`/api/users/${userId}`, {
        withCredentials: true
      });
      return userId;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('An unknown error occurred');
    }
  }
);