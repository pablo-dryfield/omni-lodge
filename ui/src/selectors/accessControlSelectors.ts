import { createSelector } from "@reduxjs/toolkit";
import { baseNavigationPages } from "../reducers/navigationReducer";
import { NavigationPage } from "../types/general/NavigationState";
import { RootState } from "../store/store";
import { PAGE_SLUGS } from "../constants/pageSlugs";

const selectAccessControlState = (state: RootState) => state.accessControl;

const MODULE_SLUG_TO_PAGE_SLUG: Record<string, string> = {
  "am-task-management": PAGE_SLUGS.assistantManagerTasks,
};

const PAGE_SLUG_ALIASES: Record<string, string[]> = {
  [PAGE_SLUGS.reports]: [PAGE_SLUGS.openBarControl],
};

export const selectAllowedPageSlugs = createSelector(selectAccessControlState, ({ pages, modules }) => {
  const allowedSlugs = new Set(pages);

  pages.forEach((pageSlug) => {
    const aliases = PAGE_SLUG_ALIASES[pageSlug];
    if (!aliases) {
      return;
    }
    aliases.forEach((alias) => allowedSlugs.add(alias));
  });

  Object.keys(modules).forEach((moduleSlug) => {
    const mappedPageSlug = MODULE_SLUG_TO_PAGE_SLUG[moduleSlug];
    if (mappedPageSlug) {
      allowedSlugs.add(mappedPageSlug);
    }
  });

  return allowedSlugs;
});

export const selectAllowedNavigationPages = createSelector(
  selectAccessControlState,
  selectAllowedPageSlugs,
  ({ loaded }, allowedSlugs): NavigationPage[] => {
    if (!loaded) {
      return [];
    }

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
