import { createAsyncThunk } from '@reduxjs/toolkit';
import axios from 'axios';
import axiosInstance from './../utils/axiosInstance';
import { ServerResponse } from '../types/general/ServerResponse';
import { User } from '../types/users/User';

const extractErrorMessage = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string }[] | undefined;
    if (Array.isArray(data) && data[0]?.message) {
      return data[0].message;
    }
    return error.response?.statusText ?? error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'An unknown error occurred';
};

export const loginUser = createAsyncThunk(
  'users/loginUser',
  async (credentials: Partial<User>, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.post<[{ message: string; userId: number }]>(
        '/api/users/login',
        credentials,
        {
          withCredentials: true,
        },
      );
      return response.data;
    } catch (error) {
      return rejectWithValue(extractErrorMessage(error));
    }
  },
);

export const logoutUser = createAsyncThunk(
  'users/logoutUser',
  async (_, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.post<[{ message: string }]>(
        '/api/users/logout',
        {
          withCredentials: true,
        },
      );
      return response.data;
    } catch (error) {
      return rejectWithValue(extractErrorMessage(error));
    }
  },
);

export const fetchUsers = createAsyncThunk(
  'users/fetchUsers',
  async (_, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get<ServerResponse<Partial<User>>>(
        '/api/users',
        {
          withCredentials: true,
        },
      );
      return response.data;
    } catch (error) {
      return rejectWithValue(extractErrorMessage(error));
    }
  },
);

export const fetchActiveUsers = createAsyncThunk(
  'users/fetchUsers',
  async (_, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get<ServerResponse<Partial<User>>>(
        '/api/users/active',
        {
          withCredentials: true,
        },
      );
      return response.data;
    } catch (error) {
      return rejectWithValue(extractErrorMessage(error));
    }
  },
);

export const createUser = createAsyncThunk(
  'users/createUser',
  async (userData: Partial<User>, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.post<Partial<User>>(
        '/api/users/register',
        userData,
        {
          withCredentials: true,
        },
      );
      return response.data;
    } catch (error) {
      return rejectWithValue(extractErrorMessage(error));
    }
  },
);

export const updateUser = createAsyncThunk(
  'users/updateUser',
  async (
    { userId, userData }: { userId: number; userData: Partial<User> },
    { rejectWithValue },
  ) => {
    try {
      const response = await axiosInstance.put<Partial<User>>(
        `/api/users/${userId}`,
        userData,
        {
          withCredentials: true,
        },
      );
      return response.data;
    } catch (error) {
      return rejectWithValue(extractErrorMessage(error));
    }
  },
);

export const deleteUser = createAsyncThunk(
  'users/deleteUser',
  async (userId: number, { rejectWithValue }) => {
    try {
      await axiosInstance.delete(`/api/users/${userId}`, {
        withCredentials: true,
      });
      return userId;
    } catch (error) {
      return rejectWithValue(extractErrorMessage(error));
    }
  },
);