import { configureStore } from '@reduxjs/toolkit';
import guestReducer from './../reducers/guestReducer';
import bookingReducer from './../reducers/bookingReducer';
import channelReducer from './../reducers/channelReducer';
import userReducer from './../reducers/userReducer';
import navigationReducer from './../reducers/navigationReducer';
import sessionReducer from './../reducers/sessionReducer';
import userTypeReducer from './../reducers/userTypeReducer';
import productTypeReducer from '../reducers/productTypeReducer';
import productReducer from '../reducers/productReducer';
import counterReducer from '../reducers/counterReducer';
import counterProductsReducer from '../reducers/counterProductsReducer';
import counterUsersReducer from '../reducers/counterUsersReducer';
import payReducer from '../reducers/payReducer';


// Create the Redux store using configureStore
export const store = configureStore({
  reducer: {
    guests: guestReducer,
    bookings: bookingReducer,
    channels: channelReducer,
    users: userReducer,
    navigation: navigationReducer,
    session: sessionReducer,
    userTypes: userTypeReducer,
    productTypes: productTypeReducer,
    products: productReducer,
    counters: counterReducer,
    counterProducts: counterProductsReducer,
    counterUsers: counterUsersReducer,
    pays: payReducer,
  },
  // If you have additional middleware, you can add them here
  // middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(yourAdditionalMiddleware),
});

// Infer the `RootState` and `AppDispatch` types from the store itself
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;