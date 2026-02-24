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
import { createPage, deletePage, fetchPages, updatePage } from "../../../actions/pageActions";
import { fetchAccessSnapshot } from "../../../actions/accessControlActions";
import { useModuleAccess } from "../../../hooks/useModuleAccess";
import { Page } from "../../../types/pages/Page";
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

const MODULE_SLUG = "settings-pages-admin";

type PageDraft = {
  slug: string;
  name: string;
  description: string;
  icon: string;
  sortOrder: number;
  status: boolean;
};

const newPageDraft = (nextSortOrder = 0): PageDraft => ({
  slug: "",
  name: "",
  description: "",
  icon: "",
  sortOrder: nextSortOrder,
  status: true,
});

export const AccessPagesManager = () => {
  const dispatch = useAppDispatch();
  const pagesState = useAppSelector((state) => state.pages)[0];
  const { loggedUserId } = useAppSelector((state) => state.session);
  const permissions = useModuleAccess(MODULE_SLUG);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [drawerOpened, setDrawerOpened] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<PageDraft>(newPageDraft());
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    dispatch(fetchPages());
  }, [dispatch]);

  const records = useMemo(
    () =>
      [...(pagesState.data[0]?.data ?? [])].sort(
        (left, right) =>
          toNumber(left.sortOrder, 0) - toNumber(right.sortOrder, 0) ||
          String(left.name ?? "").localeCompare(String(right.name ?? "")),
      ),
    [pagesState.data],
  );

  const filtered = useMemo(
    () =>
      records.filter(
        (record) =>
          matchesStatus(statusFilter, record.status) &&
          includesSearch(query, record.name, record.slug, record.description, record.icon),
      ),
    [records, statusFilter, query],
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
    setDraft(newPageDraft(nextSortOrder));
    setFormError(null);
    setDrawerOpened(true);
  };

  const openEdit = (record: Partial<Page>) => {
    setEditingId(record.id ?? null);
    setDraft({
      slug: String(record.slug ?? ""),
      name: String(record.name ?? ""),
      description: String(record.description ?? ""),
      icon: String(record.icon ?? ""),
      sortOrder: toNumber(record.sortOrder, 0),
      status: Boolean(record.status),
    });
    setFormError(null);
    setDrawerOpened(true);
  };

  const handleDelete = async (record: Partial<Page>) => {
    if (!permissions.canDelete || typeof record.id !== "number") {
      return;
    }
    const confirmed = window.confirm(`Delete page "${record.name ?? record.slug ?? record.id}"?`);
    if (!confirmed) {
      return;
    }

    try {
      await dispatch(deletePage(record.id)).unwrap();
      await dispatch(fetchPages());
      dispatch(fetchAccessSnapshot());
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Failed to delete page.");
    }
  };

  const handleSave = async () => {
    if ((editingId == null && !permissions.canCreate) || (editingId != null && !permissions.canUpdate)) {
      return;
    }
    const slug = draft.slug.trim();
    const name = draft.name.trim();
    if (!slug || !name) {
      setFormError("Slug and name are required.");
      return;
    }

    const payload: Partial<Page> = {
      slug,
      name,
      description: draft.description.trim() || undefined,
      icon: draft.icon.trim() || undefined,
      sortOrder: toNumber(draft.sortOrder, 0),
      status: draft.status,
    };

    try {
      setSaving(true);
      setFormError(null);
      if (editingId != null) {
        await dispatch(
          updatePage({
            pageId: editingId,
            pageData: { ...payload, updatedBy: typeof loggedUserId === "number" ? loggedUserId : undefined },
          }),
        ).unwrap();
      } else {
        await dispatch(
          createPage({ ...payload, createdBy: typeof loggedUserId === "number" ? loggedUserId : undefined }),
        ).unwrap();
      }
      await dispatch(fetchPages());
      dispatch(fetchAccessSnapshot());
      closeDrawer();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Failed to save page.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <SectionShell
        permissionsReady={permissions.ready}
        canView={permissions.canView}
        loading={pagesState.loading}
        error={pagesState.error}
        onRefresh={() => dispatch(fetchPages())}
      >
        <Card withBorder radius="md" p="md">
          <Group justify="space-between" wrap="wrap">
            <Group wrap="wrap" gap="sm">
              <TextInput
                placeholder="Search by name, slug, icon..."
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                w={320}
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
              <Badge variant="light" color="green">
                Active: {records.filter((record) => Boolean(record.status)).length}
              </Badge>
              <Button leftSection={<IconPlus size={16} />} onClick={openCreate} disabled={!permissions.canCreate}>
                New Page
              </Button>
            </Group>
          </Group>
        </Card>

        {filtered.length === 0 ? (
          <Alert color="gray" title="No pages found">
            Adjust filters or create a new page.
          </Alert>
        ) : (
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
            {filtered.map((record) => (
              <Paper key={record.id ?? `${record.slug}-${record.name}`} withBorder radius="md" p="md">
                <Stack gap={8}>
                  <Group justify="space-between" align="start">
                    <div>
                      <Text fw={600}>{record.name ?? "Unnamed page"}</Text>
                      <Text size="sm" c="dimmed">
                        {record.slug ?? "no-slug"}
                      </Text>
                    </div>
                    <Badge color={record.status ? "green" : "gray"} variant="light">
                      {record.status ? "Active" : "Inactive"}
                    </Badge>
                  </Group>
                  <Text size="sm" c="dimmed">
                    {record.description ?? "No description"}
                  </Text>
                  <Group gap="xs">
                    <Badge variant="outline">Sort #{toNumber(record.sortOrder, 0)}</Badge>
                    {record.icon ? <Badge variant="outline">{record.icon}</Badge> : null}
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

      <Drawer opened={drawerOpened} onClose={closeDrawer} title={editingId != null ? "Edit Page" : "Create Page"} size="md">
        <Stack gap="sm">
          {formError ? (
            <Alert color="red" title="Validation error">
              {formError}
            </Alert>
          ) : null}
          <TextInput label="Slug" value={draft.slug} onChange={(e) => setDraft((prev) => ({ ...prev, slug: e.currentTarget.value }))} required />
          <TextInput label="Name" value={draft.name} onChange={(e) => setDraft((prev) => ({ ...prev, name: e.currentTarget.value }))} required />
          <TextInput
            label="Description"
            value={draft.description}
            onChange={(e) => setDraft((prev) => ({ ...prev, description: e.currentTarget.value }))}
          />
          <TextInput label="Icon" value={draft.icon} onChange={(e) => setDraft((prev) => ({ ...prev, icon: e.currentTarget.value }))} />
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

