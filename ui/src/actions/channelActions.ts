import { createAsyncThunk } from '@reduxjs/toolkit';
import axiosInstance from './../utils/axiosInstance';
import { ServerResponse } from '../types/general/ServerResponse';
import { Channel } from '../types/channels/Channel';

/**
 * Fetches a list of channels from the server.
 * @returns A promise that resolves to the list of channels or an error message string.
 * @throws Will throw an error if the server response is not as expected or if there is a network issue.
 */
export const fetchChannels = createAsyncThunk(
  'channels/fetchChannels',
  async (_, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get<ServerResponse<Partial<Channel>>>('/api/channels', {
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
 * Creates a new channel with the provided data.
 * @param channelData - The data for the new channel to be created.
 * @returns A promise that resolves to the created channel's data or an error message string.
 * @throws Will throw an error if the server response is not as expected or if there is a network issue.
 */
export const createChannel = createAsyncThunk(
  'channels/createChannel',
  async (channelData: Partial<Channel>, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.post<Partial<Channel>>('/api/channels', channelData, {
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
 * Updates a channel with the given ID using the provided data.
 * @param channelId - The ID of the channel to update.
 * @param channelData - The new data for updating the channel.
 * @returns A promise that resolves to the updated channel's data or an error message string.
 * @throws Will throw an error if the server response is not as expected or if there is a network issue.
 */
export const updateChannel = createAsyncThunk(
  'channels/updateChannel',
  async ({ channelId, channelData }: { channelId: number; channelData: Partial<Channel>; }, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.put<Partial<Channel>>(`/api/channels/${channelId}`, channelData, {
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
 * Deletes a channel with the specified ID.
 * @param channelId - The ID of the channel to be deleted.
 * @returns A promise that resolves to the ID of the deleted channel or an error message string.
 * @throws Will throw an error if the server response is not as expected or if there is a network issue.
 */
export const deleteChannel = createAsyncThunk(
  'channels/deleteChannel',
  async (channelId: number, { rejectWithValue }) => {
    try {
      await axiosInstance.delete(`/api/channels/${channelId}`, {
        withCredentials: true
      });
      return channelId;
    } catch (error) {
      if (error instanceof Error) {
        return rejectWithValue(error.message);
      }
      return rejectWithValue('An unknown error occurred');
    }
  }
);