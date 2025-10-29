import { useMemo } from "react";
import { Alert, Stack, Text } from "@mantine/core";
import Table from "../../utils/Table";
import {
  useShiftRoles,
  useCreateShiftRole,
  useUpdateShiftRole,
  useDeleteShiftRole,
} from "../../api/shiftRoles";
import { removeEmptyKeys } from "../../utils/removeEmptyKeys";
import { getChangedValues } from "../../utils/getChangedValues";
import { useModuleAccess } from "../../hooks/useModuleAccess";
import { PAGE_SLUGS } from "../../constants/pageSlugs";
import { PageAccessGuard } from "../../components/access/PageAccessGuard";
import type { ShiftRole } from "../../types/shiftRoles/ShiftRole";
import type { MRT_ColumnDef } from "mantine-react-table";
import { modifyColumn } from "../../utils/modifyColumn";

const PAGE_SLUG = PAGE_SLUGS.settingsShiftRoles;
const MODULE_SLUG = "shift-role-directory";

const SettingsShiftRoles = () => {
  const moduleAccess = useModuleAccess(MODULE_SLUG);
  const shiftRolesQuery = useShiftRoles();
  const createMutation = useCreateShiftRole();
  const updateMutation = useUpdateShiftRole();
  const deleteMutation = useDeleteShiftRole();

  const response = useMemo(() => shiftRolesQuery.data ?? [], [shiftRolesQuery.data]);
  const records = useMemo<ShiftRole[]>(() => (response[0]?.data ?? []) as ShiftRole[], [response]);
  const columns = useMemo<MRT_ColumnDef<ShiftRole>[]>(() => {
    const baseColumns = (response[0]?.columns ?? []) as MRT_ColumnDef<ShiftRole>[];
    return modifyColumn<ShiftRole>(baseColumns, []);
  }, [response]);

  const handleCreate = async (payload: Partial<ShiftRole>) => {
    const name = payload.name?.trim();
    if (!name) return;
    await createMutation.mutateAsync({ name, slug: payload.slug?.trim() });
  };

  const handleUpdate = async (original: Partial<ShiftRole>, updated: Partial<ShiftRole>) => {
    if (typeof original.id !== "number") return;
    const delta = getChangedValues(original, updated, 0);
    const sanitized = removeEmptyKeys(delta, 0);
    delete sanitized.id;
    if (Object.keys(sanitized).length === 0) return;
    await updateMutation.mutateAsync({ id: original.id, data: sanitized });
  };

  const handleDelete = async (record: Partial<ShiftRole>) => {
    if (typeof record.id !== "number") return;
    await deleteMutation.mutateAsync(record.id);
  };

  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <Stack mt="lg" gap="lg">
        <Stack gap={4}>
          <Text fw={600}>Shift roles</Text>
          <Text size="sm" c="dimmed">
            Define the roles that can be scheduled on shifts. These roles become available when configuring shift
            templates and assignments.
          </Text>
        </Stack>

        {shiftRolesQuery.isError ? (
          <Alert color="red" title="Failed to load shift roles">
            {(shiftRolesQuery.error as Error).message}
          </Alert>
        ) : null}

        <Table<ShiftRole>
          pageTitle="Shift roles"
          data={records}
          loading={
            shiftRolesQuery.isLoading ||
            createMutation.isPending ||
            updateMutation.isPending ||
            deleteMutation.isPending
          }
          error={shiftRolesQuery.isError ? (shiftRolesQuery.error as Error).message : null}
          columns={columns}
          actions={{
            handleCreate,
            handleUpdate,
            handleDelete: (record) => handleDelete(record),
          }}
          initialState={{
            showColumnFilters: false,
            showGlobalFilter: false,
            columnVisibility: { id: false },
          }}
          moduleSlug={MODULE_SLUG}
          permissionsOverride={{
            ready: moduleAccess.ready,
            loading: moduleAccess.loading,
            canView: moduleAccess.canView,
            canCreate: moduleAccess.canCreate,
            canUpdate: moduleAccess.canUpdate,
            canDelete: moduleAccess.canDelete,
          }}
        />
      </Stack>
    </PageAccessGuard>
  );
};

export default SettingsShiftRoles;
