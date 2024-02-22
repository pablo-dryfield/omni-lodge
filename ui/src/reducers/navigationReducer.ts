import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { NavigationState } from '../types/general/NavigationState';

// Define the initial state using that type
const initialState: NavigationState = {
    currentPage: "/",
    pages: [
      { name: 'Home', path: '/' },
      { name: 'Guests', path: '/guests' },
      { name: 'Bookings', path: '/bookings' },
      { name: 'Calendar', path: '/calendar' },
      { name: 'Channels', path: '/channels' },
      { name: 'Users', path: '/users' }, 
    ],
};

const navigationSlice = createSlice({
  name: 'navigation',
  initialState,
  reducers: {
    setCurrentPage: (state, action: PayloadAction<string>) => {
      state.currentPage = action.payload;
    },
    setPages: (state, action: PayloadAction<{ name: string; path: string; }[]>) => {
      state.pages = action.payload;
    },
  },
});

export const { setCurrentPage , setPages } = navigationSlice.actions;
export default navigationSlice.reducer;