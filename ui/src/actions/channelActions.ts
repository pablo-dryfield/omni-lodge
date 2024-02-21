import { createAsyncThunk } from '@reduxjs/toolkit';
import axiosInstance from './../utils/axiosInstance';
import { ServerResponse } from '../types/general/ServerResponse';
import { Channel } from '../types/channels/Channel';

// Async thunk for fetching channels
export const fetchChannels = createAsyncThunk(
  'channels/fetchChannels',
  async (_, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get<ServerResponse<Channel>>('/api/channels');
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('An unknown error occurred');
    }
  }
);

// Async thunk for creating a channel
export const createChannel = createAsyncThunk(
  'channels/createChannel',
  async (channelData: Channel, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.post<Channel>('/api/channels', channelData);
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('An unknown error occurred');
    }
  }
);

// Async thunk for updating a channel
export const updateChannel = createAsyncThunk(
  'channels/updateChannel',
  async ({ channelId, channelData }: { channelId: number; channelData: Channel; }, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.put<Channel>(`/api/channels/${channelId}`, channelData);
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('An unknown error occurred');
    }
  }
);

// Async thunk for deleting a channel
export const deleteChannel = createAsyncThunk(
  'channels/deleteChannel',
  async (channelId: number, { rejectWithValue }) => {
    try {
      await axiosInstance.delete(`/api/channels/${channelId}`);
      return channelId;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('An unknown error occurred');
    }
  }
);