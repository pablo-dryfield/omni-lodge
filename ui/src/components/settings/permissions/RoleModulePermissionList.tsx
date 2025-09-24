import { useEffect, useMemo } from "react";
import { useAppDispatch, useAppSelector } from "../../../store/hooks";
import {
  fetchRoleModulePermissions,
  deleteRoleModulePermission,
  createRoleModulePermission,
  updateRoleModulePermission,
} from "../../../actions/roleModulePermissionActions";
import { fetchModules } from "../../../actions/moduleActions";
import { fetchActions } from "../../../actions/actionActions";
import { fetchUserTypes } from "../../../actions/userTypeActions";
import Table from "../../../utils/Table";
import { modifyColumn } from "../../../utils/modifyColumn";
import { getChangedValues } from "../../../utils/getChangedValues";
import { removeEmptyKeys } from "../../../utils/removeEmptyKeys";
import { type MRT_ColumnDef } from "mantine-react-table";
import { RoleModulePermission } from "../../../types/permissions/RoleModulePermission";
import { roleModulePermissionColumnDef } from "./roleModulePermissionColumnDef";
import { fetchAccessSnapshot } from "../../../actions/accessControlActions";

const MODULE_SLUG = "settings-module-permissions";

const coercePayload = (payload: Partial<RoleModulePermission>) => {
  const next: Partial<RoleModulePermission> = { ...payload };

  if (next.userTypeId !== undefined && next.userTypeId !== null) {
    next.userTypeId = Number(next.userTypeId);
  }

  if (next.moduleId !== undefined && next.moduleId !== null) {
    next.moduleId = Number(next.moduleId);
  }

  if (next.actionId !== undefined && next.actionId !== null) {
    next.actionId = Number(next.actionId);
  }

  if (next.allowed !== undefined && next.allowed !== null) {
    next.allowed = Boolean(next.allowed);
  }

  if (next.status !== undefined && next.status !== null) {
    next.status = Boolean(next.status);
  }

  return next;
};

const RoleModulePermissionList = ({ pageTitle }: { pageTitle?: string }) => {
  const dispatch = useAppDispatch();
  const { data, loading, error } = useAppSelector((state) => state.roleModulePermissions)[0];
  const modulesState = useAppSelector((state) => state.modules)[0];
  const actionsState = useAppSelector((state) => state.actions)[0];
  const userTypesState = useAppSelector((state) => state.userTypes)[0];
  const { currentPage } = useAppSelector((state) => state.navigation);
  const { loggedUserId } = useAppSelector((state) => state.session);

  useEffect(() => {
    dispatch(fetchRoleModulePermissions());
  }, [dispatch]);

  useEffect(() => {
    if (!modulesState.data[0]?.data?.length) {
      dispatch(fetchModules());
    }
  }, [dispatch, modulesState.data]);

  useEffect(() => {
    if (!actionsState.data[0]?.data?.length) {
      dispatch(fetchActions());
    }
  }, [dispatch, actionsState.data]);

  useEffect(() => {
    if (!userTypesState.data[0]?.data?.length) {
      dispatch(fetchUserTypes());
    }
  }, [dispatch, userTypesState.data]);

  const moduleRecords = useMemo(() => modulesState.data[0]?.data || [], [modulesState.data]);
  const moduleLabelById = useMemo(() => {
    const map = new Map<number, string>();
    moduleRecords.forEach((moduleRecord) => {
      if (typeof moduleRecord.id === "number") {
        const label = moduleRecord.name ?? moduleRecord.slug ?? `Module ${moduleRecord.id}`;
        map.set(moduleRecord.id, label);
      }
    });
    return map;
  }, [moduleRecords]);

  const actionRecords = useMemo(() => actionsState.data[0]?.data || [], [actionsState.data]);
  const actionLabelById = useMemo(() => {
    const map = new Map<number, string>();
    actionRecords.forEach((actionRecord) => {
      if (typeof actionRecord.id === "number") {
        const label = actionRecord.name ?? actionRecord.key ?? `Action ${actionRecord.id}`;
        map.set(actionRecord.id, label);
      }
    });
    return map;
  }, [actionRecords]);

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

  const handleCreate = async (draft: Partial<RoleModulePermission>) => {
    const sanitized = removeEmptyKeys(coercePayload(draft), loggedUserId);
    if (
      Object.keys(sanitized).some((key) => key !== "createdBy") &&
      Object.keys(sanitized).length !== 0
    ) {
      await dispatch(createRoleModulePermission(sanitized));
      dispatch(fetchRoleModulePermissions());
      dispatch(fetchAccessSnapshot());
    }
  };

  const handleUpdate = async (
    original: Partial<RoleModulePermission>,
    updatedDraft: Partial<RoleModulePermission>
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
        await dispatch(updateRoleModulePermission({ id: recordId, updates: delta }));
        dispatch(fetchRoleModulePermissions());
        dispatch(fetchAccessSnapshot());
      }
    } else {
      console.error("Role module permission ID is undefined.");
    }
  };

  const handleDelete = async (
    draft: Partial<RoleModulePermission>,
    count: number,
    iterator: number
  ) => {
    if (typeof draft.id === "number") {
      await dispatch(deleteRoleModulePermission(draft.id));
      if (count === iterator) {
        dispatch(fetchRoleModulePermissions());
        dispatch(fetchAccessSnapshot());
      }
    } else {
      console.error("Role module permission ID is undefined.");
    }
  };

  const modifiedColumns = useMemo<MRT_ColumnDef<Partial<RoleModulePermission>>[]>(
    () =>
      modifyColumn(
        data[0]?.columns || [],
        roleModulePermissionColumnDef({
          userTypeLabelById,
          moduleLabelById,
          actionLabelById,
        })
      ),
    [data, userTypeLabelById, moduleLabelById, actionLabelById]
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

export default RoleModulePermissionList;
