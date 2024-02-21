import { configureStore } from '@reduxjs/toolkit';
import guestReducer from './../reducers/guestReducer';
import bookingReducer from './../reducers/bookingReducer';
import channelReducer from './../reducers/channelReducer';
import userReducer from './../reducers/userReducer';
import navBarReducer from './../reducers/navBarReducer';
import navigationReducer from './../reducers/navigationReducer';

// Create the Redux store using configureStore
export const store = configureStore({
  reducer: {
    guests: guestReducer,
    bookings: bookingReducer,
    channels: channelReducer,
    users: userReducer,
    navBar: navBarReducer,
    navigation: navigationReducer,
  },
  // If you have additional middleware, you can add them here
  // middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(yourAdditionalMiddleware),
});

// Infer the `RootState` and `AppDispatch` types from the store itself
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;