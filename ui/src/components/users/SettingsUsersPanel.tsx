import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Alert,
  Anchor,
  Avatar,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Menu,
  Modal,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  ThemeIcon,
} from "@mantine/core";
import {
  IconCalendarEvent,
  IconBrandWhatsapp,
  IconDotsVertical,
  IconEdit,
  IconMail,
  IconPlus,
  IconPower,
  IconSearch,
  IconTrash,
  IconUsers,
} from "@tabler/icons-react";
import dayjs from "dayjs";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { createUser, deleteUser, fetchUsers, updateUser } from "../../actions/userActions";
import { fetchUserTypes } from "../../actions/userTypeActions";
import type { User } from "../../types/users/User";
import type { UserType } from "../../types/userTypes/UserType";
import { removeEmptyKeys } from "../../utils/removeEmptyKeys";
import { getChangedValues } from "../../utils/getChangedValues";
import { useModuleAccess } from "../../hooks/useModuleAccess";
import { useCerebroBootstrap } from "../../api/cerebro";

const MODULE_SLUG = "user-directory";

type StatusFilter = "all" | "active" | "inactive";
type EditorMode = "create" | "edit";
type SortField = "createdAt" | "arrivalDate" | "departureDate" | "updatedAt";

type UserFormState = {
  username: string;
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  phone: string;
  whatsappHandle: string;
  arrivalDate: string;
  departureDate: string;
  userTypeId: string | null;
  status: boolean;
};

const INITIAL_FORM_STATE: UserFormState = {
  username: "",
  firstName: "",
  lastName: "",
  email: "",
  password: "",
  phone: "",
  whatsappHandle: "",
  arrivalDate: "",
  departureDate: "",
  userTypeId: null,
  status: true,
};

const coerceUserPayload = (payload: Partial<User>) => {
  const next: Partial<User> = { ...payload };
  if (next.userTypeId !== undefined && next.userTypeId !== null) {
    next.userTypeId = Number(next.userTypeId);
  }
  if (next.status !== undefined && next.status !== null) {
    next.status = Boolean(next.status);
  }
  return next;
};

const extractErrorMessage = (error: unknown): string => {
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object") {
    const maybeResponse = (error as { response?: { data?: unknown } }).response;
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
      if (Array.isArray((payload as { errors?: unknown[] }).errors)) {
        const firstError = (payload as { errors?: Array<{ msg?: string; message?: string }> }).errors?.[0];
        if (firstError?.msg) {
          return firstError.msg;
        }
        if (firstError?.message) {
          return firstError.message;
        }
      }
    }
    if ("message" in error && typeof (error as { message?: unknown }).message === "string") {
      return (error as { message: string }).message;
    }
  }
  return "Unexpected error occurred";
};

const normalizeText = (value?: string | null): string => (value ?? "").trim();

const getUserDisplayName = (user: Partial<User>): string => {
  const full = `${normalizeText(user.firstName)} ${normalizeText(user.lastName)}`.trim();
  if (full) {
    return full;
  }
  const username = normalizeText(user.username);
  if (username) {
    return username;
  }
  return user.id ? `User #${user.id}` : "Unnamed user";
};

const getInitials = (user: Partial<User>): string => {
  const first = normalizeText(user.firstName);
  const last = normalizeText(user.lastName);
  const initials = `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
  if (initials.trim()) {
    return initials;
  }
  const username = normalizeText(user.username);
  return username ? username.slice(0, 2).toUpperCase() : "U";
};

const avatarColorFromUserId = (userId?: number): string => {
  if (!userId || !Number.isFinite(userId)) {
    return "gray";
  }
  const palette = ["indigo", "teal", "orange", "grape", "blue", "lime", "pink", "cyan"];
  return palette[Math.abs(userId) % palette.length] ?? "gray";
};

const mapUserToFormState = (user?: Partial<User> | null): UserFormState => {
  const asDateInput = (value?: string | null): string => {
    if (!value) {
      return "";
    }
    const parsed = dayjs(value);
    return parsed.isValid() ? parsed.format("YYYY-MM-DD") : String(value).slice(0, 10);
  };

  if (!user) {
    return { ...INITIAL_FORM_STATE };
  }
  return {
    username: normalizeText(user.username),
    firstName: normalizeText(user.firstName),
    lastName: normalizeText(user.lastName),
    email: normalizeText(user.email),
    password: "",
    phone: normalizeText(user.phone ?? ""),
    whatsappHandle: normalizeText(user.whatsappHandle ?? ""),
    arrivalDate: asDateInput(user.arrivalDate ?? null),
    departureDate: asDateInput(user.departureDate ?? null),
    userTypeId: typeof user.userTypeId === "number" ? String(user.userTypeId) : null,
    status: Boolean(user.status),
  };
};

const userNeedsApproval = (user: Partial<User>): boolean =>
  Boolean(user.status) && !(typeof user.userTypeId === "number" && Number.isFinite(user.userTypeId));

const buildWhatsappLink = (raw?: string | null): { label: string; href: string } | null => {
  const normalized = (raw ?? "").trim();
  if (!normalized) {
    return null;
  }
  const cleaned = normalized.replace(/[^\d+]/g, "");
  if (!cleaned) {
    return null;
  }
  const prefixed = cleaned.startsWith("00") ? `+${cleaned.slice(2)}` : cleaned;
  const withAreaCode = prefixed.startsWith("+") ? prefixed : `+${prefixed}`;
  const href = `https://wa.me/${withAreaCode.replace(/^\+/, "")}`;
  return {
    label: withAreaCode,
    href,
  };
};

const formatDisplayDate = (value?: string | null): string | null => {
  if (!value) {
    return null;
  }
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format("YYYY-MM-DD") : null;
};

const getUserSortTimestamp = (user: Partial<User>, sortField: SortField): number | null => {
  const value = user[sortField];
  if (!value) {
    return null;
  }
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.valueOf() : null;
};

const SORT_FIELD_OPTIONS: Array<{ value: SortField; label: string }> = [
  { value: "createdAt", label: "Creation date" },
  { value: "arrivalDate", label: "Arrival date" },
  { value: "departureDate", label: "Departure date" },
  { value: "updatedAt", label: "Update date" },
];

const extractCreatedUserId = (payload: unknown): number | null => {
  if (Array.isArray(payload) && payload.length > 0) {
    const first = payload[0] as { id?: unknown };
    return typeof first?.id === "number" ? first.id : null;
  }
  if (payload && typeof payload === "object") {
    const maybe = payload as { id?: unknown };
    return typeof maybe.id === "number" ? maybe.id : null;
  }
  return null;
};

const SettingsUsersPanel = () => {
  const dispatch = useAppDispatch();
  const usersState = useAppSelector((state) => state.users[0]);
  const userTypesState = useAppSelector((state) => state.userTypes[0]);
  const loggedUserId = useAppSelector((state) => state.session.loggedUserId);
  const moduleAccess = useModuleAccess(MODULE_SLUG);
  const cerebroBootstrapQuery = useCerebroBootstrap();

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [roleFilter, setRoleFilter] = useState<string | null>("all");
  const [sortField, setSortField] = useState<SortField>("arrivalDate");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>("create");
  const [selectedUser, setSelectedUser] = useState<Partial<User> | null>(null);
  const [formState, setFormState] = useState<UserFormState>(INITIAL_FORM_STATE);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [rowActionUserId, setRowActionUserId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Partial<User> | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [pageFeedback, setPageFeedback] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  useEffect(() => {
    dispatch(fetchUsers());
  }, [dispatch]);

  useEffect(() => {
    if (!userTypesState.loading && (userTypesState.data[0]?.data ?? []).length === 0) {
      dispatch(fetchUserTypes());
    }
  }, [dispatch, userTypesState.data, userTypesState.loading]);

  const users = useMemo<Partial<User>[]>(() => (usersState.data[0]?.data ?? []) as Partial<User>[], [usersState.data]);
  const userTypes = useMemo<Partial<UserType>[]>(
    () => (userTypesState.data[0]?.data ?? []) as Partial<UserType>[],
    [userTypesState.data],
  );

  const userTypeLabelById = useMemo(() => {
    const map = new Map<number, string>();
    userTypes.forEach((typeRecord) => {
      if (typeof typeRecord.id === "number") {
        map.set(typeRecord.id, typeRecord.name ?? `Role #${typeRecord.id}`);
      }
    });
    return map;
  }, [userTypes]);

  const roleOptions = useMemo(
    () => [
      { value: "all", label: "All roles" },
      { value: "needs-approval", label: "Needs approval" },
      ...Array.from(userTypeLabelById.entries())
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([id, label]) => ({ value: String(id), label })),
    ],
    [userTypeLabelById],
  );

  const filteredUsers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return users
      .filter((user) => {
        const isActive = Boolean(user.status);
        if (statusFilter === "active" && !isActive) {
          return false;
        }
        if (statusFilter === "inactive" && isActive) {
          return false;
        }
        if (roleFilter && roleFilter !== "all") {
          if (roleFilter === "needs-approval") {
            if (!userNeedsApproval(user)) {
              return false;
            }
          } else if (String(user.userTypeId ?? "") !== roleFilter) {
            return false;
          }
        }
        if (!query) {
          return true;
        }
        const haystack = [
          getUserDisplayName(user),
          normalizeText(user.username),
          normalizeText(user.email),
          normalizeText(user.phone),
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(query);
      })
      .sort((a, b) => {
        const aTimestamp = getUserSortTimestamp(a, sortField);
        const bTimestamp = getUserSortTimestamp(b, sortField);
        if (aTimestamp !== null && bTimestamp !== null && aTimestamp !== bTimestamp) {
          return bTimestamp - aTimestamp;
        }
        if (aTimestamp === null && bTimestamp !== null) {
          return 1;
        }
        if (aTimestamp !== null && bTimestamp === null) {
          return -1;
        }

        const approvalDiff = Number(userNeedsApproval(b)) - Number(userNeedsApproval(a));
        if (approvalDiff !== 0) {
          return approvalDiff;
        }
        const activeDiff = Number(Boolean(b.status)) - Number(Boolean(a.status));
        if (activeDiff !== 0) {
          return activeDiff;
        }
        return getUserDisplayName(a).localeCompare(getUserDisplayName(b));
      });
  }, [users, searchQuery, statusFilter, roleFilter, sortField]);

  const activeUsers = useMemo(() => users.filter((user) => Boolean(user.status)).length, [users]);
  const inactiveUsers = users.length - activeUsers;
  const pendingApprovalUsers = useMemo(() => users.filter((user) => userNeedsApproval(user)).length, [users]);
  const roleOnboardingSummary = useMemo(() => {
    const roleId = formState.userTypeId ? Number(formState.userTypeId) : NaN;
    if (!Number.isFinite(roleId) || !cerebroBootstrapQuery.data) {
      return null;
    }

    const appliesToRole = (targetUserTypeIds?: number[]) =>
      !targetUserTypeIds || targetUserTypeIds.length === 0 || targetUserTypeIds.includes(roleId);

    const policies = cerebroBootstrapQuery.data.entries.filter(
      (entry) => entry.requiresAcknowledgement && appliesToRole(entry.targetUserTypeIds),
    );
    const quizzes = cerebroBootstrapQuery.data.quizzes.filter((quiz) =>
      appliesToRole(quiz.targetUserTypeIds),
    );

    if (policies.length === 0 && quizzes.length === 0) {
      return null;
    }

    return {
      policies,
      quizzes,
    };
  }, [formState.userTypeId, cerebroBootstrapQuery.data]);

  const resetEditor = () => {
    setEditorOpen(false);
    setEditorMode("create");
    setSelectedUser(null);
    setFormState({ ...INITIAL_FORM_STATE });
    setEditorError(null);
  };

  const openCreateEditor = () => {
    setEditorMode("create");
    setSelectedUser(null);
    setFormState({ ...INITIAL_FORM_STATE });
    setEditorError(null);
    setEditorOpen(true);
  };

  const openEditEditor = (user: Partial<User>) => {
    setEditorMode("edit");
    setSelectedUser(user);
    setFormState(mapUserToFormState(user));
    setEditorError(null);
    setEditorOpen(true);
  };

  const refreshUsers = async () => {
    await dispatch(fetchUsers());
  };

  const handleSubmitEditor = async () => {
    if (!moduleAccess.canCreate && editorMode === "create") {
      return;
    }
    if (!moduleAccess.canUpdate && editorMode === "edit") {
      return;
    }

    const username = formState.username.trim();
    const email = formState.email.trim();
    const password = formState.password.trim();

    if (!username) {
      setEditorError("Username is required.");
      return;
    }
    if (!email) {
      setEditorError("Email is required.");
      return;
    }
    if (editorMode === "create" && password.length < 8) {
      setEditorError("Password must be at least 8 characters.");
      return;
    }

    const basePayload: Partial<User> = {
      username,
      firstName: formState.firstName.trim(),
      lastName: formState.lastName.trim(),
      email,
      phone: formState.phone.trim() || null,
      whatsappHandle: formState.whatsappHandle.trim() || null,
      arrivalDate: formState.arrivalDate.trim() || null,
      departureDate: formState.departureDate.trim() || null,
      userTypeId: formState.userTypeId ? Number(formState.userTypeId) : undefined,
      status: formState.status,
    };
    if (password) {
      basePayload.password = password;
    }

    setSubmitLoading(true);
    setEditorError(null);
    setPageFeedback(null);
    setPageError(null);

    try {
      if (editorMode === "create") {
        const createPayload = removeEmptyKeys(coerceUserPayload(basePayload), loggedUserId);
        const createResult = await dispatch(createUser(createPayload)).unwrap();
        const createdUserId = extractCreatedUserId(createResult);
        const createFollowUp: Partial<User> = {};
        if (basePayload.userTypeId !== undefined) {
          createFollowUp.userTypeId = basePayload.userTypeId;
        }
        if (basePayload.status === false) {
          createFollowUp.status = false;
        }
        if (createdUserId && Object.keys(createFollowUp).length > 0) {
          const followUpPayload = removeEmptyKeys(coerceUserPayload(createFollowUp), loggedUserId);
          await dispatch(updateUser({ userId: createdUserId, userData: followUpPayload })).unwrap();
        }
        setPageFeedback("User created successfully.");
      } else {
        if (typeof selectedUser?.id !== "number") {
          setEditorError("Missing user reference.");
          return;
        }
        const delta = getChangedValues(
          selectedUser,
          coerceUserPayload(basePayload),
          loggedUserId,
        );
        delete (delta as { id?: unknown }).id;
        if (Object.keys(delta).length === 0) {
          setPageFeedback("No changes to save.");
          resetEditor();
          return;
        }
        const payload = removeEmptyKeys(delta, loggedUserId);
        await dispatch(updateUser({ userId: selectedUser.id, userData: payload })).unwrap();
        setPageFeedback("User updated successfully.");
      }
      await refreshUsers();
      resetEditor();
    } catch (error) {
      setEditorError(extractErrorMessage(error));
    } finally {
      setSubmitLoading(false);
    }
  };

  const handleToggleUserStatus = async (user: Partial<User>) => {
    if (!moduleAccess.canUpdate || typeof user.id !== "number") {
      return;
    }
    setRowActionUserId(user.id);
    setPageFeedback(null);
    setPageError(null);
    try {
      const delta = getChangedValues(
        user,
        coerceUserPayload({ status: !Boolean(user.status) }),
        loggedUserId,
      );
      const payload = removeEmptyKeys(delta, loggedUserId);
      await dispatch(updateUser({ userId: user.id, userData: payload })).unwrap();
      await refreshUsers();
      setPageFeedback(`User ${Boolean(user.status) ? "deactivated" : "activated"} successfully.`);
    } catch (error) {
      setPageError(extractErrorMessage(error));
    } finally {
      setRowActionUserId(null);
    }
  };

  const handleDeleteUser = async () => {
    if (!moduleAccess.canDelete || typeof deleteTarget?.id !== "number") {
      return;
    }
    setRowActionUserId(deleteTarget.id);
    setPageFeedback(null);
    setPageError(null);
    try {
      await dispatch(deleteUser(deleteTarget.id)).unwrap();
      await refreshUsers();
      setPageFeedback("User deleted successfully.");
      setDeleteTarget(null);
    } catch (error) {
      setPageError(extractErrorMessage(error));
    } finally {
      setRowActionUserId(null);
    }
  };

  return (
    <Stack gap="lg">
      <Card withBorder radius="md" p="lg">
        <Group justify="space-between" align="flex-start" wrap="wrap">
          <Stack gap={4}>
            <Group gap="xs">
              <ThemeIcon variant="light" color="orange" radius="xl">
                <IconUsers size={16} />
              </ThemeIcon>
              <Text fw={700}>Users Panel</Text>
            </Group>
            <Text size="sm" c="dimmed">
              Manage user access, role assignment, and account status from one place.
            </Text>
          </Stack>
          <Group gap="sm">
            <Badge size="lg" variant="light" color="blue">
              Total: {users.length}
            </Badge>
            <Badge size="lg" variant="light" color="green">
              Active: {activeUsers}
            </Badge>
            <Badge size="lg" variant="light" color="gray">
              Inactive: {inactiveUsers}
            </Badge>
            <Badge size="lg" variant="light" color="orange">
              Needs approval: {pendingApprovalUsers}
            </Badge>
            <Button
              leftSection={<IconPlus size={16} />}
              onClick={openCreateEditor}
              disabled={!moduleAccess.canCreate || moduleAccess.loading}
            >
              Add user
            </Button>
          </Group>
        </Group>
      </Card>

      {moduleAccess.ready && !moduleAccess.canView ? (
        <Alert color="red" title="Access denied">
          You do not have permission to view users in this module.
        </Alert>
      ) : null}

      {pageFeedback ? (
        <Alert color="green" title="Success">
          {pageFeedback}
        </Alert>
      ) : null}

      {pageError ? (
        <Alert color="red" title="Action failed">
          {pageError}
        </Alert>
      ) : null}

      {usersState.error ? (
        <Alert color="red" title="Failed to load users">
          {usersState.error}
        </Alert>
      ) : null}

      <Card withBorder radius="md" p="lg">
        <SimpleGrid cols={{ base: 1, md: 4 }} spacing="sm">
          <TextInput
            label="Search"
            placeholder="Name, username, email or phone"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.currentTarget.value)}
            leftSection={<IconSearch size={16} />}
          />
          <Select
            label="Role"
            data={roleOptions}
            value={roleFilter}
            onChange={setRoleFilter}
            allowDeselect={false}
          />
          <Select
            label="Sort by"
            data={SORT_FIELD_OPTIONS}
            value={sortField}
            onChange={(value) => setSortField((value as SortField) ?? "updatedAt")}
            allowDeselect={false}
          />
          <Stack gap={6}>
            <Text size="sm" fw={500}>
              Status
            </Text>
            <SegmentedControl
              value={statusFilter}
              onChange={(value) => setStatusFilter(value as StatusFilter)}
              data={[
                { value: "all", label: "All" },
                { value: "active", label: "Active" },
                { value: "inactive", label: "Inactive" },
              ]}
              fullWidth
            />
          </Stack>
        </SimpleGrid>
      </Card>

      {usersState.loading && users.length === 0 ? (
        <Group justify="center" py="xl">
          <Loader size="sm" />
          <Text size="sm" c="dimmed">
            Loading users...
          </Text>
        </Group>
      ) : filteredUsers.length === 0 ? (
        <Card withBorder radius="md" p="xl">
          <Text ta="center" c="dimmed">
            No users match the current filters.
          </Text>
        </Card>
      ) : (
        <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }} spacing="md">
          {filteredUsers.map((user) => {
            const needsApproval = userNeedsApproval(user);
            const whatsappLink = buildWhatsappLink(user.whatsappHandle || user.phone || null);
            const arrivalDate = formatDisplayDate(user.arrivalDate ?? null);
            const departureDate = formatDisplayDate(user.departureDate ?? null);
            const roleLabel =
              typeof user.userTypeId === "number"
                ? userTypeLabelById.get(user.userTypeId) ?? `Role #${user.userTypeId}`
                : "Needs approval";
            const isRowBusy = rowActionUserId === user.id;
            return (
              <Card key={user.id ?? `${user.username}-${user.email}`} withBorder radius="md" p="md">
                <Stack gap="sm">
                  <Group justify="space-between" align="flex-start" wrap="nowrap">
                    <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                      <Avatar color={avatarColorFromUserId(user.id)} radius="xl">
                        {getInitials(user)}
                      </Avatar>
                      <Stack gap={0} style={{ minWidth: 0 }}>
                        <Text fw={600} truncate>
                          {getUserDisplayName(user)}
                        </Text>
                        <Text size="xs" c="dimmed" truncate>
                          @{normalizeText(user.username) || "no-username"}
                        </Text>
                      </Stack>
                    </Group>
                    <Menu shadow="md" width={190} position="bottom-end">
                      <Menu.Target>
                        <ActionIcon variant="subtle" color="gray" disabled={isRowBusy}>
                          <IconDotsVertical size={16} />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item
                          leftSection={<IconEdit size={14} />}
                          onClick={() => openEditEditor(user)}
                          disabled={!moduleAccess.canUpdate}
                        >
                          {needsApproval ? "Approve (assign role)" : "Edit"}
                        </Menu.Item>
                        <Menu.Item
                          leftSection={<IconPower size={14} />}
                          onClick={() => handleToggleUserStatus(user)}
                          disabled={!moduleAccess.canUpdate}
                        >
                          {Boolean(user.status) ? "Deactivate" : "Activate"}
                        </Menu.Item>
                        <Menu.Divider />
                        <Menu.Item
                          color="red"
                          leftSection={<IconTrash size={14} />}
                          onClick={() => setDeleteTarget(user)}
                          disabled={!moduleAccess.canDelete}
                        >
                          Delete
                        </Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                  </Group>

                  <Group gap={6}>
                    <Badge color={Boolean(user.status) ? "green" : "gray"} variant="light">
                      {Boolean(user.status) ? "Active" : "Inactive"}
                    </Badge>
                    <Badge color={needsApproval ? "orange" : "indigo"} variant="light">
                      {roleLabel}
                    </Badge>
                  </Group>

                  <Group gap={8} wrap="nowrap">
                    <IconMail size={14} />
                    <Text size="sm" truncate>
                      {normalizeText(user.email) || "No email"}
                    </Text>
                  </Group>
                  <Group gap={8} wrap="nowrap">
                    <IconBrandWhatsapp size={14} />
                    {whatsappLink ? (
                      <Anchor size="sm" href={whatsappLink.href} target="_blank" rel="noreferrer">
                        {whatsappLink.label}
                      </Anchor>
                    ) : (
                      <Text size="sm" c="dimmed">
                        No WhatsApp
                      </Text>
                    )}
                  </Group>
                  <Group gap={8} wrap="nowrap">
                    <IconCalendarEvent size={14} />
                    <Text size="sm" c={!arrivalDate && !departureDate ? "dimmed" : undefined}>
                      {arrivalDate || departureDate
                        ? `Arrival: ${arrivalDate ?? "-"} | Departure: ${departureDate ?? "-"}`
                        : "No arrival/departure dates"}
                    </Text>
                  </Group>

                  <Text size="xs" c="dimmed">
                    Updated{" "}
                    {user.updatedAt ? dayjs(user.updatedAt).format("YYYY-MM-DD HH:mm") : "unknown"}
                  </Text>
                </Stack>
              </Card>
            );
          })}
        </SimpleGrid>
      )}

      <Modal
        opened={editorOpen}
        onClose={resetEditor}
        title={editorMode === "create" ? "Create user" : `Edit ${getUserDisplayName(selectedUser ?? {})}`}
        centered
        size="lg"
      >
        <Stack gap="md">
          {editorError ? (
            <Alert color="red" title="Unable to save user">
              {editorError}
            </Alert>
          ) : null}

          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
            <TextInput
              label="Username"
              placeholder="username"
              value={formState.username}
              onChange={(event) => setFormState((prev) => ({ ...prev, username: event.currentTarget.value }))}
              required
            />
            <TextInput
              label="Email"
              placeholder="user@email.com"
              value={formState.email}
              onChange={(event) => setFormState((prev) => ({ ...prev, email: event.currentTarget.value }))}
              required
            />
            <TextInput
              label="First name"
              placeholder="First name"
              value={formState.firstName}
              onChange={(event) => setFormState((prev) => ({ ...prev, firstName: event.currentTarget.value }))}
            />
            <TextInput
              label="Last name"
              placeholder="Last name"
              value={formState.lastName}
              onChange={(event) => setFormState((prev) => ({ ...prev, lastName: event.currentTarget.value }))}
            />
            <TextInput
              label={editorMode === "create" ? "Password" : "Password (optional)"}
              placeholder={editorMode === "create" ? "Minimum 8 characters" : "Leave empty to keep current password"}
              type="password"
              value={formState.password}
              onChange={(event) => setFormState((prev) => ({ ...prev, password: event.currentTarget.value }))}
              required={editorMode === "create"}
            />
            <TextInput
              label="WhatsApp"
              placeholder="+48502484066"
              value={formState.whatsappHandle}
              onChange={(event) => setFormState((prev) => ({ ...prev, whatsappHandle: event.currentTarget.value }))}
            />
            <TextInput
              label="Arrival date"
              type="date"
              value={formState.arrivalDate}
              onChange={(event) => setFormState((prev) => ({ ...prev, arrivalDate: event.currentTarget.value }))}
            />
            <TextInput
              label="Departure date"
              type="date"
              value={formState.departureDate}
              onChange={(event) => setFormState((prev) => ({ ...prev, departureDate: event.currentTarget.value }))}
            />
            <Select
              label="Role"
              placeholder="Select role"
              data={roleOptions.filter((option) => option.value !== "all" && option.value !== "needs-approval")}
              value={formState.userTypeId}
              onChange={(value) => setFormState((prev) => ({ ...prev, userTypeId: value }))}
              searchable
              clearable
            />
            {roleOnboardingSummary ? (
              <Alert color="blue" variant="light" style={{ gridColumn: "1 / -1" }}>
                {`Cerebro onboarding for this role: ${roleOnboardingSummary.policies.length} policy acknowledgement(s) and ${roleOnboardingSummary.quizzes.length} quiz(zes).`}
                {roleOnboardingSummary.policies.length > 0 ? (
                  <Text size="sm" mt={6}>
                    Policies: {roleOnboardingSummary.policies.map((item) => item.title).slice(0, 3).join(", ")}
                  </Text>
                ) : null}
                {roleOnboardingSummary.quizzes.length > 0 ? (
                  <Text size="sm" mt={4}>
                    Quizzes: {roleOnboardingSummary.quizzes.map((item) => item.title).slice(0, 3).join(", ")}
                  </Text>
                ) : null}
              </Alert>
            ) : null}
            <Switch
              label="Active account"
              checked={formState.status}
              onChange={(event) => setFormState((prev) => ({ ...prev, status: event.currentTarget.checked }))}
              mt="xl"
            />
          </SimpleGrid>

          <Group justify="flex-end">
            <Button variant="default" onClick={resetEditor} disabled={submitLoading}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmitEditor}
              loading={submitLoading}
              disabled={
                submitLoading ||
                (editorMode === "create" ? !moduleAccess.canCreate : !moduleAccess.canUpdate)
              }
            >
              {editorMode === "create" ? "Create user" : "Save changes"}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Delete user"
        centered
      >
        <Stack gap="md">
          <Text size="sm">
            Delete{" "}
            <Text span fw={600}>
              {getUserDisplayName(deleteTarget ?? {})}
            </Text>
            ? This action cannot be undone.
          </Text>
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => setDeleteTarget(null)}
              disabled={rowActionUserId === (deleteTarget?.id ?? null)}
            >
              Cancel
            </Button>
            <Button
              color="red"
              onClick={handleDeleteUser}
              loading={rowActionUserId === (deleteTarget?.id ?? null)}
              disabled={!moduleAccess.canDelete}
            >
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
};

export default SettingsUsersPanel;
