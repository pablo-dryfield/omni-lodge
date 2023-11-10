import {
    SHOW_GUESTS,
    SHOW_BOOKINGS,
  } from '../actions/leftSidebarActions';
  
  // Define initial state based on the main nav bar option selected
  const initialState = {
    guests: [], // Your guest options here
    bookings: [], // Your booking options here
  };
  
  const leftSidebarReducer = (state = initialState, action) => {
    switch (action.type) {
      case SHOW_GUESTS:
        return {
          ...state,
          guests: ['All Guests', 'Hostelworld.com', 'Booking.com', 'Yes-Trips.com'],
        };
      case SHOW_BOOKINGS:
        return {
          ...state,
          bookings: ['All Bookings', 'Hostelworld.com', 'Booking.com', 'Yes-Trips.com'],
        };
      default:
        return state;
    }
  };
  
  export default leftSidebarReducer;
  