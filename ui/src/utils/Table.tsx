import {
  MantineReactTable,
  useMantineReactTable,
  MRT_GlobalFilterTextInput as MRTGlobalFilterTextInput,
  MRT_ToggleFiltersButton as MRTToggleFiltersButton,
  MRT_Row,
} from "mantine-react-table";
import { Alert, Button, Center, Flex, Loader, Text } from "@mantine/core";
import { ModalsProvider, modals } from "@mantine/modals";
import { ModalContent } from "./ModalContent";
import cloneDeep from "lodash/cloneDeep";
import { useMemo, useState } from "react";
import { TableProps } from "../types/general/TableProps";
import { useModuleAccess } from "../hooks/useModuleAccess";

const Table = <T extends object>({
  pageTitle,
  data,
  loading,
  error,
  columns,
  actions,
  initialState,
  renderDetailPanel,
  renderToolbarActions,
  moduleSlug,
  permissionsOverride,
}: TableProps<T>) => {
  const [createModalOpened, setCreateModalOpened] = useState(false);
  const [updateModalOpened, setUpdateModalOpened] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const displaySaveError = (error: unknown) => setSaveError(
    typeof error === 'string' ? error : error instanceof Error ? error.message : 'Unable to save. Please try again.',
  );

  const modulePermissions = useModuleAccess(moduleSlug);

  const permissions = useMemo(
    () => ({
      ready: permissionsOverride?.ready ?? modulePermissions.ready,
      loading: permissionsOverride?.loading ?? modulePermissions.loading,
      canView: permissionsOverride?.canView ?? modulePermissions.canView,
      canCreate: permissionsOverride?.canCreate ?? modulePermissions.canCreate,
      canUpdate: permissionsOverride?.canUpdate ?? modulePermissions.canUpdate,
      canDelete: permissionsOverride?.canDelete ?? modulePermissions.canDelete,
    }),
    [modulePermissions, permissionsOverride],
  );

  const canCreate = permissions.canCreate && permissions.ready;
  const canUpdate = permissions.canUpdate && permissions.ready;
  const canDelete = permissions.canDelete && permissions.ready;

  const enableRowSelection = canUpdate || canDelete;

  const openDeleteConfirmModal = (rows: MRT_Row<T>[]) => {
    const count = rows.length;
    let iterator = 1;
    modals.openConfirmModal({
      title: "Are you sure you want to delete this row?",
      children: <Text>Are you sure you want to delete? This action cannot be undone.</Text>,
      labels: { confirm: "Delete", cancel: "Cancel" },
      confirmProps: { color: "red", disabled: !canDelete },
      centered: true,
      onConfirm: () => {
        if (!canDelete) {
          return;
        }
        rows.forEach((row) => {
          actions.handleDelete(row.original, count, iterator);
          iterator += 1;
        });
        table.setRowSelection({});
      },
    });
  };

  const createTitle = pageTitle ? `Create ${pageTitle}` : "Create";
  const editTitle = pageTitle ? `Edit ${pageTitle}` : "Edit";

  const table = useMantineReactTable({
    columns: cloneDeep(columns),
    data,
    enableColumnFilterModes: true,
    enableColumnOrdering: true,
    enableFacetedValues: true,
    enableGrouping: true,
    enablePinning: true,
    enableRowSelection,
    enableStickyHeader: true,
    enableStickyFooter: true,
    initialState,
    enableColumnResizing: true,
    layoutMode: "grid",
    mantineTableBodyProps: {
      style: {
        "& tr:nthOfType(odd)": {
          backgroundColor: "#f5f5f5",
        },
        borderTop: "2px solid #e0e0e0",
      },
    },
    onCreatingRowSave: async ({ values, exitCreatingMode }) => {
      if (!canCreate) {
        exitCreatingMode();
        return;
      }
      setSaveError(null);
      setIsSaving(true);
      try {
        await actions.handleCreate(typeof values.id === "object" ? values.customModal : values);
        setCreateModalOpened(false);
        exitCreatingMode();
      } catch (error) {
        displaySaveError(error);
      } finally {
        setIsSaving(false);
      }
    },
    onCreatingRowCancel: () => {
      setCreateModalOpened(false);
    },
    onEditingRowSave: async ({ values, table, row }) => {
      if (!canUpdate) {
        table.setEditingRow(null);
        table.setRowSelection({});
        return;
      }
      setSaveError(null);
      setIsSaving(true);
      try {
        await actions.handleUpdate(row.original, values);
        table.setEditingRow(null);
        table.setRowSelection({});
        setUpdateModalOpened(false);
      } catch (error) {
        displaySaveError(error);
      } finally {
        setIsSaving(false);
      }
    },
    mantineProgressProps: ({ isTopToolbar }) => ({
      color: "orange",
      sx: { display: isTopToolbar ? "block" : "none" },
      value: 100,
      striped: true,
      animated: true,
    }),
    state: {
      isSaving,
      isLoading: loading,
      showAlertBanner: Boolean(error),
      showProgressBars: loading,
    },
    renderToolbarAlertBannerContent: () => (
      <Alert color="red" title="Error">
        {error}
      </Alert>
    ),
    renderCreateRowModalContent: ({ table, row, internalEditComponents }) => (
      <ModalContent
        internalEditComponents={internalEditComponents}
        row={row}
        table={table}
        opened={createModalOpened}
        setOpened={setCreateModalOpened}
        title={createTitle}
        action="create"
        saveError={saveError}
        saving={isSaving}
        custom={Boolean(renderDetailPanel)}
      />
    ),
    renderEditRowModalContent: ({ table, row, internalEditComponents }) => (
      <ModalContent
        internalEditComponents={internalEditComponents}
        row={row}
        table={table}
        opened={updateModalOpened}
        setOpened={setUpdateModalOpened}
        title={editTitle}
        action="edit"
        saveError={saveError}
        saving={isSaving}
        custom={Boolean(renderDetailPanel)}
      />
    ),
    renderDetailPanel: renderDetailPanel
      ? ({ row }) => renderDetailPanel(row)
      : undefined,
    renderTopToolbar: ({ table }) => {
      const handleDelete = () => {
        if (!canDelete) {
          return;
        }
        openDeleteConfirmModal(table.getSelectedRowModel().flatRows);
      };

      const handleCreate = () => {
        if (!canCreate) {
          return;
        }
        setCreateModalOpened(true);
        setSaveError(null);
        table.setCreatingRow(true);
      };

      const handleUpdate = () => {
        if (!canUpdate) {
          return;
        }
        const selectedRows = table.getSelectedRowModel().flatRows;
        if (selectedRows.length === 0) {
          return;
        }
        setUpdateModalOpened(true);
        setSaveError(null);
        selectedRows.forEach((row) => {
          table.setEditingRow(row);
        });
      };

      return (
        <Flex p="md" justify="space-between" align="center" gap="sm" wrap="wrap">
          <Flex gap="xs" align="center" wrap="wrap">
            <MRTGlobalFilterTextInput table={table} />
            <MRTToggleFiltersButton table={table} />
          </Flex>
          <Flex gap="sm" wrap="wrap" justify="flex-end">
            {renderToolbarActions ? renderToolbarActions(table) : null}
            {canCreate && (
              <Button
                color="green"
                disabled={
                  permissions.loading ||
                  table.getIsSomeRowsSelected() ||
                  table.getIsSomePageRowsSelected() ||
                  table.getIsAllPageRowsSelected() ||
                  table.getIsAllRowsSelected()
                }
                onClick={handleCreate}
                variant="filled"
              >
                Add New
              </Button>
            )}
            {canUpdate && (
              <Button
                color="blue"
                disabled={
                  permissions.loading ||
                  Object.keys(table.getSelectedRowModel().rowsById).length !== 1
                }
                onClick={handleUpdate}
                variant="filled"
              >
                Update
              </Button>
            )}
            {canDelete && (
              <Button
                color="red"
                disabled={
                  permissions.loading ||
                  (!table.getIsSomeRowsSelected() &&
                    !table.getIsSomePageRowsSelected() &&
                    !table.getIsAllPageRowsSelected() &&
                    !table.getIsAllRowsSelected())
                }
                onClick={handleDelete}
                variant="filled"
              >
                Remove
              </Button>
            )}
          </Flex>
        </Flex>
      );
    },
  });

  if (!permissions.ready) {
    return (
      <Center style={{ minHeight: 220 }}>
        <Loader variant="dots" />
      </Center>
    );
  }

  if (!permissions.canView) {
    return (
      <Alert color="yellow" title="No access">
        You do not have permission to view this content.
      </Alert>
    );
  }

  return (
    <ModalsProvider>
      <MantineReactTable table={table} />
    </ModalsProvider>
  );
};

export default Table;
