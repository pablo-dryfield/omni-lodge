import { createSelector } from "@reduxjs/toolkit";
import { baseNavigationPages } from "../reducers/navigationReducer";
import { NavigationPage } from "../types/general/NavigationState";
import { RootState } from "../store/store";

const selectAccessControlState = (state: RootState) => state.accessControl;

export const selectAllowedPageSlugs = createSelector(
  selectAccessControlState,
  ({ pages }) => new Set(pages),
);

export const selectAllowedNavigationPages = createSelector(
  selectAccessControlState,
  ({ loaded, pages }): NavigationPage[] => {
    if (!loaded) {
      return [];
    }

    const allowedSlugs = new Set(pages);
    return baseNavigationPages.filter((page) => allowedSlugs.has(page.slug));
  },
);

export const selectModulePermissionsMap = createSelector(selectAccessControlState, ({ modules }) => {
  const permissionMap = new Map<string, Set<string>>();

  Object.entries(modules).forEach(([moduleSlug, actions]) => {
    permissionMap.set(moduleSlug, new Set(actions));
  });

  return permissionMap;
});

export const makeSelectIsPageAllowed = (pageSlug: string) =>
  createSelector(selectAllowedPageSlugs, (allowedSlugs) => allowedSlugs.has(pageSlug));

export const makeSelectIsModuleActionAllowed = (moduleSlug: string, actionKey: string) =>
  createSelector(selectModulePermissionsMap, (permissionMap) =>
    permissionMap.get(moduleSlug)?.has(actionKey) ?? false,
  );
