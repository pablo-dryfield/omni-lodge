


import { SET_PAGE_DATA } from '../actions/navBarActions';
  
const initialState = {
    pageData: [
        { name: 'Home', path: '/' },
        { name: 'Guests', path: '/guests' },
        { name: 'Bookings', path: '/bookings' },
        { name: 'Calendar', path: '/calendar' },
        { name: 'Channels', path: '/channels' },
        { name: 'Users', path: '/users' }, 
      ],
};
  
const navBarReducer = (state = initialState, action) => {
switch (action.type) {
    case SET_PAGE_DATA:
    return {
        ...state,
        pageData: action.payload, // Update the pageData in the state
    };
    default:
      return state;
    // ... other reducers
}
};
  
  export default navBarReducer;
  