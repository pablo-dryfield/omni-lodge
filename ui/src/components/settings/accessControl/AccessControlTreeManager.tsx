import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Accordion,
  Alert,
  Badge,
  Button,
  Card,
  Center,
  Drawer,
  Group,
  Loader,
  NumberInput,
  Pagination,
  Paper,
  MultiSelect,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { IconPencil, IconPlus, IconRefresh, IconTrash } from "@tabler/icons-react";
import { useAppDispatch, useAppSelector } from "../../../store/hooks";
import { useModuleAccess } from "../../../hooks/useModuleAccess";
import { fetchPages, createPage, updatePage, deletePage } from "../../../actions/pageActions";
import { fetchModules, createModule, updateModule, deleteModule } from "../../../actions/moduleActions";
import {
  fetchRolePagePermissions,
  createRolePagePermission,
  updateRolePagePermission,
  deleteRolePagePermission,
} from "../../../actions/rolePagePermissionActions";
import {
  fetchRoleModulePermissions,
  createRoleModulePermission,
  updateRoleModulePermission,
  deleteRoleModulePermission,
} from "../../../actions/roleModulePermissionActions";
import { fetchUserTypes } from "../../../actions/userTypeActions";
import { fetchActions } from "../../../actions/actionActions";
import { fetchAccessSnapshot } from "../../../actions/accessControlActions";
import { Page } from "../../../types/pages/Page";
import { Module } from "../../../types/modules/Module";
import { RolePagePermission } from "../../../types/permissions/RolePagePermission";
import { RoleModulePermission } from "../../../types/permissions/RoleModulePermission";
import { formatDate, includesSearch, toNumber } from "./helpers";

type PageDraft = {
  slug: string;
  name: string;
  description: string;
  icon: string;
  sortOrder: number;
  status: boolean;
};

type ModuleDraft = {
  pageId: string;
  slug: string;
  name: string;
  description: string;
  componentRef: string;
  sortOrder: number;
  status: boolean;
};

type RolePagePermissionDraft = {
  userTypeId: string;
  pageId: string;
  canView: boolean;
  status: boolean;
};

type RoleModulePermissionDraft = {
  userTypeId: string;
  moduleId: string;
  actionIds: string[];
  status: boolean;
};

const MODULE_SLUGS = {
  pages: "settings-pages-admin",
  modules: "settings-modules-admin",
  pagePermissions: "settings-page-permissions",
  modulePermissions: "settings-module-permissions",
} as const;

const newPageDraft = (sortOrder: number): PageDraft => ({
  slug: "",
  name: "",
  description: "",
  icon: "",
  sortOrder,
  status: true,
});

const newModuleDraft = (pageId: number | null, sortOrder: number): ModuleDraft => ({
  pageId: pageId != null ? String(pageId) : "",
  slug: "",
  name: "",
  description: "",
  componentRef: "",
  sortOrder,
  status: true,
});

const newRolePagePermissionDraft = (pageId: number | null): RolePagePermissionDraft => ({
  userTypeId: "",
  pageId: pageId != null ? String(pageId) : "",
  canView: true,
  status: true,
});

const newRoleModulePermissionDraft = (moduleId: number | null): RoleModulePermissionDraft => ({
  userTypeId: "",
  moduleId: moduleId != null ? String(moduleId) : "",
  actionIds: [],
  status: true,
});

export const AccessControlTreeManager = () => {
  const dispatch = useAppDispatch();
  const pagesState = useAppSelector((state) => state.pages)[0];
  const modulesState = useAppSelector((state) => state.modules)[0];
  const rolePagePermissionsState = useAppSelector((state) => state.rolePagePermissions)[0];
  const roleModulePermissionsState = useAppSelector((state) => state.roleModulePermissions)[0];
  const userTypesState = useAppSelector((state) => state.userTypes)[0];
  const actionsState = useAppSelector((state) => state.actions)[0];
  const { loggedUserId } = useAppSelector((state) => state.session);

  const pageAccess = useModuleAccess(MODULE_SLUGS.pages);
  const moduleAccess = useModuleAccess(MODULE_SLUGS.modules);
  const rolePageAccess = useModuleAccess(MODULE_SLUGS.pagePermissions);
  const roleModuleAccess = useModuleAccess(MODULE_SLUGS.modulePermissions);

  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [uiError, setUiError] = useState<string | null>(null);
  const [treePage, setTreePage] = useState(1);
  const [treePageSizeValue, setTreePageSizeValue] = useState("10");

  const [pageDrawerOpened, setPageDrawerOpened] = useState(false);
  const [editingPageId, setEditingPageId] = useState<number | null>(null);
  const [pageDraft, setPageDraft] = useState<PageDraft>(newPageDraft(10));
  const [pageSaving, setPageSaving] = useState(false);
  const [pageFormError, setPageFormError] = useState<string | null>(null);

  const [moduleDrawerOpened, setModuleDrawerOpened] = useState(false);
  const [editingModuleId, setEditingModuleId] = useState<number | null>(null);
  const [moduleDraft, setModuleDraft] = useState<ModuleDraft>(newModuleDraft(null, 10));
  const [moduleSaving, setModuleSaving] = useState(false);
  const [moduleFormError, setModuleFormError] = useState<string | null>(null);

  const [pagePermDrawerOpened, setPagePermDrawerOpened] = useState(false);
  const [editingPagePermId, setEditingPagePermId] = useState<number | null>(null);
  const [pagePermDraft, setPagePermDraft] = useState<RolePagePermissionDraft>(newRolePagePermissionDraft(null));
  const [pagePermSaving, setPagePermSaving] = useState(false);
  const [pagePermFormError, setPagePermFormError] = useState<string | null>(null);

  const [modulePermDrawerOpened, setModulePermDrawerOpened] = useState(false);
  const [editingModulePermId, setEditingModulePermId] = useState<number | null>(null);
  const [modulePermDraft, setModulePermDraft] = useState<RoleModulePermissionDraft>(newRoleModulePermissionDraft(null));
  const [modulePermSaving, setModulePermSaving] = useState(false);
  const [modulePermFormError, setModulePermFormError] = useState<string | null>(null);

  const refreshAll = useCallback(() => {
    dispatch(fetchPages());
    dispatch(fetchModules());
    dispatch(fetchRolePagePermissions());
    dispatch(fetchRoleModulePermissions());
    dispatch(fetchUserTypes());
    dispatch(fetchActions());
  }, [dispatch]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  const pageLabelById = useMemo(() => {
    const map = new Map<number, string>();
    (pagesState.data[0]?.data ?? []).forEach((record) => {
      if (typeof record.id === "number") {
        map.set(record.id, record.name ?? record.slug ?? `Page #${record.id}`);
      }
    });
    return map;
  }, [pagesState.data]);

  const moduleLabelById = useMemo(() => {
    const map = new Map<number, string>();
    (modulesState.data[0]?.data ?? []).forEach((record) => {
      if (typeof record.id === "number") {
        map.set(record.id, record.name ?? record.slug ?? `Module #${record.id}`);
      }
    });
    return map;
  }, [modulesState.data]);

  const userTypeLabelById = useMemo(() => {
    const map = new Map<number, string>();
    (userTypesState.data[0]?.data ?? []).forEach((record) => {
      if (typeof record.id === "number") {
        map.set(record.id, record.name ?? `Role #${record.id}`);
      }
    });
    return map;
  }, [userTypesState.data]);

  const actionLabelById = useMemo(() => {
    const map = new Map<number, string>();
    (actionsState.data[0]?.data ?? []).forEach((record) => {
      if (typeof record.id === "number") {
        map.set(record.id, record.name ?? record.key ?? `Action #${record.id}`);
      }
    });
    return map;
  }, [actionsState.data]);

  const pageOptions = useMemo(
    () =>
      Array.from(pageLabelById.entries())
        .map(([id, label]) => ({ value: String(id), label: `${label} (#${id})` }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [pageLabelById],
  );

  const moduleOptions = useMemo(
    () =>
      Array.from(moduleLabelById.entries())
        .map(([id, label]) => ({ value: String(id), label: `${label} (#${id})` }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [moduleLabelById],
  );

  const userTypeOptions = useMemo(
    () =>
      Array.from(userTypeLabelById.entries())
        .map(([id, label]) => ({ value: String(id), label: `${label} (#${id})` }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [userTypeLabelById],
  );

  const actionOptions = useMemo(
    () =>
      Array.from(actionLabelById.entries())
        .map(([id, label]) => ({ value: String(id), label: `${label} (#${id})` }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [actionLabelById],
  );

  const pages = useMemo(
    () =>
      [...(pagesState.data[0]?.data ?? [])].sort(
        (a, b) => toNumber(a.sortOrder, 0) - toNumber(b.sortOrder, 0),
      ),
    [pagesState.data],
  );

  const modulesByPage = useMemo(() => {
    const map = new Map<number, Partial<Module>[]>();
    (modulesState.data[0]?.data ?? []).forEach((record) => {
      const pageId = toNumber(record.pageId, NaN);
      if (!Number.isFinite(pageId)) {
        return;
      }
      const bucket = map.get(pageId) ?? [];
      bucket.push(record);
      map.set(pageId, bucket);
    });
    map.forEach((records) => {
      records.sort((a, b) => toNumber(a.sortOrder, 0) - toNumber(b.sortOrder, 0));
    });
    return map;
  }, [modulesState.data]);

  const rolePagePermissionsByPage = useMemo(() => {
    const map = new Map<number, Partial<RolePagePermission>[]>();
    (rolePagePermissionsState.data[0]?.data ?? []).forEach((record) => {
      const pageId = toNumber(record.pageId, NaN);
      if (!Number.isFinite(pageId)) {
        return;
      }
      const bucket = map.get(pageId) ?? [];
      bucket.push(record);
      map.set(pageId, bucket);
    });
    return map;
  }, [rolePagePermissionsState.data]);

  const roleModulePermissionsByModule = useMemo(() => {
    const map = new Map<number, Partial<RoleModulePermission>[]>();
    (roleModulePermissionsState.data[0]?.data ?? []).forEach((record) => {
      const moduleId = toNumber(record.moduleId, NaN);
      if (!Number.isFinite(moduleId)) {
        return;
      }
      const bucket = map.get(moduleId) ?? [];
      bucket.push(record);
      map.set(moduleId, bucket);
    });
    return map;
  }, [roleModulePermissionsState.data]);

  const includeRecord = useCallback(
    (status: boolean | null | undefined) => showInactive || Boolean(status),
    [showInactive],
  );

  const filteredPages = useMemo(() => {
    const hasQuery = query.trim().length > 0;
    return pages.filter((page) => {
      if (!includeRecord(page.status)) {
        return false;
      }

      const pageId = toNumber(page.id, -1);
      const modules = (modulesByPage.get(pageId) ?? []).filter((record) => includeRecord(record.status));
      const pagePerms = (rolePagePermissionsByPage.get(pageId) ?? []).filter((record) =>
        includeRecord(record.status),
      );

      if (!hasQuery) {
        return true;
      }

      const pageMatch = includesSearch(query, page.name, page.slug, page.description, page.icon);
      const pagePermMatch = pagePerms.some((record) =>
        includesSearch(
          query,
          userTypeLabelById.get(toNumber(record.userTypeId, -1)),
          record.canView ? "can view" : "cannot view",
        ),
      );

      const moduleMatch = modules.some((record) => {
        const moduleSelf = includesSearch(query, record.name, record.slug, record.description, record.componentRef);
        const modulePerms = (roleModulePermissionsByModule.get(toNumber(record.id, -1)) ?? []).filter((perm) =>
          includeRecord(perm.status),
        );
        const modulePermMatch = modulePerms.some((perm) =>
          includesSearch(
            query,
            userTypeLabelById.get(toNumber(perm.userTypeId, -1)),
            actionLabelById.get(toNumber(perm.actionId, -1)),
            perm.allowed ? "allowed" : "denied",
          ),
        );
        return moduleSelf || modulePermMatch;
      });

      return pageMatch || pagePermMatch || moduleMatch;
    });
  }, [
    pages,
    query,
    includeRecord,
    modulesByPage,
    rolePagePermissionsByPage,
    roleModulePermissionsByModule,
    userTypeLabelById,
    actionLabelById,
  ]);

  const treePageSize = Math.max(1, toNumber(treePageSizeValue, 10));
  const totalTreePages = Math.max(1, Math.ceil(filteredPages.length / treePageSize));

  useEffect(() => {
    setTreePage(1);
  }, [query, showInactive, treePageSize]);

  useEffect(() => {
    if (treePage > totalTreePages) {
      setTreePage(totalTreePages);
    }
  }, [treePage, totalTreePages]);

  const paginatedPages = useMemo(() => {
    const start = (treePage - 1) * treePageSize;
    return filteredPages.slice(start, start + treePageSize);
  }, [filteredPages, treePage, treePageSize]);

  const nextPageSortOrder = useMemo(() => {
    if (!pages.length) {
      return 10;
    }
    const maxValue = pages.reduce((acc, record) => Math.max(acc, toNumber(record.sortOrder, 0)), 0);
    return maxValue + 10;
  }, [pages]);

  const nextModuleSortOrder = (pageId: number | null) => {
    if (pageId == null) {
      return 10;
    }
    const modules = modulesByPage.get(pageId) ?? [];
    if (!modules.length) {
      return 10;
    }
    const maxValue = modules.reduce((acc, record) => Math.max(acc, toNumber(record.sortOrder, 0)), 0);
    return maxValue + 10;
  };

  const withUserAudit = (kind: "create" | "update") => ({
    ...(kind === "create" ? { createdBy: loggedUserId } : { updatedBy: loggedUserId }),
  });

  const parseError = (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback;

  const allPermissionReady =
    pageAccess.ready && moduleAccess.ready && rolePageAccess.ready && roleModuleAccess.ready;
  const canViewAnything =
    pageAccess.canView || moduleAccess.canView || rolePageAccess.canView || roleModuleAccess.canView;
  const loadingAny =
    pagesState.loading ||
    modulesState.loading ||
    rolePagePermissionsState.loading ||
    roleModulePermissionsState.loading ||
    userTypesState.loading ||
    actionsState.loading;

  if (!allPermissionReady) {
    return (
      <Center style={{ minHeight: 240 }}>
        <Loader variant="dots" />
      </Center>
    );
  }

  if (!canViewAnything) {
    return (
      <Alert color="yellow" title="No access">
        You do not have permission to view this access-control tree.
      </Alert>
    );
  }

  return (
    <Stack gap="md">
      <Card withBorder radius="md" p="md">
        <Group justify="space-between" align="end" wrap="wrap">
          <Group gap="sm" wrap="wrap">
            <TextInput
              label="Search tree"
              placeholder="Page, module, role, action..."
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              w={320}
            />
            <Switch
              label="Show inactive"
              checked={showInactive}
              onChange={(event) => setShowInactive(event.currentTarget.checked)}
            />
          </Group>
          <Group gap="xs" wrap="wrap">
            <Select
              label="Pages per view"
              data={[
                { value: "5", label: "5" },
                { value: "10", label: "10" },
                { value: "20", label: "20" },
                { value: "50", label: "50" },
              ]}
              value={treePageSizeValue}
              onChange={(value) => setTreePageSizeValue(value ?? "10")}
              w={140}
            />
            <Button
              variant="default"
              leftSection={<IconRefresh size={16} />}
              onClick={refreshAll}
              loading={loadingAny}
            >
              Refresh
            </Button>
            <Button
              leftSection={<IconPlus size={16} />}
              onClick={() => {
                setEditingPageId(null);
                setPageDraft(newPageDraft(nextPageSortOrder));
                setPageFormError(null);
                setPageDrawerOpened(true);
              }}
              disabled={!pageAccess.canCreate}
            >
              New Page
            </Button>
          </Group>
        </Group>
      </Card>

      {uiError ? (
        <Alert color="red" title="Action failed">
          {uiError}
        </Alert>
      ) : null}

      {filteredPages.length === 0 ? (
        <Alert color="gray" title="No matching pages">
          No records match the current filters.
        </Alert>
      ) : (
        <Stack gap="md">
          <Group justify="space-between" wrap="wrap">
            <Text size="sm" c="dimmed">
              Showing {(treePage - 1) * treePageSize + 1}-
              {Math.min(treePage * treePageSize, filteredPages.length)} of {filteredPages.length} pages
            </Text>
            <Pagination value={treePage} onChange={setTreePage} total={totalTreePages} />
          </Group>

          {paginatedPages.map((page) => {
            const pageId = toNumber(page.id, -1);
            const modules = (modulesByPage.get(pageId) ?? []).filter((record) => includeRecord(record.status));
            const pagePerms = (rolePagePermissionsByPage.get(pageId) ?? []).filter((record) => includeRecord(record.status));

            return (
              <Card key={pageId} withBorder radius="md" p="md">
                <Stack gap="sm">
                  <Group justify="space-between" align="start" wrap="wrap">
                    <div>
                      <Text fw={700}>{page.name ?? "Unnamed page"}</Text>
                      <Text size="sm" c="dimmed">
                        {page.slug ?? "no-slug"}
                      </Text>
                      <Text size="xs" c="dimmed">
                        Updated {formatDate(page.updatedAt)}
                      </Text>
                    </div>
                    <Group gap="xs" wrap="wrap">
                      <Badge color={page.status ? "green" : "gray"} variant="light">
                        {page.status ? "Active" : "Inactive"}
                      </Badge>
                      <Badge variant="outline">Sort #{toNumber(page.sortOrder, 0)}</Badge>
                    </Group>
                  </Group>

                  {page.description ? <Text size="sm">{page.description}</Text> : null}

                  <Group gap="xs" justify="flex-end" wrap="wrap">
                    <Button
                      size="xs"
                      variant="default"
                      leftSection={<IconPlus size={14} />}
                      onClick={() => {
                        setEditingModuleId(null);
                        setModuleDraft(newModuleDraft(pageId, nextModuleSortOrder(pageId)));
                        setModuleFormError(null);
                        setModuleDrawerOpened(true);
                      }}
                      disabled={!moduleAccess.canCreate}
                    >
                      Add Module
                    </Button>
                    <Button
                      size="xs"
                      variant="default"
                      leftSection={<IconPlus size={14} />}
                      onClick={() => {
                        setEditingPagePermId(null);
                        setPagePermDraft(newRolePagePermissionDraft(pageId));
                        setPagePermFormError(null);
                        setPagePermDrawerOpened(true);
                      }}
                      disabled={!rolePageAccess.canCreate}
                    >
                      Add Page Permission
                    </Button>
                    <Button
                      size="xs"
                      variant="light"
                      leftSection={<IconPencil size={14} />}
                      onClick={() => {
                        setEditingPageId(pageId);
                        setPageDraft({
                          slug: String(page.slug ?? ""),
                          name: String(page.name ?? ""),
                          description: String(page.description ?? ""),
                          icon: String(page.icon ?? ""),
                          sortOrder: toNumber(page.sortOrder, 0),
                          status: Boolean(page.status),
                        });
                        setPageFormError(null);
                        setPageDrawerOpened(true);
                      }}
                      disabled={!pageAccess.canUpdate}
                    >
                      Edit Page
                    </Button>
                    <Button
                      size="xs"
                      variant="light"
                      color="red"
                      leftSection={<IconTrash size={14} />}
                      onClick={async () => {
                        if (!pageAccess.canDelete || typeof page.id !== "number") return;
                        if (!window.confirm(`Delete page "${page.name ?? page.slug ?? page.id}"?`)) return;
                        try {
                          setUiError(null);
                          await dispatch(deletePage(page.id)).unwrap();
                          await dispatch(fetchPages());
                          dispatch(fetchAccessSnapshot());
                        } catch (error) {
                          setUiError(parseError(error, "Failed to delete page."));
                        }
                      }}
                      disabled={!pageAccess.canDelete}
                    >
                      Delete Page
                    </Button>
                  </Group>

                  <Accordion multiple variant="separated">
                    <Accordion.Item value={`page-permissions-${pageId}`}>
                      <Accordion.Control>
                        <Text fw={600} size="sm">
                          Page Permissions ({pagePerms.length})
                        </Text>
                      </Accordion.Control>
                      <Accordion.Panel>
                        {pagePerms.length === 0 ? (
                          <Text size="sm" c="dimmed">
                            No page permissions for this page.
                          </Text>
                        ) : (
                          <Stack gap="xs">
                        {pagePerms.map((permission) => (
                          <Paper key={permission.id ?? `${permission.userTypeId}-${permission.pageId}`} withBorder p="xs" radius="md">
                            <Group justify="space-between" wrap="wrap">
                              <Group gap="xs">
                                <Text size="sm">
                                  {userTypeLabelById.get(toNumber(permission.userTypeId, -1)) ?? `Role #${permission.userTypeId}`}
                                </Text>
                                <Badge color={permission.canView ? "teal" : "red"} variant="light">
                                  {permission.canView ? "Can View" : "Cannot View"}
                                </Badge>
                                <Badge color={permission.status ? "green" : "gray"} variant="light">
                                  {permission.status ? "Active" : "Inactive"}
                                </Badge>
                              </Group>
                              <Group gap={6}>
                                <Button
                                  size="xs"
                                  variant="subtle"
                                  onClick={() => {
                                    setEditingPagePermId(toNumber(permission.id, -1));
                                    setPagePermDraft({
                                      userTypeId: String(permission.userTypeId ?? ""),
                                      pageId: String(permission.pageId ?? ""),
                                      canView: Boolean(permission.canView),
                                      status: Boolean(permission.status),
                                    });
                                    setPagePermFormError(null);
                                    setPagePermDrawerOpened(true);
                                  }}
                                  disabled={!rolePageAccess.canUpdate}
                                >
                                  Edit
                                </Button>
                                <Button
                                  size="xs"
                                  variant="subtle"
                                  color="red"
                                  onClick={async () => {
                                    if (!rolePageAccess.canDelete || typeof permission.id !== "number") return;
                                    if (!window.confirm("Delete this page permission?")) return;
                                    try {
                                      setUiError(null);
                                      await dispatch(deleteRolePagePermission(permission.id)).unwrap();
                                      await dispatch(fetchRolePagePermissions());
                                      dispatch(fetchAccessSnapshot());
                                    } catch (error) {
                                      setUiError(parseError(error, "Failed to delete page permission."));
                                    }
                                  }}
                                  disabled={!rolePageAccess.canDelete}
                                >
                                  Delete
                                </Button>
                              </Group>
                            </Group>
                          </Paper>
                        ))}
                          </Stack>
                        )}
                      </Accordion.Panel>
                    </Accordion.Item>

                    <Accordion.Item value={`modules-${pageId}`}>
                      <Accordion.Control>
                    <Text fw={600} size="sm">
                      Modules ({modules.length})
                    </Text>
                      </Accordion.Control>
                      <Accordion.Panel>
                    {modules.length === 0 ? (
                      <Text size="sm" c="dimmed">
                        No modules under this page.
                      </Text>
                    ) : (
                      <Stack gap="sm">
                        {modules.map((module) => {
                          const moduleId = toNumber(module.id, -1);
                          const modulePerms = (roleModulePermissionsByModule.get(moduleId) ?? []).filter((record) =>
                            includeRecord(record.status),
                          );

                          return (
                            <Paper key={moduleId} withBorder p="sm" radius="md">
                              <Stack gap="xs">
                                <Group justify="space-between" align="start" wrap="wrap">
                                  <div>
                                    <Text fw={600}>{module.name ?? "Unnamed module"}</Text>
                                    <Text size="sm" c="dimmed">
                                      {module.slug ?? "no-slug"}
                                    </Text>
                                    <Text size="xs" c="dimmed">
                                      Updated {formatDate(module.updatedAt)}
                                    </Text>
                                  </div>
                                  <Group gap="xs">
                                    <Badge color={module.status ? "green" : "gray"} variant="light">
                                      {module.status ? "Active" : "Inactive"}
                                    </Badge>
                                    <Badge variant="outline">Sort #{toNumber(module.sortOrder, 0)}</Badge>
                                  </Group>
                                </Group>

                                <Group justify="flex-end" gap="xs" wrap="wrap">
                                  <Button
                                    size="xs"
                                    variant="default"
                                    leftSection={<IconPlus size={14} />}
                                    onClick={() => {
                                      setEditingModulePermId(null);
                                      setModulePermDraft(newRoleModulePermissionDraft(moduleId));
                                      setModulePermFormError(null);
                                      setModulePermDrawerOpened(true);
                                    }}
                                    disabled={!roleModuleAccess.canCreate}
                                  >
                                    Add Module Permission
                                  </Button>
                                  <Button
                                    size="xs"
                                    variant="light"
                                    leftSection={<IconPencil size={14} />}
                                    onClick={() => {
                                      setEditingModuleId(moduleId);
                                      setModuleDraft({
                                        pageId: String(module.pageId ?? ""),
                                        slug: String(module.slug ?? ""),
                                        name: String(module.name ?? ""),
                                        description: String(module.description ?? ""),
                                        componentRef: String(module.componentRef ?? ""),
                                        sortOrder: toNumber(module.sortOrder, 0),
                                        status: Boolean(module.status),
                                      });
                                      setModuleFormError(null);
                                      setModuleDrawerOpened(true);
                                    }}
                                    disabled={!moduleAccess.canUpdate}
                                  >
                                    Edit Module
                                  </Button>
                                  <Button
                                    size="xs"
                                    variant="light"
                                    color="red"
                                    leftSection={<IconTrash size={14} />}
                                    onClick={async () => {
                                      if (!moduleAccess.canDelete || typeof module.id !== "number") return;
                                      if (!window.confirm(`Delete module "${module.name ?? module.slug ?? module.id}"?`)) return;
                                      try {
                                        setUiError(null);
                                        await dispatch(deleteModule(module.id)).unwrap();
                                        await dispatch(fetchModules());
                                        dispatch(fetchAccessSnapshot());
                                      } catch (error) {
                                        setUiError(parseError(error, "Failed to delete module."));
                                      }
                                    }}
                                    disabled={!moduleAccess.canDelete}
                                  >
                                    Delete Module
                                  </Button>
                                </Group>

                                {(() => {
                                  const groupedPermissions = Array.from(
                                    modulePerms.reduce((map, permission) => {
                                      const userTypeId = toNumber(permission.userTypeId, NaN);
                                      if (!Number.isFinite(userTypeId)) {
                                        return map;
                                      }
                                      const bucket = map.get(userTypeId) ?? [];
                                      bucket.push(permission);
                                      map.set(userTypeId, bucket);
                                      return map;
                                    }, new Map<number, Partial<RoleModulePermission>[]>()),
                                  ).map(([userTypeId, rows]) => {
                                    const allowedActionIds = Array.from(
                                      new Set(
                                        rows
                                          .filter((record) => Boolean(record.allowed))
                                          .map((record) => String(record.actionId ?? ""))
                                          .filter((value) => value.length > 0),
                                      ),
                                    );
                                    const allowedActionLabels = allowedActionIds.map((value) => {
                                      const actionId = toNumber(value, -1);
                                      return actionLabelById.get(actionId) ?? `Action #${value}`;
                                    });
                                    return {
                                      userTypeId,
                                      rows,
                                      allowedActionIds,
                                      allowedActionLabels,
                                      status: rows.some((record) => Boolean(record.status)),
                                    };
                                  });

                                  return (
                                    <>
                                      <Text fw={500} size="sm">
                                        Module Permissions ({groupedPermissions.length})
                                      </Text>
                                      {groupedPermissions.length === 0 ? (
                                        <Text size="sm" c="dimmed">
                                          No module permissions.
                                        </Text>
                                      ) : (
                                        <Stack gap="xs">
                                          {groupedPermissions.map((setItem) => (
                                            <Paper key={`${moduleId}-${setItem.userTypeId}`} withBorder p="xs" radius="md">
                                              <Group justify="space-between" wrap="wrap">
                                                <Group gap="xs">
                                                  <Text size="sm">
                                                    {userTypeLabelById.get(setItem.userTypeId) ?? `Role #${setItem.userTypeId}`}
                                                  </Text>
                                                  <Badge color={setItem.status ? "green" : "gray"} variant="light">
                                                    {setItem.status ? "Active" : "Inactive"}
                                                  </Badge>
                                                  {setItem.allowedActionLabels.length === 0 ? (
                                                    <Badge color="red" variant="light">
                                                      No actions
                                                    </Badge>
                                                  ) : (
                                                    setItem.allowedActionLabels.map((label) => (
                                                      <Badge key={`${moduleId}-${setItem.userTypeId}-${label}`} variant="outline">
                                                        {label}
                                                      </Badge>
                                                    ))
                                                  )}
                                                </Group>
                                                <Group gap={6}>
                                                  <Button
                                                    size="xs"
                                                    variant="subtle"
                                                    onClick={() => {
                                                      setEditingModulePermId(setItem.rows.find((record) => typeof record.id === "number")?.id ?? null);
                                                      setModulePermDraft({
                                                        userTypeId: String(setItem.userTypeId),
                                                        moduleId: String(moduleId),
                                                        actionIds: setItem.allowedActionIds,
                                                        status: setItem.status,
                                                      });
                                                      setModulePermFormError(null);
                                                      setModulePermDrawerOpened(true);
                                                    }}
                                                    disabled={!roleModuleAccess.canUpdate}
                                                  >
                                                    Edit
                                                  </Button>
                                                  <Button
                                                    size="xs"
                                                    variant="subtle"
                                                    color="red"
                                                    onClick={async () => {
                                                      if (!roleModuleAccess.canDelete) return;
                                                      if (!window.confirm("Delete this permission set?")) return;
                                                      try {
                                                        setUiError(null);
                                                        const idsToDelete = setItem.rows
                                                          .map((record) => record.id)
                                                          .filter((value): value is number => typeof value === "number");
                                                        for (const id of idsToDelete) {
                                                          await dispatch(deleteRoleModulePermission(id)).unwrap();
                                                        }
                                                        await dispatch(fetchRoleModulePermissions());
                                                        dispatch(fetchAccessSnapshot());
                                                      } catch (error) {
                                                        setUiError(parseError(error, "Failed to delete module permission set."));
                                                      }
                                                    }}
                                                    disabled={!roleModuleAccess.canDelete}
                                                  >
                                                    Delete
                                                  </Button>
                                                </Group>
                                              </Group>
                                            </Paper>
                                          ))}
                                        </Stack>
                                      )}
                                    </>
                                  );
                                })()}
                              </Stack>
                            </Paper>
                          );
                        })}
                      </Stack>
                    )}
                      </Accordion.Panel>
                    </Accordion.Item>
                  </Accordion>
                </Stack>
              </Card>
            );
          })}

          {totalTreePages > 1 ? (
            <Group justify="flex-end">
              <Pagination value={treePage} onChange={setTreePage} total={totalTreePages} />
            </Group>
          ) : null}
        </Stack>
      )}

      <Drawer
        opened={pageDrawerOpened}
        onClose={() => setPageDrawerOpened(false)}
        title={editingPageId == null ? "Create Page" : "Edit Page"}
        size="md"
      >
        <Stack gap="sm">
          {pageFormError ? <Alert color="red">{pageFormError}</Alert> : null}
          <TextInput
            label="Slug"
            value={pageDraft.slug}
            onChange={(event) => setPageDraft((prev) => ({ ...prev, slug: event.currentTarget.value }))}
            required
          />
          <TextInput
            label="Name"
            value={pageDraft.name}
            onChange={(event) => setPageDraft((prev) => ({ ...prev, name: event.currentTarget.value }))}
            required
          />
          <TextInput
            label="Description"
            value={pageDraft.description}
            onChange={(event) => setPageDraft((prev) => ({ ...prev, description: event.currentTarget.value }))}
          />
          <TextInput
            label="Icon"
            value={pageDraft.icon}
            onChange={(event) => setPageDraft((prev) => ({ ...prev, icon: event.currentTarget.value }))}
          />
          <NumberInput
            label="Sort order"
            value={pageDraft.sortOrder}
            onChange={(value) => setPageDraft((prev) => ({ ...prev, sortOrder: toNumber(value, 0) }))}
            min={0}
          />
          <Switch
            label="Active"
            checked={pageDraft.status}
            onChange={(event) => setPageDraft((prev) => ({ ...prev, status: event.currentTarget.checked }))}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setPageDrawerOpened(false)} disabled={pageSaving}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if ((editingPageId == null && !pageAccess.canCreate) || (editingPageId != null && !pageAccess.canUpdate)) return;
                if (!pageDraft.slug.trim() || !pageDraft.name.trim()) {
                  setPageFormError("Slug and name are required.");
                  return;
                }
                const payload: Partial<Page> = {
                  ...pageDraft,
                  slug: pageDraft.slug.trim(),
                  name: pageDraft.name.trim(),
                };
                try {
                  setPageSaving(true);
                  setPageFormError(null);
                  setUiError(null);
                  if (editingPageId != null) {
                    await dispatch(updatePage({ pageId: editingPageId, pageData: { ...payload, ...withUserAudit("update") } })).unwrap();
                  } else {
                    await dispatch(createPage({ ...payload, ...withUserAudit("create") })).unwrap();
                  }
                  await dispatch(fetchPages());
                  dispatch(fetchAccessSnapshot());
                  setPageDrawerOpened(false);
                } catch (error) {
                  setPageFormError(parseError(error, "Failed to save page."));
                } finally {
                  setPageSaving(false);
                }
              }}
              loading={pageSaving}
            >
              Save
            </Button>
          </Group>
        </Stack>
      </Drawer>

      <Drawer
        opened={moduleDrawerOpened}
        onClose={() => setModuleDrawerOpened(false)}
        title={editingModuleId == null ? "Create Module" : "Edit Module"}
        size="md"
      >
        <Stack gap="sm">
          {moduleFormError ? <Alert color="red">{moduleFormError}</Alert> : null}
          <Select
            label="Page"
            data={pageOptions}
            value={moduleDraft.pageId}
            onChange={(value) => setModuleDraft((prev) => ({ ...prev, pageId: value ?? "" }))}
            searchable
            required
          />
          <TextInput
            label="Slug"
            value={moduleDraft.slug}
            onChange={(event) => setModuleDraft((prev) => ({ ...prev, slug: event.currentTarget.value }))}
            required
          />
          <TextInput
            label="Name"
            value={moduleDraft.name}
            onChange={(event) => setModuleDraft((prev) => ({ ...prev, name: event.currentTarget.value }))}
            required
          />
          <TextInput
            label="Description"
            value={moduleDraft.description}
            onChange={(event) => setModuleDraft((prev) => ({ ...prev, description: event.currentTarget.value }))}
          />
          <TextInput
            label="Component ref"
            value={moduleDraft.componentRef}
            onChange={(event) => setModuleDraft((prev) => ({ ...prev, componentRef: event.currentTarget.value }))}
          />
          <NumberInput
            label="Sort order"
            value={moduleDraft.sortOrder}
            onChange={(value) => setModuleDraft((prev) => ({ ...prev, sortOrder: toNumber(value, 0) }))}
            min={0}
          />
          <Switch
            label="Active"
            checked={moduleDraft.status}
            onChange={(event) => setModuleDraft((prev) => ({ ...prev, status: event.currentTarget.checked }))}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setModuleDrawerOpened(false)} disabled={moduleSaving}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if ((editingModuleId == null && !moduleAccess.canCreate) || (editingModuleId != null && !moduleAccess.canUpdate)) return;
                const pageId = toNumber(moduleDraft.pageId, NaN);
                if (!Number.isFinite(pageId) || !moduleDraft.slug.trim() || !moduleDraft.name.trim()) {
                  setModuleFormError("Page, slug and name are required.");
                  return;
                }
                const payload: Partial<Module> = {
                  ...moduleDraft,
                  pageId,
                  slug: moduleDraft.slug.trim(),
                  name: moduleDraft.name.trim(),
                };
                try {
                  setModuleSaving(true);
                  setModuleFormError(null);
                  setUiError(null);
                  if (editingModuleId != null) {
                    await dispatch(updateModule({ moduleId: editingModuleId, moduleData: { ...payload, ...withUserAudit("update") } })).unwrap();
                  } else {
                    await dispatch(createModule({ ...payload, ...withUserAudit("create") })).unwrap();
                  }
                  await dispatch(fetchModules());
                  dispatch(fetchAccessSnapshot());
                  setModuleDrawerOpened(false);
                } catch (error) {
                  setModuleFormError(parseError(error, "Failed to save module."));
                } finally {
                  setModuleSaving(false);
                }
              }}
              loading={moduleSaving}
            >
              Save
            </Button>
          </Group>
        </Stack>
      </Drawer>

      <Drawer
        opened={pagePermDrawerOpened}
        onClose={() => setPagePermDrawerOpened(false)}
        title={editingPagePermId == null ? "Create Page Permission" : "Edit Page Permission"}
        size="md"
      >
        <Stack gap="sm">
          {pagePermFormError ? <Alert color="red">{pagePermFormError}</Alert> : null}
          <Select
            label="User type"
            data={userTypeOptions}
            value={pagePermDraft.userTypeId}
            onChange={(value) => setPagePermDraft((prev) => ({ ...prev, userTypeId: value ?? "" }))}
            searchable
            required
          />
          <Select
            label="Page"
            data={pageOptions}
            value={pagePermDraft.pageId}
            onChange={(value) => setPagePermDraft((prev) => ({ ...prev, pageId: value ?? "" }))}
            searchable
            required
          />
          <Switch
            label="Can view"
            checked={pagePermDraft.canView}
            onChange={(event) => setPagePermDraft((prev) => ({ ...prev, canView: event.currentTarget.checked }))}
          />
          <Switch
            label="Active"
            checked={pagePermDraft.status}
            onChange={(event) => setPagePermDraft((prev) => ({ ...prev, status: event.currentTarget.checked }))}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setPagePermDrawerOpened(false)} disabled={pagePermSaving}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if ((editingPagePermId == null && !rolePageAccess.canCreate) || (editingPagePermId != null && !rolePageAccess.canUpdate)) return;
                const userTypeId = toNumber(pagePermDraft.userTypeId, NaN);
                const pageId = toNumber(pagePermDraft.pageId, NaN);
                if (!Number.isFinite(userTypeId) || !Number.isFinite(pageId)) {
                  setPagePermFormError("User type and page are required.");
                  return;
                }
                const payload: Partial<RolePagePermission> = { ...pagePermDraft, userTypeId, pageId };
                try {
                  setPagePermSaving(true);
                  setPagePermFormError(null);
                  setUiError(null);
                  if (editingPagePermId != null) {
                    await dispatch(updateRolePagePermission({ id: editingPagePermId, updates: { ...payload, ...withUserAudit("update") } })).unwrap();
                  } else {
                    await dispatch(createRolePagePermission({ ...payload, ...withUserAudit("create") })).unwrap();
                  }
                  await dispatch(fetchRolePagePermissions());
                  dispatch(fetchAccessSnapshot());
                  setPagePermDrawerOpened(false);
                } catch (error) {
                  setPagePermFormError(parseError(error, "Failed to save page permission."));
                } finally {
                  setPagePermSaving(false);
                }
              }}
              loading={pagePermSaving}
            >
              Save
            </Button>
          </Group>
        </Stack>
      </Drawer>

      <Drawer
        opened={modulePermDrawerOpened}
        onClose={() => setModulePermDrawerOpened(false)}
        title={editingModulePermId == null ? "Create Permission Set" : "Edit Permission Set"}
        size="md"
      >
        <Stack gap="sm">
          {modulePermFormError ? <Alert color="red">{modulePermFormError}</Alert> : null}
          <Select
            label="User type"
            data={userTypeOptions}
            value={modulePermDraft.userTypeId}
            onChange={(value) => setModulePermDraft((prev) => ({ ...prev, userTypeId: value ?? "" }))}
            searchable
            required
          />
          <Select
            label="Module"
            data={moduleOptions}
            value={modulePermDraft.moduleId}
            onChange={(value) => setModulePermDraft((prev) => ({ ...prev, moduleId: value ?? "" }))}
            searchable
            required
          />
          <MultiSelect
            label="Allowed actions"
            data={actionOptions}
            value={modulePermDraft.actionIds}
            onChange={(value) => setModulePermDraft((prev) => ({ ...prev, actionIds: value }))}
            searchable
            required
          />
          <Switch
            label="Active"
            checked={modulePermDraft.status}
            onChange={(event) => setModulePermDraft((prev) => ({ ...prev, status: event.currentTarget.checked }))}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setModulePermDrawerOpened(false)} disabled={modulePermSaving}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if ((editingModulePermId == null && !roleModuleAccess.canCreate) || (editingModulePermId != null && !roleModuleAccess.canUpdate)) return;
                const userTypeId = toNumber(modulePermDraft.userTypeId, NaN);
                const moduleId = toNumber(modulePermDraft.moduleId, NaN);
                const selectedActionIds = Array.from(
                  new Set(
                    modulePermDraft.actionIds
                      .map((value) => toNumber(value, NaN))
                      .filter((value) => Number.isFinite(value)),
                  ),
                );
                if (!Number.isFinite(userTypeId) || !Number.isFinite(moduleId) || selectedActionIds.length === 0) {
                  setModulePermFormError("User type, module and at least one action are required.");
                  return;
                }
                try {
                  setModulePermSaving(true);
                  setModulePermFormError(null);
                  setUiError(null);

                  const existingRows = (roleModulePermissionsByModule.get(moduleId) ?? []).filter(
                    (record) => toNumber(record.userTypeId, NaN) === userTypeId,
                  );

                  const selectedSet = new Set<number>(selectedActionIds as number[]);
                  const existingByAction = new Map<number, Partial<RoleModulePermission>>();
                  existingRows.forEach((record) => {
                    const actionId = toNumber(record.actionId, NaN);
                    if (Number.isFinite(actionId) && !existingByAction.has(actionId)) {
                      existingByAction.set(actionId, record);
                    }
                  });

                  for (const actionId of selectedSet) {
                    const existing = existingByAction.get(actionId);
                    if (existing && typeof existing.id === "number") {
                      if (!existing.allowed || Boolean(existing.status) !== modulePermDraft.status) {
                        await dispatch(
                          updateRoleModulePermission({
                            id: existing.id,
                            updates: {
                              userTypeId,
                              moduleId,
                              actionId,
                              allowed: true,
                              status: modulePermDraft.status,
                              ...withUserAudit("update"),
                            },
                          }),
                        ).unwrap();
                      }
                    } else {
                      await dispatch(
                        createRoleModulePermission({
                          userTypeId,
                          moduleId,
                          actionId,
                          allowed: true,
                          status: modulePermDraft.status,
                          ...withUserAudit("create"),
                        }),
                      ).unwrap();
                    }
                  }

                  for (const existing of existingRows) {
                    const actionId = toNumber(existing.actionId, NaN);
                    if (!Number.isFinite(actionId) || selectedSet.has(actionId)) {
                      continue;
                    }
                    if (typeof existing.id === "number") {
                      await dispatch(deleteRoleModulePermission(existing.id)).unwrap();
                    }
                  }

                  await dispatch(fetchRoleModulePermissions());
                  dispatch(fetchAccessSnapshot());
                  setModulePermDrawerOpened(false);
                } catch (error) {
                  setModulePermFormError(parseError(error, "Failed to save module permission."));
                } finally {
                  setModulePermSaving(false);
                }
              }}
              loading={modulePermSaving}
            >
              Save
            </Button>
          </Group>
        </Stack>
      </Drawer>
    </Stack>
  );
};
