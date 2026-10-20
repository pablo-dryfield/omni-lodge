import { createAsyncThunk } from '@reduxjs/toolkit';
import axiosInstance from './../utils/axiosInstance';
import { ServerResponse } from '../types/general/ServerResponse';
import { UserType } from '../types/userTypes/UserType';

const errorMessage = (error: unknown): string => {
  const data = (error as { response?: { data?: unknown } } | null)?.response?.data;
  if (Array.isArray(data) && typeof data[0]?.message === 'string') return data[0].message;
  if (data && typeof data === 'object') {
    const payload = data as { message?: string; errors?: Array<{ msg?: string }> };
    if (payload.errors?.[0]?.msg) return payload.errors[0].msg;
    if (payload.message) return payload.message;
  }
  return error instanceof Error ? error.message : 'An unknown error occurred';
};

// Async thunk for fetching userTypes
export const fetchUserTypes = createAsyncThunk(
  'userTypes/fetchUserTypes',
  async (_, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get<ServerResponse<Partial<UserType>>>('/userTypes', {
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

// Async thunk for creating a userType
export const createUserType = createAsyncThunk(
  'userTypes/createUserType',
  async (userTypeData: Partial<UserType>, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.post<[Partial<UserType>]>('/userTypes', userTypeData, {
        withCredentials: true
      });
      if (!response.data[0]) throw new Error('The server did not return the saved user type');
      return response.data[0];
    } catch (error) {
      return rejectWithValue(errorMessage(error));
    }
  }
);

// Async thunk for updating a userType
export const updateUserType = createAsyncThunk(
  'userTypes/updateUserType',
  async ({ userTypeId, userTypeData }: { userTypeId: number; userTypeData: Partial<UserType>; }, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.put<[Partial<UserType>]>(`/userTypes/${userTypeId}`, userTypeData, {
        withCredentials: true
      });
      if (!response.data[0]) throw new Error('The server did not return the saved user type');
      return response.data[0];
    } catch (error) {
      return rejectWithValue(errorMessage(error));
    }
  }
);

// Async thunk for deleting a userType
export const deleteUserType = createAsyncThunk(
  'userTypes/deleteUserType',
  async (userTypeId: number, { rejectWithValue }) => {
    try {
      await axiosInstance.delete(`/userTypes/${userTypeId}`, {
        withCredentials: true
      });
      return userTypeId;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('An unknown error occurred');
    }
  }
);
