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
  createRoleModulePermission,
  deleteRoleModulePermission,
  fetchRoleModulePermissions,
  updateRoleModulePermission,
} from "../../../actions/roleModulePermissionActions";
import { fetchActions } from "../../../actions/actionActions";
import { fetchAccessSnapshot } from "../../../actions/accessControlActions";
import { fetchModules } from "../../../actions/moduleActions";
import { fetchUserTypes } from "../../../actions/userTypeActions";
import { useModuleAccess } from "../../../hooks/useModuleAccess";
import { RoleModulePermission } from "../../../types/permissions/RoleModulePermission";
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

const MODULE_SLUG = "settings-module-permissions";

type RoleModulePermissionDraft = {
  userTypeId: string;
  moduleId: string;
  actionId: string;
  allowed: boolean;
  status: boolean;
};

const newDraft = (): RoleModulePermissionDraft => ({
  userTypeId: "",
  moduleId: "",
  actionId: "",
  allowed: true,
  status: true,
});

export const AccessRoleModulePermissionsManager = () => {
  const dispatch = useAppDispatch();
  const roleModulePermissionsState = useAppSelector((state) => state.roleModulePermissions)[0];
  const modulesState = useAppSelector((state) => state.modules)[0];
  const actionsState = useAppSelector((state) => state.actions)[0];
  const userTypesState = useAppSelector((state) => state.userTypes)[0];
  const { loggedUserId } = useAppSelector((state) => state.session);
  const permissions = useModuleAccess(MODULE_SLUG);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [drawerOpened, setDrawerOpened] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<RoleModulePermissionDraft>(newDraft());
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    dispatch(fetchRoleModulePermissions());
  }, [dispatch]);

  useEffect(() => {
    if (!(modulesState.data[0]?.data?.length ?? 0)) {
      dispatch(fetchModules());
    }
  }, [dispatch, modulesState.data]);

  useEffect(() => {
    if (!(actionsState.data[0]?.data?.length ?? 0)) {
      dispatch(fetchActions());
    }
  }, [dispatch, actionsState.data]);

  useEffect(() => {
    if (!(userTypesState.data[0]?.data?.length ?? 0)) {
      dispatch(fetchUserTypes());
    }
  }, [dispatch, userTypesState.data]);

  const moduleLabelById = useMemo(() => {
    const map = new Map<number, string>();
    (modulesState.data[0]?.data ?? []).forEach((record) => {
      if (typeof record.id === "number") {
        map.set(record.id, record.name ?? record.slug ?? `Module #${record.id}`);
      }
    });
    return map;
  }, [modulesState.data]);

  const actionLabelById = useMemo(() => {
    const map = new Map<number, string>();
    (actionsState.data[0]?.data ?? []).forEach((record) => {
      if (typeof record.id === "number") {
        map.set(record.id, record.name ?? record.key ?? `Action #${record.id}`);
      }
    });
    return map;
  }, [actionsState.data]);

  const userTypeLabelById = useMemo(() => {
    const map = new Map<number, string>();
    (userTypesState.data[0]?.data ?? []).forEach((record) => {
      if (typeof record.id === "number") {
        map.set(record.id, record.name ?? `Role #${record.id}`);
      }
    });
    return map;
  }, [userTypesState.data]);

  const moduleOptions = useMemo(
    () =>
      Array.from(moduleLabelById.entries())
        .map(([id, label]) => ({ value: String(id), label: `${label} (#${id})` }))
        .sort((left, right) => left.label.localeCompare(right.label)),
    [moduleLabelById],
  );

  const actionOptions = useMemo(
    () =>
      Array.from(actionLabelById.entries())
        .map(([id, label]) => ({ value: String(id), label: `${label} (#${id})` }))
        .sort((left, right) => left.label.localeCompare(right.label)),
    [actionLabelById],
  );

  const userTypeOptions = useMemo(
    () =>
      Array.from(userTypeLabelById.entries())
        .map(([id, label]) => ({ value: String(id), label: `${label} (#${id})` }))
        .sort((left, right) => left.label.localeCompare(right.label)),
    [userTypeLabelById],
  );

  const roleFilterOptions = useMemo(
    () => [{ value: "all", label: "All user types" }, ...userTypeOptions],
    [userTypeOptions],
  );

  const records = useMemo(
    () =>
      [...(roleModulePermissionsState.data[0]?.data ?? [])].sort((left, right) => {
        const leftRole = userTypeLabelById.get(toNumber(left.userTypeId, -1)) ?? "";
        const rightRole = userTypeLabelById.get(toNumber(right.userTypeId, -1)) ?? "";
        return leftRole.localeCompare(rightRole);
      }),
    [roleModulePermissionsState.data, userTypeLabelById],
  );

  const filtered = useMemo(
    () =>
      records.filter((record) => {
        const userTypeId = String(record.userTypeId ?? "");
        return (
          matchesStatus(statusFilter, record.status) &&
          (roleFilter === "all" || roleFilter === userTypeId) &&
          includesSearch(
            query,
            userTypeLabelById.get(toNumber(record.userTypeId, -1)),
            moduleLabelById.get(toNumber(record.moduleId, -1)),
            actionLabelById.get(toNumber(record.actionId, -1)),
          )
        );
      }),
    [records, statusFilter, roleFilter, query, userTypeLabelById, moduleLabelById, actionLabelById],
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

  const openEdit = (record: Partial<RoleModulePermission>) => {
    setEditingId(record.id ?? null);
    setDraft({
      userTypeId: record.userTypeId != null ? String(record.userTypeId) : "",
      moduleId: record.moduleId != null ? String(record.moduleId) : "",
      actionId: record.actionId != null ? String(record.actionId) : "",
      allowed: Boolean(record.allowed),
      status: Boolean(record.status),
    });
    setFormError(null);
    setDrawerOpened(true);
  };

  const handleDelete = async (record: Partial<RoleModulePermission>) => {
    if (!permissions.canDelete || typeof record.id !== "number") {
      return;
    }
    const roleLabel = userTypeLabelById.get(toNumber(record.userTypeId, -1)) ?? `Role #${record.userTypeId}`;
    const moduleLabel = moduleLabelById.get(toNumber(record.moduleId, -1)) ?? `Module #${record.moduleId}`;
    const actionLabel = actionLabelById.get(toNumber(record.actionId, -1)) ?? `Action #${record.actionId}`;
    const confirmed = window.confirm(`Delete permission ${roleLabel} -> ${moduleLabel} (${actionLabel})?`);
    if (!confirmed) {
      return;
    }
    try {
      await dispatch(deleteRoleModulePermission(record.id)).unwrap();
      await dispatch(fetchRoleModulePermissions());
      dispatch(fetchAccessSnapshot());
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Failed to delete module permission.");
    }
  };

  const handleSave = async () => {
    if ((editingId == null && !permissions.canCreate) || (editingId != null && !permissions.canUpdate)) {
      return;
    }
    const userTypeId = toNumber(draft.userTypeId, NaN);
    const moduleId = toNumber(draft.moduleId, NaN);
    const actionId = toNumber(draft.actionId, NaN);
    if (!Number.isFinite(userTypeId) || !Number.isFinite(moduleId) || !Number.isFinite(actionId)) {
      setFormError("User type, module, and action are required.");
      return;
    }

    const payload: Partial<RoleModulePermission> = {
      userTypeId,
      moduleId,
      actionId,
      allowed: draft.allowed,
      status: draft.status,
    };

    try {
      setSaving(true);
      setFormError(null);
      if (editingId != null) {
        await dispatch(
          updateRoleModulePermission({
            id: editingId,
            updates: { ...payload, updatedBy: typeof loggedUserId === "number" ? loggedUserId : undefined },
          }),
        ).unwrap();
      } else {
        await dispatch(
          createRoleModulePermission({
            ...payload,
            createdBy: typeof loggedUserId === "number" ? loggedUserId : undefined,
          }),
        ).unwrap();
      }
      await dispatch(fetchRoleModulePermissions());
      dispatch(fetchAccessSnapshot());
      closeDrawer();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Failed to save module permission.");
    } finally {
      setSaving(false);
    }
  };

  const combinedLoading =
    roleModulePermissionsState.loading ||
    modulesState.loading ||
    actionsState.loading ||
    userTypesState.loading;
  const combinedError =
    roleModulePermissionsState.error ??
    modulesState.error ??
    actionsState.error ??
    userTypesState.error;

  return (
    <>
      <SectionShell
        permissionsReady={permissions.ready}
        canView={permissions.canView}
        loading={combinedLoading}
        error={combinedError}
        onRefresh={() => {
          dispatch(fetchRoleModulePermissions());
          dispatch(fetchModules());
          dispatch(fetchActions());
          dispatch(fetchUserTypes());
        }}
      >
        <Card withBorder radius="md" p="md">
          <Group justify="space-between" wrap="wrap">
            <Group wrap="wrap" gap="sm">
              <TextInput
                placeholder="Search by role, module, action..."
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                w={300}
              />
              <Select data={roleFilterOptions} value={roleFilter} onChange={(value) => setRoleFilter(value ?? "all")} w={220} />
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
                New Module Permission
              </Button>
            </Group>
          </Group>
        </Card>

        {filtered.length === 0 ? (
          <Alert color="gray" title="No module permissions found">
            Adjust filters or create a new permission.
          </Alert>
        ) : (
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
            {filtered.map((record) => {
              const roleLabel = userTypeLabelById.get(toNumber(record.userTypeId, -1)) ?? `Role #${record.userTypeId}`;
              const moduleLabel = moduleLabelById.get(toNumber(record.moduleId, -1)) ?? `Module #${record.moduleId}`;
              const actionLabel = actionLabelById.get(toNumber(record.actionId, -1)) ?? `Action #${record.actionId}`;
              return (
                <Paper key={record.id ?? `${record.userTypeId}-${record.moduleId}-${record.actionId}`} withBorder radius="md" p="md">
                  <Stack gap={8}>
                    <Group justify="space-between" align="start">
                      <div>
                        <Text fw={600}>{roleLabel}</Text>
                        <Text size="sm" c="dimmed">
                          {moduleLabel} - {actionLabel}
                        </Text>
                      </div>
                      <Badge color={record.status ? "green" : "gray"} variant="light">
                        {record.status ? "Active" : "Inactive"}
                      </Badge>
                    </Group>
                    <Badge color={record.allowed ? "teal" : "red"} variant="light">
                      {record.allowed ? "Allowed" : "Denied"}
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
        title={editingId != null ? "Edit Module Permission" : "Create Module Permission"}
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
            label="Module"
            data={moduleOptions}
            value={draft.moduleId}
            onChange={(value) => setDraft((prev) => ({ ...prev, moduleId: value ?? "" }))}
            searchable
            required
          />
          <Select
            label="Action"
            data={actionOptions}
            value={draft.actionId}
            onChange={(value) => setDraft((prev) => ({ ...prev, actionId: value ?? "" }))}
            searchable
            required
          />
          <Switch label="Allowed" checked={draft.allowed} onChange={(e) => setDraft((prev) => ({ ...prev, allowed: e.currentTarget.checked }))} />
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

