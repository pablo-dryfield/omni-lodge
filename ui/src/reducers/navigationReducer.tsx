import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { NavigationState, NavigationPage } from "../types/general/NavigationState";
import { PAGE_SLUGS } from "../constants/pageSlugs";

export const baseNavigationPages: NavigationPage[] = [
  { name: "Bookings", path: "/bookings", slug: PAGE_SLUGS.bookings, icon: 'eventAvailable' },
  { name: "Manifest", path: "/bookings/manifest", slug: PAGE_SLUGS.bookingsManifest, icon: 'assignmentTurnedIn' },
  { name: "Product Types", path: "/productTypes", slug: PAGE_SLUGS.productTypes, icon: 'person' },
  { name: "Product", path: "/products", slug: PAGE_SLUGS.products, icon: 'person' },
  { name: "Add-Ons", path: "/addons", slug: PAGE_SLUGS.addons, icon: 'extension' },
  { name: "Product Add-Ons", path: "/product-addons", slug: PAGE_SLUGS.productAddons, icon: 'layers' },
  { name: "Payment Methods", path: "/payment-methods", slug: PAGE_SLUGS.paymentMethods, icon: 'creditCard' },
  { name: "Actions", path: "/actions", slug: PAGE_SLUGS.actionsDirectory, icon: 'bolt' },
  { name: "Counters", path: "/counters", slug: PAGE_SLUGS.counters, icon: 'person' },
  { name: "Staff Payment", path: "/pays", slug: PAGE_SLUGS.pays, icon: 'person' },
  { name: "Reports", path: "/reports", slug: PAGE_SLUGS.reports, icon: 'person' },
  { name: "Settings", path: "/settings", slug: PAGE_SLUGS.settings, icon: 'settings' },
];

const initialState: NavigationState = {
  currentPage: "/",
  pages: baseNavigationPages,
};

const navigationSlice = createSlice({
  name: "navigation",
  initialState,
  reducers: {
    setCurrentPage: (state, action: PayloadAction<string>) => {
      state.currentPage = action.payload;
    },
    setPages: (state, action: PayloadAction<NavigationPage[]>) => {
      state.pages = action.payload;
    },
  },
});

export const { setCurrentPage, setPages } = navigationSlice.actions;
export default navigationSlice.reducer;



