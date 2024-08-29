import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { NavigationState } from '../types/general/NavigationState';
import PersonIcon from '@mui/icons-material/Person';

// Define the initial state using that type
const initialState: NavigationState = {
    currentPage: "/",
    pages: [
      /*{ name: 'Home', path: '/', icon: <PersonIcon fontSize="large" />},
      { name: 'Guests', path: '/guests', icon: <PersonIcon fontSize="large" /> },
      { name: 'Bookings', path: '/bookings', icon: <PersonIcon fontSize="large" /> },
      { name: 'Calendar', path: '/calendar', icon: <PersonIcon fontSize="large" /> },
      { name: 'Channels', path: '/channels', icon: <PersonIcon fontSize="large" /> },
      { name: 'User Types', path: '/userTypes', icon: <PersonIcon fontSize="large" />},*/
      { name: 'Users', path: '/users', icon: <PersonIcon fontSize="large" />}, 
      { name: 'Product Types', path: '/productTypes', icon: <PersonIcon fontSize="large" /> }, 
      { name: 'Product', path: '/products', icon: <PersonIcon fontSize="large" />}, 
      { name: 'Counters', path: '/counters', icon: <PersonIcon fontSize="large" /> }, 
      { name: 'Staff Payment', path: '/pays', icon: <PersonIcon fontSize="large" /> }, 
      /*{ name: 'Venue Numbers', path: '/venueNumbers', icon: <PersonIcon fontSize="large" /> },*/
    ],
};

const navigationSlice = createSlice({
  name: 'navigation',
  initialState,
  reducers: {
    setCurrentPage: (state, action: PayloadAction<string>) => {
      state.currentPage = action.payload;
    },
    setPages: (state, action: PayloadAction<{ name: string; path: string; icon: JSX.Element}[]>) => {
      state.pages = action.payload;
    },
  },
});

export const { setCurrentPage , setPages } = navigationSlice.actions;
export default navigationSlice.reducer;