import { useMemo, useEffect, useRef, useState } from "react";
import { Alert, Button, Group, Menu, Modal, Select, Stack, Text } from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import {
  fetchUserTypes,
  deleteUserType,
  createUserType,
  updateUserType,
} from "../../actions/userTypeActions";
import Table from "../../utils/Table";
import { UserType } from "../../types/userTypes/UserType";
import { modifyColumn } from "../../utils/modifyColumn";
import { userTypesColumnDef } from "./userTypesColumnDef";
import { type MRT_ColumnDef, type MRT_TableInstance } from "mantine-react-table";
import { removeEmptyKeys } from "../../utils/removeEmptyKeys";
import { getChangedValues } from "../../utils/getChangedValues";
import { applyUserTypePermissions, type UserTypePermissionAction } from "../../api/userTypes";
import { useModuleAccess } from "../../hooks/useModuleAccess";

const DEFAULT_MODULE_SLUG = "settings-user-types-admin";

type UserTypeListProps = {
  pageTitle?: string;
  moduleSlug?: string;
};

const UserTypeList = ({ pageTitle, moduleSlug = DEFAULT_MODULE_SLUG }: UserTypeListProps) => {
  const dispatch = useAppDispatch();
  const { data, loading, error } = useAppSelector((state) => state.userTypes)[0];
  const { currentPage } = useAppSelector((state) => state.navigation);
  const { loggedUserId } = useAppSelector((state) => state.session);
  const moduleAccess = useModuleAccess(moduleSlug);
  const tableRef = useRef<MRT_TableInstance<Partial<UserType>> | null>(null);
  const [permissionTarget, setPermissionTarget] = useState<Partial<UserType> | null>(null);
  const [confirmAction, setConfirmAction] = useState<UserTypePermissionAction | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copySourceId, setCopySourceId] = useState<string | null>(null);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [permissionSuccess, setPermissionSuccess] = useState<string | null>(null);
  const [permissionLoading, setPermissionLoading] = useState(false);

  const initialState = {
    showColumnFilters: false,
    showGlobalFilter: true,
    columnVisibility: {
      id: false,
    },
  };

  useEffect(() => {
    dispatch(fetchUserTypes());
  }, [dispatch]);

  const userTypeRecords = useMemo(() => data[0]?.data || [], [data]);

  const extractErrorMessage = (err: unknown): string => {
    if (typeof err === "object" && err !== null) {
      const maybeResponse = (err as { response?: { data?: unknown } }).response;
      if (maybeResponse?.data) {
        const payload = maybeResponse.data;
        if (typeof payload === "string") {
          return payload;
        }
        if (Array.isArray(payload) && payload.length > 0) {
          const first = payload[0];
          if (first && typeof first === "object" && "message" in first && typeof first.message === "string") {
            return first.message;
          }
        }
        if (typeof (payload as { message?: unknown }).message === "string") {
          return (payload as { message: string }).message;
        }
      }
    }

    if (err instanceof Error) {
      return err.message;
    }

    return "Unexpected error occurred";
  };

  const clearPermissionMessages = () => {
    setPermissionError(null);
    setPermissionSuccess(null);
  };

  const handlePermissionAction = async (action: UserTypePermissionAction, sourceUserTypeId?: number | null) => {
    if (!permissionTarget?.id) {
      return;
    }
    setPermissionLoading(true);
    clearPermissionMessages();
    try {
      const response = await applyUserTypePermissions({
        userTypeId: permissionTarget.id,
        action,
        sourceUserTypeId,
      });
      setPermissionSuccess(
        `${response.message} Updated ${response.pagesApplied} pages and ${response.modulePermissionsApplied} module actions.`,
      );
      tableRef.current?.setRowSelection({});
      setPermissionTarget(null);
    } catch (err) {
      setPermissionError(extractErrorMessage(err));
    } finally {
      setPermissionLoading(false);
    }
  };

  const openConfirm = (action: UserTypePermissionAction, target: Partial<UserType>) => {
    setPermissionTarget(target);
    setConfirmAction(action);
    setCopyOpen(false);
    setCopySourceId(null);
    clearPermissionMessages();
  };

  const openCopy = (target: Partial<UserType>) => {
    setPermissionTarget(target);
    setConfirmAction(null);
    setCopyOpen(true);
    setCopySourceId(null);
    clearPermissionMessages();
  };

  const handleCreate = async (dataCreate: Partial<UserType>) => {
    const dataCreated = removeEmptyKeys(dataCreate, loggedUserId);
    if (
      Object.keys(dataCreated).some((key) => key !== "createdBy") &&
      Object.keys(dataCreated).length !== 0
    ) {
      await dispatch(createUserType(dataCreated));
      dispatch(fetchUserTypes());
    }
  };

  const handleUpdate = async (
    originalData: Partial<UserType>,
    dataUpdated: Partial<UserType>
  ) => {
    const dataId = originalData.id;
    const dataUpdate = getChangedValues(originalData, dataUpdated, loggedUserId);
    if (typeof dataId === "number") {
      if (
        Object.keys(dataUpdate).some((key) => key !== "updatedBy") &&
        Object.keys(dataUpdate).length !== 0
      ) {
        await dispatch(
          updateUserType({ userTypeId: dataId, userTypeData: dataUpdate })
        );
        dispatch(fetchUserTypes());
      }
    } else {
      console.error("UserType ID is undefined.");
    }
  };

  const handleDelete = async (
    dataDelete: Partial<UserType>,
    count: number,
    iterator: number
  ) => {
    if (typeof dataDelete.id === "number") {
      await dispatch(deleteUserType(dataDelete.id));
      if (count === iterator) {
        dispatch(fetchUserTypes());
      }
    } else {
      console.error("UserType ID is undefined.");
    }
  };

  const modifiedColumns = useMemo<MRT_ColumnDef<Partial<UserType>>[]>(
    () => modifyColumn(data[0]?.columns || [], userTypesColumnDef),
    [data]
  );

  const headerTitle = pageTitle ?? currentPage;

  return (
    <Stack gap="md">
      {permissionError ? (
        <Alert color="red" icon={<IconAlertCircle size={16} />}>
          {permissionError}
        </Alert>
      ) : null}
      {permissionSuccess ? (
        <Alert color="teal">
          {permissionSuccess}
        </Alert>
      ) : null}
      <Table
        pageTitle={headerTitle}
        data={userTypeRecords}
        loading={loading}
        error={error}
        columns={modifiedColumns}
        actions={{ handleDelete, handleCreate, handleUpdate }}
        initialState={initialState}
        moduleSlug={moduleSlug}
        renderToolbarActions={(table) => {
          tableRef.current = table;
          const selectedRows = table.getSelectedRowModel().flatRows;
          const selected = selectedRows.length === 1 ? selectedRows[0]?.original : null;
          const disabled =
            !moduleAccess.ready ||
            !moduleAccess.canUpdate ||
            permissionLoading ||
            selectedRows.length !== 1 ||
            !selected?.id;

          return (
            <Menu withinPortal position="bottom-end">
              <Menu.Target>
                <Button variant="light" disabled={disabled}>
                  Permissions
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item
                  color="red"
                  disabled={disabled}
                  onClick={() => selected && openConfirm("remove_all", selected)}
                >
                  Remove all permissions
                </Menu.Item>
                <Menu.Item
                  disabled={disabled}
                  onClick={() => selected && openConfirm("add_all", selected)}
                >
                  Add all permissions
                </Menu.Item>
                <Menu.Item
                  disabled={disabled}
                  onClick={() => selected && openCopy(selected)}
                >
                  Copy permissions
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          );
        }}
      />

      <Modal
        opened={confirmAction != null}
        onClose={() => {
          if (permissionLoading) {
            return;
          }
          setConfirmAction(null);
          setPermissionTarget(null);
        }}
        title="Confirm permission update"
        centered
      >
        <Stack gap="md">
          <Text size="sm">
            {confirmAction === "add_all"
              ? "Grant all page and module permissions to"
              : "Remove all page and module permissions from"}{" "}
            <strong>{permissionTarget?.name ?? `User Type #${permissionTarget?.id ?? ""}`}</strong>?
          </Text>
          <Text size="sm" c="dimmed">
            This will overwrite existing permissions for this user type.
          </Text>
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => {
                if (permissionLoading) {
                  return;
                }
                setConfirmAction(null);
                setPermissionTarget(null);
              }}
            >
              Cancel
            </Button>
            <Button
              color={confirmAction === "remove_all" ? "red" : "blue"}
              onClick={() => {
                if (!confirmAction) {
                  return;
                }
                handlePermissionAction(confirmAction);
                setConfirmAction(null);
              }}
              loading={permissionLoading}
            >
              Confirm
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={copyOpen}
        onClose={() => {
          if (permissionLoading) {
            return;
          }
          setCopyOpen(false);
          setPermissionTarget(null);
          setCopySourceId(null);
        }}
        title="Copy permissions"
        centered
      >
        <Stack gap="md">
          <Text size="sm">
            Copy permissions from another user type to{" "}
            <strong>{permissionTarget?.name ?? `User Type #${permissionTarget?.id ?? ""}`}</strong>.
          </Text>
          <Select
            label="Source user type"
            placeholder="Select a user type"
            data={userTypeRecords
              .filter((record) => typeof record.id === "number" && record.id !== permissionTarget?.id)
              .map((record) => ({
                value: String(record.id),
                label: record.name ?? `User Type #${record.id}`,
              }))}
            value={copySourceId}
            onChange={setCopySourceId}
            searchable
          />
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => {
                if (permissionLoading) {
                  return;
                }
                setCopyOpen(false);
                setPermissionTarget(null);
                setCopySourceId(null);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!copySourceId || !permissionTarget?.id) {
                  setPermissionError("Select a source user type to copy from.");
                  return;
                }
                handlePermissionAction("copy_from", Number(copySourceId));
                setCopyOpen(false);
              }}
              loading={permissionLoading}
            >
              Copy
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
};

export default UserTypeList;
