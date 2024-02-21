import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { Channel } from '../types/channels/Channel';
import { DataState } from '../types/general/DataState';
import {
  type ServerResponse,
} from '../types/general/ServerResponse';
import { fetchChannels, createChannel, updateChannel, deleteChannel } from '../actions/channelActions'; // Import thunks

// Define the initial state using that type
const initialState: DataState<Channel> = [{
  loading: false,
  data: [{
    data: [],
    columns: []
  }],
  error: null,
}];

const channelSlice = createSlice({
  name: 'channels',
  initialState,
  reducers: {
    // Synchronous actions (if any)
  },
  extraReducers: (builder) => {
    builder
      // Fetch Channels
      .addCase(fetchChannels.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(fetchChannels.fulfilled, (state, action: PayloadAction<ServerResponse<Channel>>) => {
        state[0].loading = false;
        state[0].data = action.payload;
        state[0].error = null;
      })
      .addCase(fetchChannels.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || 'Failed to fetch channels';
      })
      
      // Create Channel
      .addCase(createChannel.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(createChannel.fulfilled, (state, action: PayloadAction<Channel>) => {
        state[0].loading = false;
        state[0].data[0].data.push(action.payload);
        state[0].error = null;
      })
      .addCase(createChannel.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || 'Failed to create channel';
      })
      
      // Update Channel
      .addCase(updateChannel.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(updateChannel.fulfilled, (state, action: PayloadAction<Channel>) => {
        state[0].loading = false;
        state[0].data[0].data = state[0].data[0].data.map(channel => 
          channel.id === action.payload.id ? action.payload : channel
        );
        state[0].error = null;
      })
      .addCase(updateChannel.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || 'Failed to update channel';
      })
      
      // Delete Channel
      .addCase(deleteChannel.pending, (state) => {
        state[0].loading = true;
      })
      
      .addCase(deleteChannel.fulfilled, (state, action: PayloadAction<number>) => {
        state[0].loading = false;
        state[0].data[0].data = state[0].data[0].data.filter(channel => channel.id !== action.payload);
        state[0].error = null;
      })
      .addCase(deleteChannel.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || 'Failed to delete channel';
      });
  },
});

export default channelSlice.reducer;
