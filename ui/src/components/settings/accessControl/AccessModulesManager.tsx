import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Drawer,
  Group,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { createModule, deleteModule, fetchModules, updateModule } from "../../../actions/moduleActions";
import { fetchAccessSnapshot } from "../../../actions/accessControlActions";
import { fetchPages } from "../../../actions/pageActions";
import { useModuleAccess } from "../../../hooks/useModuleAccess";
import { Module } from "../../../types/modules/Module";
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

const MODULE_SLUG = "settings-modules-admin";

type ModuleDraft = {
  pageId: string;
  slug: string;
  name: string;
  description: string;
  componentRef: string;
  sortOrder: number;
  status: boolean;
};

const newModuleDraft = (nextSortOrder = 0): ModuleDraft => ({
  pageId: "",
  slug: "",
  name: "",
  description: "",
  componentRef: "",
  sortOrder: nextSortOrder,
  status: true,
});

export const AccessModulesManager = () => {
  const dispatch = useAppDispatch();
  const modulesState = useAppSelector((state) => state.modules)[0];
  const pagesState = useAppSelector((state) => state.pages)[0];
  const { loggedUserId } = useAppSelector((state) => state.session);
  const permissions = useModuleAccess(MODULE_SLUG);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [pageFilter, setPageFilter] = useState<string>("all");
  const [drawerOpened, setDrawerOpened] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<ModuleDraft>(newModuleDraft());
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    dispatch(fetchModules());
  }, [dispatch]);

  useEffect(() => {
    if (!(pagesState.data[0]?.data?.length ?? 0)) {
      dispatch(fetchPages());
    }
  }, [dispatch, pagesState.data]);

  const pageLabelById = useMemo(() => {
    const map = new Map<number, string>();
    (pagesState.data[0]?.data ?? []).forEach((record) => {
      if (typeof record.id === "number") {
        map.set(record.id, record.name ?? record.slug ?? `Page #${record.id}`);
      }
    });
    return map;
  }, [pagesState.data]);

  const pageOptions = useMemo(
    () =>
      Array.from(pageLabelById.entries())
        .map(([id, label]) => ({ value: String(id), label: `${label} (#${id})` }))
        .sort((left, right) => left.label.localeCompare(right.label)),
    [pageLabelById],
  );

  const pageFilterOptions = useMemo(
    () => [{ value: "all", label: "All pages" }, ...pageOptions],
    [pageOptions],
  );

  const records = useMemo(
    () =>
      [...(modulesState.data[0]?.data ?? [])].sort(
        (left, right) =>
          toNumber(left.sortOrder, 0) - toNumber(right.sortOrder, 0) ||
          String(left.name ?? "").localeCompare(String(right.name ?? "")),
      ),
    [modulesState.data],
  );

  const filtered = useMemo(
    () =>
      records.filter((record) => {
        const pageId = String(record.pageId ?? "");
        return (
          matchesStatus(statusFilter, record.status) &&
          (pageFilter === "all" || pageFilter === pageId) &&
          includesSearch(
            query,
            record.name,
            record.slug,
            record.description,
            record.componentRef,
            pageLabelById.get(toNumber(record.pageId, 0)),
          )
        );
      }),
    [records, statusFilter, pageFilter, query, pageLabelById],
  );

  const nextSortOrder = useMemo(() => {
    if (!records.length) {
      return 10;
    }
    const maxSort = records.reduce((max, current) => Math.max(max, toNumber(current.sortOrder, 0)), 0);
    return maxSort + 10;
  }, [records]);

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
    setDraft(newModuleDraft(nextSortOrder));
    setFormError(null);
    setDrawerOpened(true);
  };

  const openEdit = (record: Partial<Module>) => {
    setEditingId(record.id ?? null);
    setDraft({
      pageId: record.pageId != null ? String(record.pageId) : "",
      slug: String(record.slug ?? ""),
      name: String(record.name ?? ""),
      description: String(record.description ?? ""),
      componentRef: String(record.componentRef ?? ""),
      sortOrder: toNumber(record.sortOrder, 0),
      status: Boolean(record.status),
    });
    setFormError(null);
    setDrawerOpened(true);
  };

  const handleDelete = async (record: Partial<Module>) => {
    if (!permissions.canDelete || typeof record.id !== "number") {
      return;
    }
    const confirmed = window.confirm(`Delete module "${record.name ?? record.slug ?? record.id}"?`);
    if (!confirmed) {
      return;
    }
    try {
      await dispatch(deleteModule(record.id)).unwrap();
      await dispatch(fetchModules());
      dispatch(fetchAccessSnapshot());
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Failed to delete module.");
    }
  };

  const handleSave = async () => {
    if ((editingId == null && !permissions.canCreate) || (editingId != null && !permissions.canUpdate)) {
      return;
    }
    const pageId = toNumber(draft.pageId, NaN);
    if (!Number.isFinite(pageId)) {
      setFormError("Page is required.");
      return;
    }
    const slug = draft.slug.trim();
    const name = draft.name.trim();
    if (!slug || !name) {
      setFormError("Slug and name are required.");
      return;
    }

    const payload: Partial<Module> = {
      pageId,
      slug,
      name,
      description: draft.description.trim() || undefined,
      componentRef: draft.componentRef.trim() || undefined,
      sortOrder: toNumber(draft.sortOrder, 0),
      status: draft.status,
    };

    try {
      setSaving(true);
      setFormError(null);
      if (editingId != null) {
        await dispatch(
          updateModule({
            moduleId: editingId,
            moduleData: { ...payload, updatedBy: typeof loggedUserId === "number" ? loggedUserId : undefined },
          }),
        ).unwrap();
      } else {
        await dispatch(
          createModule({ ...payload, createdBy: typeof loggedUserId === "number" ? loggedUserId : undefined }),
        ).unwrap();
      }
      await dispatch(fetchModules());
      dispatch(fetchAccessSnapshot());
      closeDrawer();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Failed to save module.");
    } finally {
      setSaving(false);
    }
  };

  const combinedLoading = modulesState.loading || pagesState.loading;
  const combinedError = modulesState.error ?? pagesState.error;

  return (
    <>
      <SectionShell
        permissionsReady={permissions.ready}
        canView={permissions.canView}
        loading={combinedLoading}
        error={combinedError}
        onRefresh={() => {
          dispatch(fetchModules());
          dispatch(fetchPages());
        }}
      >
        <Card withBorder radius="md" p="md">
          <Group justify="space-between" wrap="wrap">
            <Group wrap="wrap" gap="sm">
              <TextInput
                placeholder="Search by name, slug, page..."
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                w={300}
              />
              <Select data={pageFilterOptions} value={pageFilter} onChange={(value) => setPageFilter(value ?? "all")} w={220} />
              <Select
                data={STATUS_OPTIONS as unknown as { value: string; label: string }[]}
                value={statusFilter}
                onChange={(value) => setStatusFilter((value as StatusFilter) ?? "all")}
                w={180}
              />
            </Group>
            <Group gap="xs">
              <Badge variant="light">Total: {records.length}</Badge>
              <Button leftSection={<IconPlus size={16} />} onClick={openCreate} disabled={!permissions.canCreate}>
                New Module
              </Button>
            </Group>
          </Group>
        </Card>

        {filtered.length === 0 ? (
          <Alert color="gray" title="No modules found">
            Adjust filters or create a new module.
          </Alert>
        ) : (
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
            {filtered.map((record) => (
              <Paper key={record.id ?? `${record.slug}-${record.name}`} withBorder radius="md" p="md">
                <Stack gap={8}>
                  <Group justify="space-between" align="start">
                    <div>
                      <Text fw={600}>{record.name ?? "Unnamed module"}</Text>
                      <Text size="sm" c="dimmed">
                        {record.slug ?? "no-slug"}
                      </Text>
                    </div>
                    <Badge color={record.status ? "green" : "gray"} variant="light">
                      {record.status ? "Active" : "Inactive"}
                    </Badge>
                  </Group>
                  <Text size="sm">
                    Page: {pageLabelById.get(toNumber(record.pageId, -1)) ?? `#${record.pageId ?? "n/a"}`}
                  </Text>
                  <Group gap="xs">
                    <Badge variant="outline">Sort #{toNumber(record.sortOrder, 0)}</Badge>
                    {record.componentRef ? <Badge variant="outline">{record.componentRef}</Badge> : null}
                  </Group>
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
            ))}
          </SimpleGrid>
        )}
      </SectionShell>

      <Drawer
        opened={drawerOpened}
        onClose={closeDrawer}
        title={editingId != null ? "Edit Module" : "Create Module"}
        size="md"
      >
        <Stack gap="sm">
          {formError ? (
            <Alert color="red" title="Validation error">
              {formError}
            </Alert>
          ) : null}
          <Select
            label="Page"
            data={pageOptions}
            value={draft.pageId}
            onChange={(value) => setDraft((prev) => ({ ...prev, pageId: value ?? "" }))}
            searchable
            required
          />
          <TextInput label="Slug" value={draft.slug} onChange={(e) => setDraft((prev) => ({ ...prev, slug: e.currentTarget.value }))} required />
          <TextInput label="Name" value={draft.name} onChange={(e) => setDraft((prev) => ({ ...prev, name: e.currentTarget.value }))} required />
          <TextInput
            label="Description"
            value={draft.description}
            onChange={(e) => setDraft((prev) => ({ ...prev, description: e.currentTarget.value }))}
          />
          <TextInput
            label="Component ref"
            value={draft.componentRef}
            onChange={(e) => setDraft((prev) => ({ ...prev, componentRef: e.currentTarget.value }))}
          />
          <NumberInput label="Sort order" value={draft.sortOrder} onChange={(value) => setDraft((prev) => ({ ...prev, sortOrder: toNumber(value, 0) }))} min={0} />
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

