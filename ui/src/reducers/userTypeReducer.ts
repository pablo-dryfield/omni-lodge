import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { UserType } from '../types/userTypes/UserType';
import { DataState } from '../types/general/DataState';
import { type ServerResponse } from '../types/general/ServerResponse';
import { fetchUserTypes, createUserType, updateUserType, deleteUserType } from '../actions/userTypeActions'; // Import thunks

// Define the initial state using that type
const initialState: DataState<Partial<UserType>> = [{
  loading: false,
  data: [{
    data: [],
    columns: []
  }],
  error: null,
}];

const userTypeSlice = createSlice({
  name: 'userTypes',
  initialState,
  reducers: {
    // Synchronous actions (if any)
  },
  extraReducers: (builder) => {
    builder
      // Fetch UserTypes
      .addCase(fetchUserTypes.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(fetchUserTypes.fulfilled, (state, action: PayloadAction<ServerResponse<Partial<UserType>>>) => {
        state[0].loading = false;
        state[0].data = action.payload;
        state[0].error = null;
      })
      .addCase(fetchUserTypes.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || 'Failed to fetch userTypes';
      })
      
      // Create UserType
      .addCase(createUserType.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(createUserType.fulfilled, (state, action: PayloadAction<Partial<UserType>>) => {
        state[0].loading = false;
        state[0].data[0].data.push(action.payload);
        state[0].error = null;
      })
      .addCase(createUserType.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || 'Failed to create userType';
      })
      
      // Update UserType
      .addCase(updateUserType.pending, (state) => {
        state[0].loading = true;
      })
      .addCase(updateUserType.fulfilled, (state, action: PayloadAction<Partial<UserType>>) => {
        state[0].loading = false;
        state[0].data[0].data = state[0].data[0].data.map(userType => 
          userType.id === action.payload.id ? action.payload : userType
        );
        state[0].error = null;
      })
      .addCase(updateUserType.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || 'Failed to update userType';
      })
      
      // Delete UserType
      .addCase(deleteUserType.pending, (state) => {
        state[0].loading = true;
      })
      
      .addCase(deleteUserType.fulfilled, (state, action: PayloadAction<number>) => {
        state[0].loading = false;
        state[0].data[0].data = state[0].data[0].data.filter(userType => userType.id !== action.payload);
        state[0].error = null;
      })
      .addCase(deleteUserType.rejected, (state, action) => {
        state[0].loading = false;
        state[0].error = action.error.message || 'Failed to delete userType';
      });
  },
});

export default userTypeSlice.reducer;
