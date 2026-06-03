import {
  AnyAction,
  Reducer,
  ReducersMapObject,
  combineReducers,
  configureStore,
} from "@reduxjs/toolkit";
import userReducer from "../reducers/userReducer";
import navigationReducer from "../reducers/navigationReducer";
import sessionReducer from "../reducers/sessionReducer";
import accessControlReducer from "../reducers/accessControlReducer";

type SliceState<TModule> = TModule extends { default: Reducer<infer TState, AnyAction> }
  ? TState
  : never;

type GuestState = SliceState<typeof import("../reducers/guestReducer")>;
type BookingState = SliceState<typeof import("../reducers/bookingReducer")>;
type ChannelState = SliceState<typeof import("../reducers/channelReducer")>;
type UserState = SliceState<typeof import("../reducers/userReducer")>;
type NavigationState = SliceState<typeof import("../reducers/navigationReducer")>;
type ActionState = SliceState<typeof import("../reducers/actionReducer")>;
type SessionState = SliceState<typeof import("../reducers/sessionReducer")>;
type UserTypeState = SliceState<typeof import("../reducers/userTypeReducer")>;
type ProductTypeState = SliceState<typeof import("../reducers/productTypeReducer")>;
type ProductState = SliceState<typeof import("../reducers/productReducer")>;
type ProductAliasState = SliceState<typeof import("../reducers/productAliasReducer")>;
type ModuleState = SliceState<typeof import("../reducers/moduleReducer")>;
type RolePagePermissionState = SliceState<typeof import("../reducers/rolePagePermissionReducer")>;
type RoleModulePermissionState = SliceState<typeof import("../reducers/roleModulePermissionReducer")>;
type PageState = SliceState<typeof import("../reducers/pageReducer")>;
type CounterState = SliceState<typeof import("../reducers/counterReducer")>;
type CounterProductsState = SliceState<typeof import("../reducers/counterProductsReducer")>;
type CounterUsersState = SliceState<typeof import("../reducers/counterUsersReducer")>;
type PayState = SliceState<typeof import("../reducers/payReducer")>;
type ReportsNavBarActiveKeyState = SliceState<typeof import("../reducers/reportsNavBarActiveKeyReducer")>;
type ReviewsState = SliceState<typeof import("../reducers/reviewsReducer")>;
type NightReportsState = SliceState<typeof import("../reducers/nightReportReducer")>;
type AccessControlState = SliceState<typeof import("../reducers/accessControlReducer")>;
type CatalogState = SliceState<typeof import("./catalogSlice")>;
type CounterRegistryState = SliceState<typeof import("./counterRegistrySlice")>;
type AddonState = SliceState<typeof import("../reducers/addonReducer")>;
type PaymentMethodState = SliceState<typeof import("../reducers/paymentMethodReducer")>;
type ProductAddonState = SliceState<typeof import("../reducers/productAddonReducer")>;
type ProductPriceState = SliceState<typeof import("../reducers/productPriceReducer")>;
type ChannelCommissionState = SliceState<typeof import("../reducers/channelCommissionReducer")>;
type ChannelProductPriceState = SliceState<typeof import("../reducers/channelProductPriceReducer")>;
type VenueState = SliceState<typeof import("../reducers/venueReducer")>;
type VenueCompensationTermState = SliceState<typeof import("../reducers/venueCompensationTermReducer")>;
type VenueCompensationTermRateState = SliceState<
  typeof import("../reducers/venueCompensationTermRateReducer")
>;
type FinanceState = SliceState<typeof import("../reducers/financeReducer")>;
type StaffProfileState = SliceState<typeof import("../reducers/staffProfileReducer")>;
type ReviewPlatformState = SliceState<typeof import("../reducers/reviewPlatformReducer")>;
type CompensationComponentState = SliceState<typeof import("../reducers/compensationComponentReducer")>;
type AssistantManagerTaskState = SliceState<typeof import("../reducers/assistantManagerTaskReducer")>;
type ReviewCounterState = SliceState<typeof import("../reducers/reviewCounterReducer")>;

export interface StateSchema {
  guests: GuestState;
  bookings: BookingState;
  channels: ChannelState;
  users: UserState;
  actions: ActionState;
  navigation: NavigationState;
  session: SessionState;
  userTypes: UserTypeState;
  productTypes: ProductTypeState;
  products: ProductState;
  productAliases: ProductAliasState;
  addons: AddonState;
  productPrices: ProductPriceState;
  paymentMethods: PaymentMethodState;
  productAddons: ProductAddonState;
  channelCommissions: ChannelCommissionState;
  channelProductPrices: ChannelProductPriceState;
  venues: VenueState;
  venueCompensationTerms: VenueCompensationTermState;
  venueCompensationTermRates: VenueCompensationTermRateState;
  modules: ModuleState;
  rolePagePermissions: RolePagePermissionState;
  roleModulePermissions: RoleModulePermissionState;
  pages: PageState;
  counters: CounterState;
  counterProducts: CounterProductsState;
  counterUsers: CounterUsersState;
  catalog: CatalogState;
  counterRegistry: CounterRegistryState;
  pays: PayState;
  reportsNavBarActiveKey: ReportsNavBarActiveKeyState;
  reviews: ReviewsState;
  nightReports: NightReportsState;
  accessControl: AccessControlState;
  finance: FinanceState;
  staffProfiles: StaffProfileState;
  reviewPlatforms: ReviewPlatformState;
  compensationComponents: CompensationComponentState;
  assistantManagerTasks: AssistantManagerTaskState;
  reviewCounters: ReviewCounterState;
}

export type StateSchemaKey = keyof StateSchema;
export type DynamicReducersMap = Partial<{
  [Key in StateSchemaKey]: Reducer<StateSchema[Key], AnyAction>;
}>;
type InternalReducersMap = Partial<Record<StateSchemaKey, Reducer>>;

interface ReducerManager {
  add: (key: StateSchemaKey, reducer: Reducer) => boolean;
  getReducerMap: () => InternalReducersMap;
  reduce: Reducer<StateSchema, AnyAction>;
}

const createReducerManager = (initialReducers: DynamicReducersMap): ReducerManager => {
  const reducers: InternalReducersMap = { ...initialReducers };
  let combinedReducer = combineReducers(reducers as ReducersMapObject<StateSchema, AnyAction>);

  return {
    add: (key, reducer) => {
      if (!key || reducers[key]) {
        return false;
      }

      reducers[key] = reducer;
      combinedReducer = combineReducers(reducers as ReducersMapObject<StateSchema, AnyAction>);
      return true;
    },
    getReducerMap: () => reducers,
    reduce: (state, action) => combinedReducer(state, action),
  };
};

const staticReducers: DynamicReducersMap = {
  users: userReducer,
  navigation: navigationReducer,
  session: sessionReducer,
  accessControl: accessControlReducer,
};

const reducerManager = createReducerManager(staticReducers);

const configuredStore = configureStore({
  reducer: reducerManager.reduce,
  devTools: process.env.NODE_ENV !== "production",
});

export const store = Object.assign(configuredStore, { reducerManager });

export const injectReducers = (reducers: DynamicReducersMap) => {
  let changed = false;

  for (const [key, reducer] of Object.entries(reducers) as Array<
    [StateSchemaKey, Reducer<StateSchema[StateSchemaKey], AnyAction>]
  >) {
    changed = store.reducerManager.add(key, reducer) || changed;
  }

  if (changed) {
    store.replaceReducer(store.reducerManager.reduce);
  }
};

export type RootState = StateSchema;
export type AppDispatch = typeof store.dispatch;
