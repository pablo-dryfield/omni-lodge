import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Group,
  Loader,
  MultiSelect,
  SegmentedControl,
  Select,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconAlertCircle, IconDeviceFloppy, IconLayoutDashboard, IconRefresh } from "@tabler/icons-react";
import { PageAccessGuard } from "../../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../../constants/pageSlugs";
import { useActiveUsers } from "../../api/users";
import {
  useReportDashboards,
  useHomeDashboardPreferenceAdmin,
  useUpdateHomeDashboardPreferenceAdmin,
  type HomeDashboardPreferenceDto,
  type UpdateHomeDashboardPreferencePayload,
} from "../../api/reports";

const PAGE_SLUG = PAGE_SLUGS.settingsHomeExperience;
const MAX_PINNED = 12;
const HOME_PREFERENCE_QUERY_KEY = ["reports", "home-preference"] as const;

const sanitizeDashboardIds = (value: string[]): string[] => {
  const unique = new Set<string>();
  value.forEach((entry) => {
    if (typeof entry !== "string") {
      return;
    }
    const trimmed = entry.trim();
    if (trimmed.length === 0) {
      return;
    }
    unique.add(trimmed);
  });
  return Array.from(unique).slice(0, MAX_PINNED);
};

const applyPreferencePatch = (
  current: HomeDashboardPreferenceDto,
  patch: UpdateHomeDashboardPreferencePayload,
): HomeDashboardPreferenceDto => {
  const next: HomeDashboardPreferenceDto = {
    viewMode: current.viewMode,
    savedDashboardIds: [...current.savedDashboardIds],
    activeDashboardId: current.activeDashboardId,
  };

  if (typeof patch.viewMode === "string") {
    const candidate = patch.viewMode === "dashboard" ? "dashboard" : "navigation";
    next.viewMode = candidate;
  }

  if (patch.savedDashboardIds !== undefined) {
    next.savedDashboardIds = sanitizeDashboardIds(patch.savedDashboardIds ?? []);
  }

  if (patch.activeDashboardId !== undefined) {
    const candidate =
      typeof patch.activeDashboardId === "string" && patch.activeDashboardId.trim().length > 0
        ? patch.activeDashboardId.trim()
        : null;
    next.activeDashboardId = candidate;
  }

  if (next.viewMode === "dashboard" && next.savedDashboardIds.length === 0) {
    next.activeDashboardId = null;
  }

  if (next.activeDashboardId && !next.savedDashboardIds.includes(next.activeDashboardId)) {
    next.activeDashboardId = null;
  }

  if (!next.activeDashboardId && next.savedDashboardIds.length > 0) {
    [next.activeDashboardId] = next.savedDashboardIds;
  }

  return next;
};

const arraysEqual = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((value, index) => value === b[index]);
};

const buildPayload = (
  previous: HomeDashboardPreferenceDto,
  next: HomeDashboardPreferenceDto,
): UpdateHomeDashboardPreferencePayload => {
  const payload: UpdateHomeDashboardPreferencePayload = {};
  if (previous.viewMode !== next.viewMode) {
    payload.viewMode = next.viewMode;
  }
  if (!arraysEqual(previous.savedDashboardIds, next.savedDashboardIds)) {
    payload.savedDashboardIds = next.savedDashboardIds;
  }
  if (previous.activeDashboardId !== next.activeDashboardId) {
    payload.activeDashboardId = next.activeDashboardId;
  }
  return payload;
};

const SettingsHomeExperience = () => {
  const queryClient = useQueryClient();
  const usersQuery = useActiveUsers();
  const dashboardsQuery = useReportDashboards({ enabled: true });
  const dashboards = useMemo(() => dashboardsQuery.data?.dashboards ?? [], [dashboardsQuery.data]);

  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [draft, setDraft] = useState<HomeDashboardPreferenceDto | null>(null);
  const [baseline, setBaseline] = useState<HomeDashboardPreferenceDto | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  const preferenceQuery = useHomeDashboardPreferenceAdmin(selectedUserId);
  const updatePreferenceMutation = useUpdateHomeDashboardPreferenceAdmin();

  useEffect(() => {
    setDraft(null);
    setBaseline(null);
    setShowSuccess(false);
  }, [selectedUserId]);

  useEffect(() => {
    if (preferenceQuery.data) {
      setDraft(preferenceQuery.data);
      setBaseline(preferenceQuery.data);
      setShowSuccess(false);
    }
  }, [preferenceQuery.data]);

  const userOptions = useMemo(
    () =>
      (usersQuery.data ?? []).map((user) => ({
        value: user.id.toString(),
        label: `${user.firstName} ${user.lastName}`.trim() || user.email || `User ${user.id}`,
        description: user.email,
      })),
    [usersQuery.data],
  );

  const dashboardOptions = useMemo(
    () =>
      dashboards.map((dashboard) => ({
        value: dashboard.id,
        label: dashboard.name ?? "Untitled dashboard",
      })),
    [dashboards],
  );

  const pinnedSummaries = useMemo(() => {
    if (!draft) {
      return [];
    }
    return draft.savedDashboardIds.map((id) => {
      const match = dashboards.find((dashboard) => dashboard.id === id);
      return {
        id,
        name: match?.name ?? "Missing dashboard",
        missing: !match,
      };
    });
  }, [dashboards, draft]);

  const pendingPayload = useMemo(() => {
    if (!baseline || !draft) {
      return null;
    }
    const payload = buildPayload(baseline, draft);
    return Object.keys(payload).length > 0 ? payload : null;
  }, [baseline, draft]);

  useEffect(() => {
    if (pendingPayload) {
      setShowSuccess(false);
    }
  }, [pendingPayload]);

  const handlePinnedDashboardsChange = (ids: string[]) => {
    if (!draft) {
      return;
    }
    setDraft(applyPreferencePatch(draft, { savedDashboardIds: ids }));
  };

  const handleActiveDashboardChange = (dashboardId: string | null) => {
    if (!draft) {
      return;
    }
    setDraft(applyPreferencePatch(draft, { activeDashboardId: dashboardId ?? null }));
  };

  const handleViewModeChange = (value: string) => {
    if (!draft) {
      return;
    }
    setDraft(applyPreferencePatch(draft, { viewMode: value === "dashboard" ? "dashboard" : "navigation" }));
  };

  const handleReset = () => {
    if (!baseline) {
      return;
    }
    setDraft(baseline);
    setShowSuccess(false);
  };

  const handleSave = async () => {
    if (!selectedUserId || !pendingPayload) {
      return;
    }
    try {
      const response = await updatePreferenceMutation.mutateAsync({
        userId: selectedUserId,
        payload: pendingPayload,
      });
      setBaseline(response);
      setDraft(response);
      setShowSuccess(true);
      await queryClient.invalidateQueries({ queryKey: [...HOME_PREFERENCE_QUERY_KEY] });
      await queryClient.invalidateQueries({
        queryKey: ["reports", "home-preference", "admin", selectedUserId],
      });
    } catch {
      setShowSuccess(false);
    }
  };

  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <Stack gap="xl">
        <Stack gap="xs">
          <Title order={3}>Home Experience</Title>
          <Text size="sm" c="dimmed">
            Choose whether each user lands on navigation tiles or a dashboard layout and which dashboards they can pin.
          </Text>
        </Stack>

        <Card withBorder padding="lg" radius="md">
          <Stack gap="md">
            <div>
              <Text fw={600}>Choose user</Text>
              <Text size="sm" c="dimmed">
                Select the user whose default Home screen you want to adjust.
              </Text>
            </div>
            {usersQuery.isError && (
              <Alert color="red" icon={<IconAlertCircle size={16} />}>
                Failed to load users. Please refresh the page.
              </Alert>
            )}
            <Select
              label="User"
              placeholder={usersQuery.isLoading ? "Loading users..." : "Select a user"}
              data={userOptions}
              value={selectedUserId ? selectedUserId.toString() : null}
              onChange={(value) => setSelectedUserId(value ? Number(value) : null)}
              searchable
              disabled={usersQuery.isLoading || usersQuery.isError}
              clearable
            />
          </Stack>
        </Card>

        <Card withBorder padding="lg" radius="md">
          <Stack gap="md">
            <div>
              <Text fw={600}>Home modules</Text>
              <Text size="sm" c="dimmed">
                Pin dashboards for the selected user and decide whether they start in dashboard or navigation mode.
              </Text>
            </div>
            {!selectedUserId && (
              <Alert color="yellow" icon={<IconAlertCircle size={16} />}>
                Select a user to configure their home experience.
              </Alert>
            )}
            {selectedUserId && preferenceQuery.isLoading && (
              <Group gap="xs">
                <Loader size="sm" />
                <Text size="sm" c="dimmed">
                  Loading preference...
                </Text>
              </Group>
            )}
            {preferenceQuery.isError && selectedUserId && (
              <Alert color="red" icon={<IconAlertCircle size={16} />}>
                Unable to load the selected user preference. Try again.
              </Alert>
            )}

            {selectedUserId && draft && (
              <Stack gap="lg">
                <Stack gap="xs">
                  <Text size="sm" c="dimmed">
                    Default view
                  </Text>
                  <SegmentedControl
                    value={draft.viewMode}
                    onChange={handleViewModeChange}
                    disabled={updatePreferenceMutation.isPending}
                    data={[
                      { label: "Navigation", value: "navigation" },
                      {
                        label: "Dashboards",
                        value: "dashboard",
                        disabled: draft.savedDashboardIds.length === 0,
                      },
                    ]}
                  />
                  {draft.savedDashboardIds.length === 0 && (
                    <Text size="xs" c="dimmed">
                      Pin at least one dashboard to enable dashboard view mode.
                    </Text>
                  )}
                </Stack>

                <Stack gap="xs">
                  <MultiSelect
                    label="Pinned dashboards"
                    placeholder={
                      dashboardsQuery.isLoading ? "Loading dashboards..." : "Select dashboards to show on Home"
                    }
                    data={dashboardOptions}
                    searchable
                    value={draft.savedDashboardIds}
                    onChange={handlePinnedDashboardsChange}
                    disabled={dashboardsQuery.isLoading || dashboardsQuery.isError}
                    maxValues={MAX_PINNED}
                  />
                  <Group justify="space-between">
                    <Text size="xs" c="dimmed">
                      Up to {MAX_PINNED} dashboards can be pinned per user.
                    </Text>
                    <Button
                      component={Link}
                      to="/reports/dashboards"
                      variant="subtle"
                      size="xs"
                      leftSection={<IconLayoutDashboard size={14} />}
                    >
                      Open dashboards workspace
                    </Button>
                  </Group>
                </Stack>

                <Select
                  label="Default dashboard"
                  placeholder="Select dashboard"
                  data={pinnedSummaries
                    .filter((summary) => !summary.missing)
                    .map((summary) => ({ value: summary.id, label: summary.name }))}
                  value={draft.activeDashboardId}
                  onChange={handleActiveDashboardChange}
                  disabled={draft.savedDashboardIds.length === 0 || updatePreferenceMutation.isPending}
                  clearable
                  description="Shown first when the user chooses dashboard mode."
                />

                <Divider />

                <Stack gap="xs">
                  <Text size="sm" fw={600}>
                    Pinned dashboards
                  </Text>
                  {pinnedSummaries.length === 0 ? (
                    <Text size="sm" c="dimmed">
                      No dashboards assigned to this user yet.
                    </Text>
                  ) : (
                    <Stack gap="xs">
                      {pinnedSummaries.map((summary) => (
                        <Group key={summary.id} justify="space-between">
                          <Box>
                            <Text fw={500}>{summary.name}</Text>
                            {summary.missing && (
                              <Text size="xs" c="red.6">
                                This dashboard no longer exists. Remove it or replace it.
                              </Text>
                            )}
                          </Box>
                          <Group gap="xs">
                            {summary.id === draft.activeDashboardId && (
                              <Badge color="blue" variant="light">
                                Default
                              </Badge>
                            )}
                            {summary.missing && (
                              <Badge color="red" variant="light">
                                Missing
                              </Badge>
                            )}
                          </Group>
                        </Group>
                      ))}
                    </Stack>
                  )}
                </Stack>

                {updatePreferenceMutation.isError && (
                  <Alert color="red" icon={<IconAlertCircle size={16} />}>
                    {updatePreferenceMutation.error?.response?.data?.message ??
                      "Failed to save preference. Please try again."}
                  </Alert>
                )}
                {showSuccess && (
                  <Alert color="green" icon={<IconAlertCircle size={16} />}>
                    Preference saved.
                  </Alert>
                )}

                <Group justify="flex-end">
                  <Button
                    variant="light"
                    leftSection={<IconRefresh size={16} />}
                    onClick={handleReset}
                    disabled={!pendingPayload || updatePreferenceMutation.isPending}
                  >
                    Reset
                  </Button>
                  <Button
                    leftSection={<IconDeviceFloppy size={16} />}
                    onClick={handleSave}
                    disabled={!pendingPayload || updatePreferenceMutation.isPending}
                    loading={updatePreferenceMutation.isPending}
                  >
                    Save changes
                  </Button>
                </Group>
              </Stack>
            )}
          </Stack>
        </Card>
      </Stack>
    </PageAccessGuard>
  );
};

export default SettingsHomeExperience;
