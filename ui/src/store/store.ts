import { configureStore } from '@reduxjs/toolkit';
import guestReducer from './../reducers/guestReducer';
import bookingReducer from './../reducers/bookingReducer';
import channelReducer from './../reducers/channelReducer';
import userReducer from './../reducers/userReducer';
import navigationReducer from './../reducers/navigationReducer';
import actionReducer from '../reducers/actionReducer';
import sessionReducer from './../reducers/sessionReducer';
import userTypeReducer from './../reducers/userTypeReducer';
import productTypeReducer from '../reducers/productTypeReducer';
import productReducer from '../reducers/productReducer';
import moduleReducer from '../reducers/moduleReducer';
import rolePagePermissionReducer from '../reducers/rolePagePermissionReducer';
import roleModulePermissionReducer from '../reducers/roleModulePermissionReducer';
import pageReducer from '../reducers/pageReducer';
import counterReducer from '../reducers/counterReducer';
import counterProductsReducer from '../reducers/counterProductsReducer';
import counterUsersReducer from '../reducers/counterUsersReducer';
import payReducer from '../reducers/payReducer';
import reportsNavBarActiveKeyReducer from '../reducers/reportsNavBarActiveKeyReducer';
import reviewsReducer from '../reducers/reviewsReducer';
import nightReportReducer from '../reducers/nightReportReducer';
import accessControlReducer from '../reducers/accessControlReducer';
import catalogReducer from './catalogSlice';
import counterRegistryReducer from './counterRegistrySlice';
import addonReducer from '../reducers/addonReducer';
import paymentMethodReducer from '../reducers/paymentMethodReducer';
import productAddonReducer from '../reducers/productAddonReducer';
import productPriceReducer from '../reducers/productPriceReducer';
import channelCommissionReducer from '../reducers/channelCommissionReducer';
import channelProductPriceReducer from '../reducers/channelProductPriceReducer';
import venueReducer from '../reducers/venueReducer';
import venueCompensationTermReducer from '../reducers/venueCompensationTermReducer';
import financeReducer from '../reducers/financeReducer';
import staffProfileReducer from '../reducers/staffProfileReducer';
import reviewPlatformReducer from '../reducers/reviewPlatformReducer';
import compensationComponentReducer from '../reducers/compensationComponentReducer';
import assistantManagerTaskReducer from '../reducers/assistantManagerTaskReducer';
import reviewCounterReducer from '../reducers/reviewCounterReducer';

const reducer = {
  guests: guestReducer,
  bookings: bookingReducer,
  channels: channelReducer,
  users: userReducer,
  actions: actionReducer,
  navigation: navigationReducer,
  session: sessionReducer,
  userTypes: userTypeReducer,
  productTypes: productTypeReducer,
  products: productReducer,
  addons: addonReducer,
  productPrices: productPriceReducer,
  paymentMethods: paymentMethodReducer,
  productAddons: productAddonReducer,
  channelCommissions: channelCommissionReducer,
  channelProductPrices: channelProductPriceReducer,
  venues: venueReducer,
  venueCompensationTerms: venueCompensationTermReducer,
  modules: moduleReducer,
  rolePagePermissions: rolePagePermissionReducer,
  roleModulePermissions: roleModulePermissionReducer,
  pages: pageReducer,
  counters: counterReducer,
  counterProducts: counterProductsReducer,
  counterUsers: counterUsersReducer,
  catalog: catalogReducer,
  counterRegistry: counterRegistryReducer,
  pays: payReducer,
  reportsNavBarActiveKey: reportsNavBarActiveKeyReducer,
  reviews: reviewsReducer,
  nightReports: nightReportReducer,
  accessControl: accessControlReducer,
  finance: financeReducer,
  staffProfiles: staffProfileReducer,
  reviewPlatforms: reviewPlatformReducer,
  compensationComponents: compensationComponentReducer,
  assistantManagerTasks: assistantManagerTaskReducer,
  reviewCounters: reviewCounterReducer,
};

export const store = configureStore({
  reducer,
  devTools: process.env.NODE_ENV !== 'production',
  // If you have additional middleware, you can add them here
  // middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(yourAdditionalMiddleware),
});

// Infer the `RootState` and `AppDispatch` types from the store itself
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
