import { createAsyncThunk } from '@reduxjs/toolkit';
import axiosInstance from './../utils/axiosInstance';
import { ServerResponse } from '../types/general/ServerResponse';
import { UserType } from '../types/userTypes/UserType';

// Async thunk for fetching userTypes
export const fetchUserTypes = createAsyncThunk(
  'userTypes/fetchUserTypes',
  async (_, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get<ServerResponse<Partial<UserType>>>('/api/userTypes', {
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
      const response = await axiosInstance.post<Partial<UserType>>('/api/userTypes', userTypeData, {
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

// Async thunk for updating a userType
export const updateUserType = createAsyncThunk(
  'userTypes/updateUserType',
  async ({ userTypeId, userTypeData }: { userTypeId: number; userTypeData: Partial<UserType>; }, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.put<Partial<UserType>>(`/api/userTypes/${userTypeId}`, userTypeData, {
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

// Async thunk for deleting a userType
export const deleteUserType = createAsyncThunk(
  'userTypes/deleteUserType',
  async (userTypeId: number, { rejectWithValue }) => {
    try {
      await axiosInstance.delete(`/api/userTypes/${userTypeId}`, {
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