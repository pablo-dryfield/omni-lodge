import { createAsyncThunk } from '@reduxjs/toolkit';
import axiosInstance from './../utils/axiosInstance';
import { setUser, setAuthenticated } from '../reducers/sessionReducer';

export const setUserState = (user: string) => setUser(user);
export const setAuthenticatedState = (auth: boolean) => setAuthenticated(auth);

// Async thunk for fetching users
export const fetchSession = createAsyncThunk(
    'session/session',
    async (_, { rejectWithValue }) => {
      try {
        const response = await axiosInstance.get<[{authenticated:boolean, userId:number}]>('/api/session', {
          withCredentials: true, 
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