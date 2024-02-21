import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { NavigationState } from '../types/general/NavigationState';

// Define the initial state using that type
const initialState: NavigationState = {
    currentPage: "/"
};

const navigationSlice = createSlice({
  name: 'navigation',
  initialState,
  reducers: {
    setCurrentPage: (state, action: PayloadAction<string>) => {
      state.currentPage = action.payload;
    },
  },
});

export const { setCurrentPage } = navigationSlice.actions;
export default navigationSlice.reducer;