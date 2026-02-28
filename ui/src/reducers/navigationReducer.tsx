import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { NavigationState, NavigationPage } from "../types/general/NavigationState";
import { PAGE_SLUGS } from "../constants/pageSlugs";

export const baseNavigationPages: NavigationPage[] = [
  { name: "Bookings", path: "/bookings", slug: PAGE_SLUGS.bookings, icon: 'eventAvailable' },
  { name: "Counters", path: "/counters", slug: PAGE_SLUGS.counters, icon: 'person' },
  { name: "Venue Numbers", path: "/venueNumbers", slug: PAGE_SLUGS.venueNumbers, icon: 'formatListNumbered' },
  { name: "Channel Numbers", path: "/channelNumbers", slug: PAGE_SLUGS.channelNumbers, icon: 'barChart' },
  { name: "Reviews", path: "/reviews", slug: PAGE_SLUGS.reviews, icon: 'star' },
  { name: "Staff Payment", path: "/pays", slug: PAGE_SLUGS.pays, icon: 'person' },
  { name: "Cerebro", path: "/cerebro", slug: PAGE_SLUGS.cerebro, icon: 'assignmentTurnedIn' },
  { name: "Scheduling", path: "/scheduling", slug: PAGE_SLUGS.scheduling, icon: 'calendarMonth' },
  { name: "Task Planner", path: "/assistant-manager-tasks", slug: PAGE_SLUGS.assistantManagerTasks, icon: 'assignment' },
  { name: "Finance", path: "/finance", slug: PAGE_SLUGS.finance, icon: 'accountBalance' },
  { name: "Open Bar", path: "/open-bar", slug: PAGE_SLUGS.openBarControl, icon: 'barChart' },
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
