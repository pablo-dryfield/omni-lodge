import type { DynamicReducersMap } from "./store";

export const loadGuestsReducers = async (): Promise<DynamicReducersMap> => {
  const [{ default: guests }] = await Promise.all([import("../reducers/guestReducer")]);
  return { guests };
};

export const loadBookingsReducers = async (): Promise<DynamicReducersMap> => {
  const [{ default: bookings }] = await Promise.all([import("../reducers/bookingReducer")]);
  return { bookings };
};

export const loadCountersReducers = async (): Promise<DynamicReducersMap> => {
  const [
    { default: counters },
    { default: counterProducts },
    { default: counterUsers },
    { default: products },
    { default: catalog },
    { default: counterRegistry },
    { default: nightReports },
  ] = await Promise.all([
    import("../reducers/counterReducer"),
    import("../reducers/counterProductsReducer"),
    import("../reducers/counterUsersReducer"),
    import("../reducers/productReducer"),
    import("./catalogSlice"),
    import("./counterRegistrySlice"),
    import("../reducers/nightReportReducer"),
  ]);

  return {
    counters,
    counterProducts,
    counterUsers,
    products,
    catalog,
    counterRegistry,
    nightReports,
  };
};

export const loadVenueNumbersReducers = async (): Promise<DynamicReducersMap> => {
  const [
    { default: counters },
    { default: venues },
    { default: nightReports },
    { default: finance },
  ] = await Promise.all([
    import("../reducers/counterReducer"),
    import("../reducers/venueReducer"),
    import("../reducers/nightReportReducer"),
    import("../reducers/financeReducer"),
  ]);

  return {
    counters,
    venues,
    nightReports,
    finance,
  };
};

export const loadChannelNumbersReducers = async (): Promise<DynamicReducersMap> => {
  const [{ default: finance }] = await Promise.all([import("../reducers/financeReducer")]);
  return { finance };
};

export const loadPaysReducers = async (): Promise<DynamicReducersMap> => {
  const [
    { default: pays },
    { default: compensationComponents },
    { default: finance },
  ] = await Promise.all([
    import("../reducers/payReducer"),
    import("../reducers/compensationComponentReducer"),
    import("../reducers/financeReducer"),
  ]);

  return {
    pays,
    compensationComponents,
    finance,
  };
};

export const loadReportsReducers = async (): Promise<DynamicReducersMap> => {
  const [{ default: reportsNavBarActiveKey }, { default: reviews }] = await Promise.all([
    import("../reducers/reportsNavBarActiveKeyReducer"),
    import("../reducers/reviewsReducer"),
  ]);

  return {
    reportsNavBarActiveKey,
    reviews,
  };
};

export const loadMyAccountReducers = async (): Promise<DynamicReducersMap> => {
  const [{ default: staffProfiles }] = await Promise.all([import("../reducers/staffProfileReducer")]);
  return { staffProfiles };
};

export const loadFinanceReducers = async (): Promise<DynamicReducersMap> => {
  const [{ default: finance }, { default: staffProfiles }] = await Promise.all([
    import("../reducers/financeReducer"),
    import("../reducers/staffProfileReducer"),
  ]);

  return {
    finance,
    staffProfiles,
  };
};

export const loadSettingsReducers = async (): Promise<DynamicReducersMap> => {
  const [
    { default: actions },
    { default: userTypes },
    { default: productTypes },
    { default: products },
    { default: productAliases },
    { default: addons },
    { default: productPrices },
    { default: paymentMethods },
    { default: productAddons },
    { default: channels },
    { default: channelCommissions },
    { default: channelProductPrices },
    { default: venues },
    { default: venueCompensationTerms },
    { default: venueCompensationTermRates },
    { default: modules },
    { default: rolePagePermissions },
    { default: roleModulePermissions },
    { default: pages },
    { default: reviewPlatforms },
    { default: compensationComponents },
    { default: finance },
    { default: staffProfiles },
  ] = await Promise.all([
    import("../reducers/actionReducer"),
    import("../reducers/userTypeReducer"),
    import("../reducers/productTypeReducer"),
    import("../reducers/productReducer"),
    import("../reducers/productAliasReducer"),
    import("../reducers/addonReducer"),
    import("../reducers/productPriceReducer"),
    import("../reducers/paymentMethodReducer"),
    import("../reducers/productAddonReducer"),
    import("../reducers/channelReducer"),
    import("../reducers/channelCommissionReducer"),
    import("../reducers/channelProductPriceReducer"),
    import("../reducers/venueReducer"),
    import("../reducers/venueCompensationTermReducer"),
    import("../reducers/venueCompensationTermRateReducer"),
    import("../reducers/moduleReducer"),
    import("../reducers/rolePagePermissionReducer"),
    import("../reducers/roleModulePermissionReducer"),
    import("../reducers/pageReducer"),
    import("../reducers/reviewPlatformReducer"),
    import("../reducers/compensationComponentReducer"),
    import("../reducers/financeReducer"),
    import("../reducers/staffProfileReducer"),
  ]);

  return {
    actions,
    userTypes,
    productTypes,
    products,
    productAliases,
    addons,
    productPrices,
    paymentMethods,
    productAddons,
    channels,
    channelCommissions,
    channelProductPrices,
    venues,
    venueCompensationTerms,
    venueCompensationTermRates,
    modules,
    rolePagePermissions,
    roleModulePermissions,
    pages,
    reviewPlatforms,
    compensationComponents,
    finance,
    staffProfiles,
  };
};

export const loadAssistantManagerTaskReducers = async (): Promise<DynamicReducersMap> => {
  const [{ default: assistantManagerTasks }, { default: userTypes }] = await Promise.all([
    import("../reducers/assistantManagerTaskReducer"),
    import("../reducers/userTypeReducer"),
  ]);

  return {
    assistantManagerTasks,
    userTypes,
  };
};

export const loadReviewCountersReducers = async (): Promise<DynamicReducersMap> => {
  const [{ default: reviewCounters }, { default: reviews }] = await Promise.all([
    import("../reducers/reviewCounterReducer"),
    import("../reducers/reviewsReducer"),
  ]);
  return { reviewCounters, reviews };
};
