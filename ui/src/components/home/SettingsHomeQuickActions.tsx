import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Loader,
  MultiSelect,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  ThemeIcon,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconBolt,
  IconDeviceFloppy,
  IconRefresh,
  IconShieldCheck,
  IconUsersGroup,
} from "@tabler/icons-react";
import {
  useHomeQuickActionConfiguration,
  useUpdateHomeQuickActionConfiguration,
  type HomeQuickActionAudienceUser,
  type HomeQuickActionConfigDto,
} from "../../api/homeQuickActions";
import { useModuleAccess } from "../../hooks/useModuleAccess";
import { HOME_EXPERIENCE_CONFIGURABLE_ITEMS } from "./homeExperienceConfigRegistry";

const defaultConfiguration = (actionId: string): HomeQuickActionConfigDto => ({
  actionId,
  enabled: true,
  audienceMode: "all",
  allowUserIds: [],
  denyUserIds: [],
  userTypeIds: [],
  shiftRoleIds: [],
  staffProfileTypes: [],
});

const normalizeConfiguration = (config: HomeQuickActionConfigDto): HomeQuickActionConfigDto => ({
  ...config,
  allowUserIds: [...new Set(config.allowUserIds)].sort((a, b) => a - b),
  denyUserIds: [...new Set(config.denyUserIds)].sort((a, b) => a - b),
  userTypeIds: [...new Set(config.userTypeIds)].sort((a, b) => a - b),
  shiftRoleIds: [...new Set(config.shiftRoleIds)].sort((a, b) => a - b),
  staffProfileTypes: [...new Set(config.staffProfileTypes)].sort(),
});

const mergeRegistryConfigurations = (
  configurations: HomeQuickActionConfigDto[],
): Record<string, HomeQuickActionConfigDto> => {
  const saved = new Map(configurations.map((config) => [config.actionId, config]));
  return Object.fromEntries(
    HOME_EXPERIENCE_CONFIGURABLE_ITEMS.map((item) => [
      item.id,
      normalizeConfiguration(saved.get(item.id) ?? defaultConfiguration(item.id)),
    ]),
  );
};

const serializeDrafts = (drafts: Record<string, HomeQuickActionConfigDto>): string =>
  JSON.stringify(HOME_EXPERIENCE_CONFIGURABLE_ITEMS.map(
    (item) => normalizeConfiguration(drafts[item.id]),
  ));

const numberValues = (values: string[]): number[] =>
  values.map(Number).filter((value) => Number.isInteger(value) && value > 0);

const matchesDraft = (
  user: HomeQuickActionAudienceUser,
  config: HomeQuickActionConfigDto,
): boolean => {
  if (!config.enabled || config.denyUserIds.includes(user.id)) {
    return false;
  }
  if (config.audienceMode === "all" || config.allowUserIds.includes(user.id)) {
    return true;
  }
  return (
    (user.userTypeId != null && config.userTypeIds.includes(user.userTypeId))
    || user.shiftRoleIds.some((roleId) => config.shiftRoleIds.includes(roleId))
    || (user.staffProfileType != null && config.staffProfileTypes.includes(user.staffProfileType))
  );
};

const SettingsHomeQuickActions = () => {
  const moduleAccess = useModuleAccess("settings-home");
  const canView = moduleAccess.ready && moduleAccess.canView;
  const canUpdate = moduleAccess.ready && moduleAccess.canUpdate;
  const configurationQuery = useHomeQuickActionConfiguration({ enabled: canView });
  const updateMutation = useUpdateHomeQuickActionConfiguration();
  const [drafts, setDrafts] = useState<Record<string, HomeQuickActionConfigDto>>({});
  const [baseline, setBaseline] = useState<Record<string, HomeQuickActionConfigDto>>({});
  const [showSuccess, setShowSuccess] = useState(false);
  const isDirtyRef = useRef(false);

  useEffect(() => {
    if (!configurationQuery.data || isDirtyRef.current) {
      return;
    }
    const next = mergeRegistryConfigurations(configurationQuery.data.configurations);
    setDrafts(next);
    setBaseline(next);
  }, [configurationQuery.data]);

  const options = configurationQuery.data?.options;
  const userOptions = useMemo(
    () => (options?.users ?? []).map((user) => ({
      value: user.id.toString(),
      label: `${user.firstName} ${user.lastName}`.trim() || user.email || `User ${user.id}`,
      description: user.email,
    })),
    [options?.users],
  );
  const userTypeOptions = useMemo(
    () => (options?.userTypes ?? []).map((userType) => ({
      value: userType.id.toString(),
      label: `${userType.name}${userType.active ? "" : " (inactive)"}`,
    })),
    [options?.userTypes],
  );
  const shiftRoleOptions = useMemo(
    () => (options?.shiftRoles ?? []).map((role) => ({
      value: role.id.toString(),
      label: role.name,
    })),
    [options?.shiftRoles],
  );

  const hasChanges = useMemo(() => {
    if (Object.keys(drafts).length === 0 || Object.keys(baseline).length === 0) {
      return false;
    }
    return serializeDrafts(drafts) !== serializeDrafts(baseline);
  }, [baseline, drafts]);

  useEffect(() => {
    isDirtyRef.current = hasChanges;
  }, [hasChanges]);

  const validationErrors = useMemo(() => {
    const errors = new Map<string, string>();
    HOME_EXPERIENCE_CONFIGURABLE_ITEMS.forEach((item) => {
      const config = drafts[item.id];
      if (!config) {
        return;
      }
      const denied = new Set(config.denyUserIds);
      if (config.allowUserIds.some((userId) => denied.has(userId))) {
        errors.set(item.id, "The same person cannot be both always shown and always hidden.");
        return;
      }
      const targetCount = config.allowUserIds.length
        + config.userTypeIds.length
        + config.shiftRoleIds.length
        + config.staffProfileTypes.length;
      if (config.enabled && config.audienceMode === "targeted" && targetCount === 0) {
        errors.set(item.id, "Choose at least one audience for this targeted homepage item.");
      }
    });
    return errors;
  }, [drafts]);

  const updateDraft = (
    actionId: string,
    patch: Partial<HomeQuickActionConfigDto>,
  ) => {
    if (!canUpdate) {
      return;
    }
    isDirtyRef.current = true;
    setShowSuccess(false);
    setDrafts((current) => ({
      ...current,
      [actionId]: normalizeConfiguration({
        ...(current[actionId] ?? defaultConfiguration(actionId)),
        ...patch,
      }),
    }));
  };

  const handleReset = () => {
    if (!canUpdate) {
      return;
    }
    isDirtyRef.current = false;
    setDrafts(baseline);
    setShowSuccess(false);
  };

  const handleSave = async () => {
    if (!canUpdate || !hasChanges || validationErrors.size > 0) {
      return;
    }
    try {
      const response = await updateMutation.mutateAsync({
        configurations: HOME_EXPERIENCE_CONFIGURABLE_ITEMS.map(
          (item) => normalizeConfiguration(drafts[item.id]),
        ),
      });
      const next = mergeRegistryConfigurations(response.configurations);
      isDirtyRef.current = false;
      setDrafts(next);
      setBaseline(next);
      setShowSuccess(true);
    } catch {
      setShowSuccess(false);
    }
  };

  if (!moduleAccess.ready) {
    return (
      <Card withBorder padding="lg" radius="md">
        <Group gap="xs">
          <Loader size="sm" />
          <Text size="sm" c="dimmed">Checking homepage settings access...</Text>
        </Group>
      </Card>
    );
  }

  if (!moduleAccess.canView) {
    return null;
  }

  return (
    <Card withBorder padding="lg" radius="md">
      <Stack gap="lg">
        <Group justify="space-between" align="flex-start" wrap="wrap">
          <Group gap="sm" align="flex-start">
            <ThemeIcon variant="light" size="lg" radius="md">
              <IconBolt size={20} />
            </ThemeIcon>
            <Box>
              <Text fw={700}>Homepage content</Text>
              <Text size="sm" c="dimmed" maw={760}>
                Decide who sees homepage sections and shortcuts using current user types, shift
                roles, staff profiles, or individual exceptions.
              </Text>
            </Box>
          </Group>
          <Badge variant="light" color="blue" leftSection={<IconShieldCheck size={12} />}>
            Permissions still apply
          </Badge>
        </Group>

        <Alert color="blue" variant="light" icon={<IconShieldCheck size={17} />}>
          Audience rules can hide homepage content, but they never grant finance, page, or action
          permissions. A person must still have the required access.
        </Alert>

        {!canUpdate && (
          <Alert color="yellow" variant="light" icon={<IconShieldCheck size={17} />}>
            You can review these homepage audiences, but you do not have permission to change them.
          </Alert>
        )}

        {configurationQuery.isLoading && (
          <Group gap="xs">
            <Loader size="sm" />
            <Text size="sm" c="dimmed">Loading homepage configuration...</Text>
          </Group>
        )}
        {configurationQuery.isError && (
          <Alert color="red" icon={<IconAlertCircle size={16} />}>
            {configurationQuery.error.response?.data?.message
              ?? "Unable to load homepage configuration."}
          </Alert>
        )}

        {configurationQuery.isSuccess && HOME_EXPERIENCE_CONFIGURABLE_ITEMS.map((item) => {
          const config = drafts[item.id];
          if (!config) {
            return null;
          }
          const matchedUsers = (options?.users ?? []).filter((user) => matchesDraft(user, config)).length;
          const error = validationErrors.get(item.id);
          const headingId = `home-experience-${item.id}-title`;
          return (
            <Card
              key={item.id}
              component="section"
              aria-labelledby={headingId}
              withBorder
              radius="md"
              padding="md"
              bg="var(--mantine-color-gray-0)"
            >
              <Stack gap="md">
                <Group justify="space-between" align="flex-start" wrap="wrap">
                  <Box>
                    <Group gap="xs">
                      <Text id={headingId} component="h3" fw={700} m={0}>{item.label}</Text>
                      <Badge
                        size="sm"
                        variant={item.kind === "section" ? "light" : "outline"}
                        color={item.kind === "section" ? "violet" : "blue"}
                      >
                        {item.kind === "section" ? "Homepage section" : item.group}
                      </Badge>
                    </Group>
                    <Text size="sm" c="dimmed" mt={4}>{item.description}</Text>
                  </Box>
                  <Switch
                    aria-label={`${item.label}: enabled`}
                    checked={config.enabled}
                    onChange={(event) => updateDraft(item.id, { enabled: event.currentTarget.checked })}
                    label={config.enabled ? "Enabled" : "Disabled"}
                    disabled={!canUpdate || updateMutation.isPending}
                  />
                </Group>

                <Stack gap={6}>
                  <Text size="sm" fw={600}>Who should see it?</Text>
                  <SegmentedControl
                    aria-label={`${item.label}: audience mode`}
                    fullWidth
                    value={config.audienceMode}
                    onChange={(value) => updateDraft(item.id, {
                      audienceMode: value === "targeted" ? "targeted" : "all",
                    })}
                    disabled={!canUpdate || !config.enabled || updateMutation.isPending}
                    data={[
                      { label: "All authorized users", value: "all" },
                      { label: "Targeted audience", value: "targeted" },
                    ]}
                  />
                </Stack>

                {config.audienceMode === "targeted" && (
                  <>
                    <Text size="xs" c="dimmed">
                      A person is included when they match any selected audience below.
                    </Text>
                    <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
                      <MultiSelect
                        aria-label={`${item.label}: user types`}
                        label="User types"
                        placeholder="Choose user types"
                        data={userTypeOptions}
                        searchable
                        clearable
                        value={config.userTypeIds.map(String)}
                        onChange={(values) => updateDraft(item.id, { userTypeIds: numberValues(values) })}
                        disabled={!canUpdate || !config.enabled || updateMutation.isPending}
                      />
                      <MultiSelect
                        aria-label={`${item.label}: shift roles`}
                        label="Shift roles"
                        placeholder="Choose shift roles"
                        data={shiftRoleOptions}
                        searchable
                        clearable
                        value={config.shiftRoleIds.map(String)}
                        onChange={(values) => updateDraft(item.id, { shiftRoleIds: numberValues(values) })}
                        disabled={!canUpdate || !config.enabled || updateMutation.isPending}
                      />
                      <MultiSelect
                        aria-label={`${item.label}: staff profile types`}
                        label="Staff profile types"
                        placeholder="Choose staff profile types"
                        data={options?.staffProfileTypes ?? []}
                        searchable
                        clearable
                        value={config.staffProfileTypes}
                        onChange={(values) => updateDraft(item.id, { staffProfileTypes: values })}
                        disabled={!canUpdate || !config.enabled || updateMutation.isPending}
                      />
                      <MultiSelect
                        aria-label={`${item.label}: always show for specific users`}
                        label="Always show for specific users"
                        placeholder="Choose individual users"
                        data={userOptions}
                        searchable
                        clearable
                        value={config.allowUserIds.map(String)}
                        onChange={(values) => updateDraft(item.id, { allowUserIds: numberValues(values) })}
                        disabled={!canUpdate || !config.enabled || updateMutation.isPending}
                      />
                    </SimpleGrid>
                  </>
                )}

                <MultiSelect
                  aria-label={`${item.label}: always hide for specific users`}
                  label="Always hide for specific users"
                  description="This exclusion wins even when the person matches another audience."
                  placeholder="Choose individual users"
                  data={userOptions}
                  searchable
                  clearable
                  value={config.denyUserIds.map(String)}
                  onChange={(values) => updateDraft(item.id, { denyUserIds: numberValues(values) })}
                  disabled={!canUpdate || !config.enabled || updateMutation.isPending}
                />

                <Group gap="xs">
                  <IconUsersGroup size={16} />
                  <Text size="sm" fw={600}>
                    {config.enabled ? `${matchedUsers} of ${options?.users.length ?? 0}` : "0"} active users match
                  </Text>
                  <Text size="xs" c="dimmed">before page and module permissions</Text>
                </Group>

                {error && (
                  <Alert color="yellow" icon={<IconAlertCircle size={16} />}>{error}</Alert>
                )}
              </Stack>
            </Card>
          );
        })}

        {updateMutation.isError && (
          <Alert color="red" icon={<IconAlertCircle size={16} />}>
            {updateMutation.error.response?.data?.message
              ?? "Failed to save homepage configuration."}
          </Alert>
        )}
        {showSuccess && (
          <Alert color="green" icon={<IconShieldCheck size={16} />}>
            Homepage audiences saved.
          </Alert>
        )}

        <Group justify="flex-end">
          <Button
            variant="light"
            leftSection={<IconRefresh size={16} />}
            onClick={handleReset}
            disabled={!canUpdate || !hasChanges || updateMutation.isPending}
          >
            Reset
          </Button>
          <Button
            leftSection={<IconDeviceFloppy size={16} />}
            onClick={handleSave}
            disabled={!canUpdate || !hasChanges || validationErrors.size > 0 || updateMutation.isPending}
            loading={updateMutation.isPending}
          >
            Save homepage rules
          </Button>
        </Group>
      </Stack>
    </Card>
  );
};

export default SettingsHomeQuickActions;
