import { legacy_createStore as createStore, applyMiddleware, combineReducers } from 'redux';
import thunk from 'redux-thunk';
import { composeWithDevTools } from 'redux-devtools-extension';
import guestReducer from './../reducers/guestReducer';
import bookingReducer from './../reducers/bookingReducer'; 
import channelReducer from './../reducers/channelReducer'; 
import userReducer from './../reducers/userReducer';

// Combine your reducers
const rootReducer = combineReducers({
  guests: guestReducer,
  bookings: bookingReducer,
  channels: channelReducer,
  users: userReducer,
  // Add more reducers here as your app grows
});

// Create the Redux store
const store = createStore(
  rootReducer,
  composeWithDevTools(applyMiddleware(thunk))
);

export default store;
