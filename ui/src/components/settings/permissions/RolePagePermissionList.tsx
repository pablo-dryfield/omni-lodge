import { useEffect, useMemo } from "react";
import { useAppDispatch, useAppSelector } from "../../../store/hooks";
import {
  fetchRolePagePermissions,
  deleteRolePagePermission,
  createRolePagePermission,
  updateRolePagePermission,
} from "../../../actions/rolePagePermissionActions";
import { fetchPages } from "../../../actions/pageActions";
import { fetchUserTypes } from "../../../actions/userTypeActions";
import Table from "../../../utils/Table";
import { modifyColumn } from "../../../utils/modifyColumn";
import { getChangedValues } from "../../../utils/getChangedValues";
import { removeEmptyKeys } from "../../../utils/removeEmptyKeys";
import { type MRT_ColumnDef } from "mantine-react-table";
import { RolePagePermission } from "../../../types/permissions/RolePagePermission";
import { rolePagePermissionColumnDef } from "./rolePagePermissionColumnDef";
import { fetchAccessSnapshot } from "../../../actions/accessControlActions";

const MODULE_SLUG = "settings-page-permissions";

const coercePayload = (payload: Partial<RolePagePermission>) => {
  const next: Partial<RolePagePermission> = { ...payload };

  if (next.userTypeId !== undefined && next.userTypeId !== null) {
    next.userTypeId = Number(next.userTypeId);
  }

  if (next.pageId !== undefined && next.pageId !== null) {
    next.pageId = Number(next.pageId);
  }

  if (next.canView !== undefined && next.canView !== null) {
    next.canView = Boolean(next.canView);
  }

  if (next.status !== undefined && next.status !== null) {
    next.status = Boolean(next.status);
  }

  return next;
};

const RolePagePermissionList = ({ pageTitle }: { pageTitle?: string }) => {
  const dispatch = useAppDispatch();
  const { data, loading, error } = useAppSelector((state) => state.rolePagePermissions)[0];
  const pagesState = useAppSelector((state) => state.pages)[0];
  const userTypesState = useAppSelector((state) => state.userTypes)[0];
  const { currentPage } = useAppSelector((state) => state.navigation);
  const { loggedUserId } = useAppSelector((state) => state.session);

  useEffect(() => {
    dispatch(fetchRolePagePermissions());
  }, [dispatch]);

  useEffect(() => {
    if (!pagesState.data[0]?.data?.length) {
      dispatch(fetchPages());
    }
  }, [dispatch, pagesState.data]);

  useEffect(() => {
    if (!userTypesState.data[0]?.data?.length) {
      dispatch(fetchUserTypes());
    }
  }, [dispatch, userTypesState.data]);

  const pageRecords = useMemo(() => pagesState.data[0]?.data || [], [pagesState.data]);
  const pageLabelById = useMemo(() => {
    const map = new Map<number, string>();
    pageRecords.forEach((page) => {
      if (typeof page.id === "number") {
        const label = page.name ?? page.slug ?? `Page ${page.id}`;
        map.set(page.id, label);
      }
    });
    return map;
  }, [pageRecords]);

  const userTypeRecords = useMemo(() => userTypesState.data[0]?.data || [], [userTypesState.data]);
  const userTypeLabelById = useMemo(() => {
    const map = new Map<number, string>();
    userTypeRecords.forEach((role) => {
      if (typeof role.id === "number") {
        map.set(role.id, role.name ?? role.slug ?? `Role ${role.id}`);
      }
    });
    return map;
  }, [userTypeRecords]);

  const initialState = {
    showColumnFilters: false,
    showGlobalFilter: true,
    columnVisibility: {
      id: false,
      createdBy: false,
      updatedBy: false,
    },
  };

  const handleCreate = async (draft: Partial<RolePagePermission>) => {
    const sanitized = removeEmptyKeys(coercePayload(draft), loggedUserId);
    if (
      Object.keys(sanitized).some((key) => key !== "createdBy") &&
      Object.keys(sanitized).length !== 0
    ) {
      await dispatch(createRolePagePermission(sanitized));
      dispatch(fetchRolePagePermissions());
      dispatch(fetchAccessSnapshot());
    }
  };

  const handleUpdate = async (
    original: Partial<RolePagePermission>,
    updatedDraft: Partial<RolePagePermission>
  ) => {
    const recordId = original.id;
    const delta = getChangedValues(
      original,
      coercePayload(updatedDraft),
      loggedUserId
    );

    if (typeof recordId === "number") {
      if (
        Object.keys(delta).some((key) => key !== "updatedBy") &&
        Object.keys(delta).length !== 0
      ) {
        await dispatch(updateRolePagePermission({ id: recordId, updates: delta }));
        dispatch(fetchRolePagePermissions());
        dispatch(fetchAccessSnapshot());
      }
    } else {
      console.error("Role page permission ID is undefined.");
    }
  };

  const handleDelete = async (
    draft: Partial<RolePagePermission>,
    count: number,
    iterator: number
  ) => {
    if (typeof draft.id === "number") {
      await dispatch(deleteRolePagePermission(draft.id));
      if (count === iterator) {
        dispatch(fetchRolePagePermissions());
        dispatch(fetchAccessSnapshot());
      }
    } else {
      console.error("Role page permission ID is undefined.");
    }
  };

  const modifiedColumns = useMemo<MRT_ColumnDef<Partial<RolePagePermission>>[]>(
    () =>
      modifyColumn(
        data[0]?.columns || [],
        rolePagePermissionColumnDef({ userTypeLabelById, pageLabelById })
      ),
    [data, userTypeLabelById, pageLabelById]
  );

  const headerTitle = pageTitle ?? currentPage;

  return (
    <Table
      pageTitle={headerTitle}
      data={data[0]?.data || []}
      loading={loading}
      error={error}
      columns={modifiedColumns}
      actions={{ handleDelete, handleCreate, handleUpdate }}
      initialState={initialState}
      moduleSlug={MODULE_SLUG}
    />
  );
};

export default RolePagePermissionList;
