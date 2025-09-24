import { useMemo } from "react";
import { makeSelectIsModuleActionAllowed } from "../selectors/accessControlSelectors";
import { useAppSelector } from "../store/hooks";
import { RootState } from "../store/store";

export type ModulePermissionSet = {
  ready: boolean;
  loading: boolean;
  canView: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
};

const selectAlwaysTrue = (_state: RootState) => true;

export const useModuleAccess = (moduleSlug?: string): ModulePermissionSet => {
  const normalizedSlug = moduleSlug?.trim();
  const loading = useAppSelector((state) => state.accessControl.loading);
  const loaded = useAppSelector((state) => state.accessControl.loaded);

  const viewSelector = useMemo(
    () => (normalizedSlug ? makeSelectIsModuleActionAllowed(normalizedSlug, "view") : selectAlwaysTrue),
    [normalizedSlug],
  );
  const createSelector = useMemo(
    () => (normalizedSlug ? makeSelectIsModuleActionAllowed(normalizedSlug, "create") : selectAlwaysTrue),
    [normalizedSlug],
  );
  const updateSelector = useMemo(
    () => (normalizedSlug ? makeSelectIsModuleActionAllowed(normalizedSlug, "update") : selectAlwaysTrue),
    [normalizedSlug],
  );
  const deleteSelector = useMemo(
    () => (normalizedSlug ? makeSelectIsModuleActionAllowed(normalizedSlug, "delete") : selectAlwaysTrue),
    [normalizedSlug],
  );

  const viewAllowed = useAppSelector(viewSelector);
  const createAllowed = useAppSelector(createSelector);
  const updateAllowed = useAppSelector(updateSelector);
  const deleteAllowed = useAppSelector(deleteSelector);

  if (!normalizedSlug) {
    return {
      ready: true,
      loading: false,
      canView: true,
      canCreate: true,
      canUpdate: true,
      canDelete: true,
    };
  }

  return {
    ready: loaded,
    loading,
    canView: loaded ? viewAllowed : false,
    canCreate: loaded ? createAllowed : false,
    canUpdate: loaded ? updateAllowed : false,
    canDelete: loaded ? deleteAllowed : false,
  };
};
