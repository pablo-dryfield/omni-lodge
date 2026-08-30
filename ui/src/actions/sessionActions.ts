import { createAsyncThunk } from '@reduxjs/toolkit';
import axiosInstance from './../utils/axiosInstance';
import { setUser, setAuthenticated, setProfilePhotoState } from '../reducers/sessionReducer';
import type { SessionResponse } from '../types/general/SessionState';

export const setUserState = (user: string) => setUser(user);
export const setAuthenticatedState = (auth: boolean) => setAuthenticated(auth);
export const setSessionProfilePhotoState = (
  hasStoredProfilePhoto: boolean,
  profilePhotoVersion: string | null,
) => setProfilePhotoState({ hasStoredProfilePhoto, profilePhotoVersion });

// Async thunk for hydrating the authenticated session.
export const fetchSession = createAsyncThunk(
    'session/session',
    async (_, { rejectWithValue }) => {
      try {
        const response = await axiosInstance.get<[SessionResponse]>('/session', {
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
