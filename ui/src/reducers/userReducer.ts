import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { User } from '../types/users/User';
import { DataState } from '../types/general/DataState';
import { type ServerResponse } from '../types/general/ServerResponse';
import { fetchUsers, createUser, updateUser, deleteUser } from '../actions/userActions'; // Import thunks

// Define the initial state using that type
const initialState: DataState<Partial<User>> = [{
  loading: false,
  data: [{
    data: [],
    columns: []
  }],
  error: null,
}];

const userSlice = createSlice({
  name: 'users',
  initialState,
  reducers: {
    // Synchronous actions (if any)
  },
  extraReducers: (builder) => {
    builder
      // Fetch Users
      .addCase(fetchUsers.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(fetchUsers.fulfilled, (state, action: PayloadAction<ServerResponse<Partial<User>>>) => {
        state[0].loading = false;
        state[0].data = action.payload;
        state[0].error = null;
      })
      .addCase(fetchUsers.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || 'Failed to fetch users';
      })
      
      // Create User
      .addCase(createUser.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(createUser.fulfilled, (state, action: PayloadAction<Partial<User>>) => {
        state[0].loading = false;
        state[0].data[0].data.push(action.payload);
        state[0].error = null;
      })
      .addCase(createUser.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || 'Failed to create user';
      })
      
      // Update User
      .addCase(updateUser.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(updateUser.fulfilled, (state, action: PayloadAction<Partial<User>>) => {
        state[0].loading = false;
        state[0].data[0].data = state[0].data[0].data.map(user => 
          user.id === action.payload.id ? action.payload : user
        );
        state[0].error = null;
      })
      .addCase(updateUser.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || 'Failed to update user';
      })
      
      // Delete User
      .addCase(deleteUser.pending, (state) => {
        state[0].loading = true;
      })
      
      .addCase(deleteUser.fulfilled, (state, action: PayloadAction<number>) => {
        state[0].loading = false;
        state[0].data[0].data = state[0].data[0].data.filter(user => user.id !== action.payload);
        state[0].error = null;
      })
      .addCase(deleteUser.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || 'Failed to delete user';
      });
  },
});

export default userSlice.reducer;
