import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import PersonIcon from "@mui/icons-material/Person";
import SettingsIcon from "@mui/icons-material/Settings";
import { NavigationState, NavigationPage } from "../types/general/NavigationState";
import { PAGE_SLUGS } from "../constants/pageSlugs";

export const baseNavigationPages: NavigationPage[] = [
  { name: "Product Types", path: "/productTypes", slug: PAGE_SLUGS.productTypes, icon: <PersonIcon fontSize="large" /> },
  { name: "Product", path: "/products", slug: PAGE_SLUGS.products, icon: <PersonIcon fontSize="large" /> },
  { name: "Counters", path: "/counters", slug: PAGE_SLUGS.counters, icon: <PersonIcon fontSize="large" /> },
  { name: "Staff Payment", path: "/pays", slug: PAGE_SLUGS.pays, icon: <PersonIcon fontSize="large" /> },
  { name: "Reports", path: "/reports", slug: PAGE_SLUGS.reports, icon: <PersonIcon fontSize="large" /> },
  { name: "Settings", path: "/settings", slug: PAGE_SLUGS.settings, icon: <SettingsIcon fontSize="large" /> },
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