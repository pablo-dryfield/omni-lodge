import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Drawer,
  Group,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import {
  createRolePagePermission,
  deleteRolePagePermission,
  fetchRolePagePermissions,
  updateRolePagePermission,
} from "../../../actions/rolePagePermissionActions";
import { fetchAccessSnapshot } from "../../../actions/accessControlActions";
import { fetchPages } from "../../../actions/pageActions";
import { fetchUserTypes } from "../../../actions/userTypeActions";
import { useModuleAccess } from "../../../hooks/useModuleAccess";
import { RolePagePermission } from "../../../types/permissions/RolePagePermission";
import { useAppDispatch, useAppSelector } from "../../../store/hooks";
import { SectionShell } from "./SectionShell";
import {
  formatDate,
  includesSearch,
  matchesStatus,
  STATUS_OPTIONS,
  StatusFilter,
  toNumber,
} from "./helpers";

const MODULE_SLUG = "settings-page-permissions";

type RolePagePermissionDraft = {
  userTypeId: string;
  pageId: string;
  canView: boolean;
  status: boolean;
};

const newDraft = (): RolePagePermissionDraft => ({
  userTypeId: "",
  pageId: "",
  canView: true,
  status: true,
});

export const AccessRolePagePermissionsManager = () => {
  const dispatch = useAppDispatch();
  const rolePagePermissionsState = useAppSelector((state) => state.rolePagePermissions)[0];
  const pagesState = useAppSelector((state) => state.pages)[0];
  const userTypesState = useAppSelector((state) => state.userTypes)[0];
  const { loggedUserId } = useAppSelector((state) => state.session);
  const permissions = useModuleAccess(MODULE_SLUG);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [userTypeFilter, setUserTypeFilter] = useState<string>("all");
  const [drawerOpened, setDrawerOpened] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<RolePagePermissionDraft>(newDraft());
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    dispatch(fetchRolePagePermissions());
  }, [dispatch]);

  useEffect(() => {
    if (!(pagesState.data[0]?.data?.length ?? 0)) {
      dispatch(fetchPages());
    }
  }, [dispatch, pagesState.data]);

  useEffect(() => {
    if (!(userTypesState.data[0]?.data?.length ?? 0)) {
      dispatch(fetchUserTypes());
    }
  }, [dispatch, userTypesState.data]);

  const pageLabelById = useMemo(() => {
    const map = new Map<number, string>();
    (pagesState.data[0]?.data ?? []).forEach((record) => {
      if (typeof record.id === "number") {
        map.set(record.id, record.name ?? record.slug ?? `Page #${record.id}`);
      }
    });
    return map;
  }, [pagesState.data]);

  const userTypeLabelById = useMemo(() => {
    const map = new Map<number, string>();
    (userTypesState.data[0]?.data ?? []).forEach((record) => {
      if (typeof record.id === "number") {
        map.set(record.id, record.name ?? `Role #${record.id}`);
      }
    });
    return map;
  }, [userTypesState.data]);

  const pageOptions = useMemo(
    () =>
      Array.from(pageLabelById.entries())
        .map(([id, label]) => ({ value: String(id), label: `${label} (#${id})` }))
        .sort((left, right) => left.label.localeCompare(right.label)),
    [pageLabelById],
  );

  const userTypeOptions = useMemo(
    () =>
      Array.from(userTypeLabelById.entries())
        .map(([id, label]) => ({ value: String(id), label: `${label} (#${id})` }))
        .sort((left, right) => left.label.localeCompare(right.label)),
    [userTypeLabelById],
  );

  const userTypeFilterOptions = useMemo(
    () => [{ value: "all", label: "All user types" }, ...userTypeOptions],
    [userTypeOptions],
  );

  const records = useMemo(
    () =>
      [...(rolePagePermissionsState.data[0]?.data ?? [])].sort((left, right) => {
        const leftRole = userTypeLabelById.get(toNumber(left.userTypeId, -1)) ?? "";
        const rightRole = userTypeLabelById.get(toNumber(right.userTypeId, -1)) ?? "";
        return leftRole.localeCompare(rightRole);
      }),
    [rolePagePermissionsState.data, userTypeLabelById],
  );

  const filtered = useMemo(
    () =>
      records.filter((record) => {
        const userTypeId = String(record.userTypeId ?? "");
        return (
          matchesStatus(statusFilter, record.status) &&
          (userTypeFilter === "all" || userTypeFilter === userTypeId) &&
          includesSearch(
            query,
            userTypeLabelById.get(toNumber(record.userTypeId, -1)),
            pageLabelById.get(toNumber(record.pageId, -1)),
            record.id,
          )
        );
      }),
    [records, statusFilter, userTypeFilter, query, userTypeLabelById, pageLabelById],
  );

  const closeDrawer = () => {
    if (saving) {
      return;
    }
    setDrawerOpened(false);
    setEditingId(null);
    setFormError(null);
  };

  const openCreate = () => {
    setEditingId(null);
    setDraft(newDraft());
    setFormError(null);
    setDrawerOpened(true);
  };

  const openEdit = (record: Partial<RolePagePermission>) => {
    setEditingId(record.id ?? null);
    setDraft({
      userTypeId: record.userTypeId != null ? String(record.userTypeId) : "",
      pageId: record.pageId != null ? String(record.pageId) : "",
      canView: Boolean(record.canView),
      status: Boolean(record.status),
    });
    setFormError(null);
    setDrawerOpened(true);
  };

  const handleDelete = async (record: Partial<RolePagePermission>) => {
    if (!permissions.canDelete || typeof record.id !== "number") {
      return;
    }
    const roleLabel = userTypeLabelById.get(toNumber(record.userTypeId, -1)) ?? `Role #${record.userTypeId}`;
    const pageLabel = pageLabelById.get(toNumber(record.pageId, -1)) ?? `Page #${record.pageId}`;
    const confirmed = window.confirm(`Delete permission ${roleLabel} -> ${pageLabel}?`);
    if (!confirmed) {
      return;
    }
    try {
      await dispatch(deleteRolePagePermission(record.id)).unwrap();
      await dispatch(fetchRolePagePermissions());
      dispatch(fetchAccessSnapshot());
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Failed to delete page permission.");
    }
  };

  const handleSave = async () => {
    if ((editingId == null && !permissions.canCreate) || (editingId != null && !permissions.canUpdate)) {
      return;
    }
    const userTypeId = toNumber(draft.userTypeId, NaN);
    const pageId = toNumber(draft.pageId, NaN);
    if (!Number.isFinite(userTypeId) || !Number.isFinite(pageId)) {
      setFormError("User type and page are required.");
      return;
    }

    const payload: Partial<RolePagePermission> = {
      userTypeId,
      pageId,
      canView: draft.canView,
      status: draft.status,
    };

    try {
      setSaving(true);
      setFormError(null);
      if (editingId != null) {
        await dispatch(
          updateRolePagePermission({
            id: editingId,
            updates: { ...payload, updatedBy: typeof loggedUserId === "number" ? loggedUserId : undefined },
          }),
        ).unwrap();
      } else {
        await dispatch(
          createRolePagePermission({
            ...payload,
            createdBy: typeof loggedUserId === "number" ? loggedUserId : undefined,
          }),
        ).unwrap();
      }
      await dispatch(fetchRolePagePermissions());
      dispatch(fetchAccessSnapshot());
      closeDrawer();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Failed to save page permission.");
    } finally {
      setSaving(false);
    }
  };

  const combinedLoading = rolePagePermissionsState.loading || pagesState.loading || userTypesState.loading;
  const combinedError = rolePagePermissionsState.error ?? pagesState.error ?? userTypesState.error;

  return (
    <>
      <SectionShell
        permissionsReady={permissions.ready}
        canView={permissions.canView}
        loading={combinedLoading}
        error={combinedError}
        onRefresh={() => {
          dispatch(fetchRolePagePermissions());
          dispatch(fetchPages());
          dispatch(fetchUserTypes());
        }}
      >
        <Card withBorder radius="md" p="md">
          <Group justify="space-between" wrap="wrap">
            <Group wrap="wrap" gap="sm">
              <TextInput
                placeholder="Search by role or page..."
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                w={280}
              />
              <Select
                data={userTypeFilterOptions}
                value={userTypeFilter}
                onChange={(value) => setUserTypeFilter(value ?? "all")}
                w={220}
              />
              <Select
                data={STATUS_OPTIONS as unknown as { value: string; label: string }[]}
                value={statusFilter}
                onChange={(value) => setStatusFilter((value as StatusFilter) ?? "all")}
                w={180}
              />
            </Group>
            <Group gap="xs">
              <Badge variant="light">Total: {records.length}</Badge>
              <Button
                leftSection={<IconPlus size={16} />}
                onClick={openCreate}
                disabled={!permissions.canCreate}
              >
                New Page Permission
              </Button>
            </Group>
          </Group>
        </Card>

        {filtered.length === 0 ? (
          <Alert color="gray" title="No page permissions found">
            Adjust filters or create a new permission.
          </Alert>
        ) : (
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
            {filtered.map((record) => {
              const roleLabel = userTypeLabelById.get(toNumber(record.userTypeId, -1)) ?? `Role #${record.userTypeId}`;
              const pageLabel = pageLabelById.get(toNumber(record.pageId, -1)) ?? `Page #${record.pageId}`;
              return (
                <Paper key={record.id ?? `${record.userTypeId}-${record.pageId}`} withBorder radius="md" p="md">
                  <Stack gap={8}>
                    <Group justify="space-between" align="start">
                      <div>
                        <Text fw={600}>{roleLabel}</Text>
                        <Text size="sm" c="dimmed">
                          {pageLabel}
                        </Text>
                      </div>
                      <Badge color={record.status ? "green" : "gray"} variant="light">
                        {record.status ? "Active" : "Inactive"}
                      </Badge>
                    </Group>
                    <Badge color={record.canView ? "teal" : "red"} variant="light">
                      {record.canView ? "Can view" : "Cannot view"}
                    </Badge>
                    <Text size="xs" c="dimmed">
                      Updated {formatDate(record.updatedAt)}
                    </Text>
                    <Group justify="flex-end" gap="xs">
                      <Button
                        variant="light"
                        leftSection={<IconPencil size={14} />}
                        onClick={() => openEdit(record)}
                        disabled={!permissions.canUpdate}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="light"
                        color="red"
                        leftSection={<IconTrash size={14} />}
                        onClick={() => handleDelete(record)}
                        disabled={!permissions.canDelete}
                      >
                        Delete
                      </Button>
                    </Group>
                  </Stack>
                </Paper>
              );
            })}
          </SimpleGrid>
        )}
      </SectionShell>

      <Drawer
        opened={drawerOpened}
        onClose={closeDrawer}
        title={editingId != null ? "Edit Page Permission" : "Create Page Permission"}
        size="md"
      >
        <Stack gap="sm">
          {formError ? (
            <Alert color="red" title="Validation error">
              {formError}
            </Alert>
          ) : null}
          <Select
            label="User type"
            data={userTypeOptions}
            value={draft.userTypeId}
            onChange={(value) => setDraft((prev) => ({ ...prev, userTypeId: value ?? "" }))}
            searchable
            required
          />
          <Select
            label="Page"
            data={pageOptions}
            value={draft.pageId}
            onChange={(value) => setDraft((prev) => ({ ...prev, pageId: value ?? "" }))}
            searchable
            required
          />
          <Switch label="Can view" checked={draft.canView} onChange={(e) => setDraft((prev) => ({ ...prev, canView: e.currentTarget.checked }))} />
          <Switch label="Active" checked={draft.status} onChange={(e) => setDraft((prev) => ({ ...prev, status: e.currentTarget.checked }))} />
          <Group justify="flex-end" mt="sm">
            <Button variant="default" onClick={closeDrawer} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} loading={saving}>
              Save
            </Button>
          </Group>
        </Stack>
      </Drawer>
    </>
  );
};

