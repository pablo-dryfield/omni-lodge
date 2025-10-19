import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { NavigationState, NavigationPage } from "../types/general/NavigationState";
import { PAGE_SLUGS } from "../constants/pageSlugs";

export const baseNavigationPages: NavigationPage[] = [
  { name: "Ecwid Bookings", path: "/bookings", slug: PAGE_SLUGS.bookings, icon: 'eventAvailable' },
  { name: "Counters", path: "/counters", slug: PAGE_SLUGS.counters, icon: 'person' },
  { name: "Venue Numbers", path: "/venueNumbers", slug: PAGE_SLUGS.venueNumbers, icon: 'formatListNumbered' },
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



