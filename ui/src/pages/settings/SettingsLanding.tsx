import React, { useEffect, useMemo, useState } from "react";
import {
  SimpleGrid,
  Card,
  Stack,
  Title,
  Text,
  ActionIcon,
  Alert,
  Button,
  Select,
  Modal,
  ScrollArea,
  Code,
} from "@mantine/core";
import {
  IconUsers,
  IconIdBadge,
  IconLayoutSidebar,
  IconComponents,
  IconShieldLock,
  IconAddressBook,
  IconHierarchy3,
  IconUserCog,
  IconLayoutDashboard,
  IconStars,
  IconCoin,
  IconRefresh,
  IconBolt,
  IconSettings,
  IconTools,
  IconCalendarEvent,
  IconTag,
} from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";
import { useAppSelector } from "../../store/hooks";
import { selectAllowedPageSlugs } from "../../selectors/accessControlSelectors";
import { PageAccessGuard } from "../../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../../constants/pageSlugs";
import { fetchLogFile, fetchPm2ProcessLogs, usePm2Processes, useRestartPm2Process } from "../../api/pm2";

type SettingsSection = {
  label: string;
  description: string;
  icon: React.ComponentType<{ size?: number | string }>;
  to: string;
  pageSlug: string;
};

const sections: SettingsSection[] = [
  {
    label: "Users",
    description: "Invite, deactivate, and reset access for platform members.",
    icon: IconUsers,
    to: "/settings/users",
    pageSlug: PAGE_SLUGS.settingsUsers,
  },
  {
    label: "Control Panel",
    description: "Manage dynamic configuration values and secrets.",
    icon: IconSettings,
    to: "/settings/control-panel",
    pageSlug: PAGE_SLUGS.settingsControlPanel,
  },
  {
    label: "Maintenance",
    description: "Monitor migrations, seed runs, and configuration health.",
    icon: IconTools,
    to: "/settings/maintenance",
    pageSlug: PAGE_SLUGS.settingsMaintenance,
  },
  {
    label: "Staff Profiles",
    description: "Track staff classifications and accommodation status.",
    icon: IconAddressBook,
    to: "/settings/staff-profiles",
    pageSlug: PAGE_SLUGS.settingsStaffProfiles,
  },
  {
    label: "Shift Roles",
    description: "Manage the roles available for scheduling.",
    icon: IconHierarchy3,
    to: "/settings/shift-roles",
    pageSlug: PAGE_SLUGS.settingsShiftRoles,
  },
  {
    label: "Shift Types",
    description: "Map shift types to products for counters.",
    icon: IconCalendarEvent,
    to: "/settings/shift-types",
    pageSlug: PAGE_SLUGS.settingsShiftTypes,
  },
  {
    label: "Product Aliases",
    description: "Map incoming booking labels to products.",
    icon: IconTag,
    to: "/settings/product-aliases",
    pageSlug: PAGE_SLUGS.settingsProductAliases,
  },
  {
    label: "User Shift Roles",
    description: "Assign shift roles to team members.",
    icon: IconUserCog,
    to: "/settings/user-shift-roles",
    pageSlug: PAGE_SLUGS.settingsUserShiftRoles,
  },
  {
    label: "Review Platforms",
    description: "Define and manage review platforms used across the system.",
    icon: IconStars,
    to: "/settings/review-platforms",
    pageSlug: PAGE_SLUGS.settingsReviewPlatforms,
  },
  {
    label: "Compensation Components",
    description: "Configure salary, commission, and incentive components plus assignments.",
    icon: IconCoin,
    to: "/settings/compensation-components",
    pageSlug: PAGE_SLUGS.settingsCompensationComponents,
  },
  {
    label: "Home Experience",
    description: "Assign each user to navigation or dashboard-first home modules.",
    icon: IconLayoutDashboard,
    to: "/settings/home-experience",
    pageSlug: PAGE_SLUGS.settingsHomeExperience,
  },
  {
    label: "User Types",
    description: "Define roles that bundle permissions and navigation.",
    icon: IconIdBadge,
    to: "/settings/user-types",
    pageSlug: PAGE_SLUGS.settingsUserTypes,
  },
  {
    label: "Pages",
    description: "Control the high-level navigation structure shown to users.",
    icon: IconLayoutSidebar,
    to: "/settings/pages",
    pageSlug: PAGE_SLUGS.settingsPages,
  },
  {
    label: "Modules",
    description: "Organise reusable modules and the widgets they render.",
    icon: IconComponents,
    to: "/settings/modules",
    pageSlug: PAGE_SLUGS.settingsModules,
  },
  {
    label: "Permissions",
    description: "Map user types to their page and module capabilities.",
    icon: IconShieldLock,
    to: "/settings/permissions",
    pageSlug: PAGE_SLUGS.settingsPermissions,
  },
];

const PAGE_SLUG = PAGE_SLUGS.settings;

const extractErrorMessage = (error: unknown): string => {
  if (typeof error === "object" && error !== null) {
    const maybeResponse = (error as { response?: { data?: unknown } }).response;
    if (maybeResponse?.data) {
      const { data } = maybeResponse;
      if (typeof data === "string") {
        return data;
      }
      if (Array.isArray(data) && data.length > 0) {
        const first = data[0];
        if (first && typeof first === "object" && "message" in first && typeof first.message === "string") {
          return first.message;
        }
      }
      if (typeof (data as { message?: unknown }).message === "string") {
        return (data as { message: string }).message;
      }
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unexpected error occurred";
};

const SettingsLanding = () => {
  const navigate = useNavigate();
  const allowedPageSlugs = useAppSelector(selectAllowedPageSlugs);
  const isProduction = process.env.NODE_ENV === "production";
  const [refreshing, setRefreshing] = useState(false);
  const [selectedProcessId, setSelectedProcessId] = useState<string | null>(null);
  const [restartError, setRestartError] = useState<string | null>(null);
  const [restartFeedback, setRestartFeedback] = useState<string | null>(null);
  const [logsOpened, setLogsOpened] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [logsOutput, setLogsOutput] = useState<string | null>(null);
  const logsLines = 200;
  const [logSource, setLogSource] = useState<"pm2" | "backend" | "ui">("pm2");
  const pm2ProcessesQuery = usePm2Processes({ enabled: isProduction });
  const restartPm2Process = useRestartPm2Process();

  const visibleSections = useMemo(
    () => sections.filter((section) => allowedPageSlugs.has(section.pageSlug)),
    [allowedPageSlugs],
  );

  const processOptions = useMemo(
    () =>
      (pm2ProcessesQuery.data ?? []).map((process) => ({
        value: process.id.toString(),
        label: `${process.name} (#${process.id})`,
        description: process.status,
      })),
    [pm2ProcessesQuery.data],
  );

  const selectedProcessLabel = useMemo(() => {
    if (!selectedProcessId) {
      return null;
    }
    return processOptions.find((option) => option.value === selectedProcessId)?.label ?? selectedProcessId;
  }, [processOptions, selectedProcessId]);

  useEffect(() => {
    if (selectedProcessId && !processOptions.some((option) => option.value === selectedProcessId)) {
      setSelectedProcessId(null);
    }
  }, [processOptions, selectedProcessId]);

  useEffect(() => {
    setRestartError(null);
    setRestartFeedback(null);
    setLogsError(null);
    setLogsOutput(null);
  }, [selectedProcessId]);

  const handleRefreshApp = async () => {
    if (refreshing) {
      return;
    }
    const confirmed = window.confirm(
      "This will clear cached app files and reload. Continue?",
    );
    if (!confirmed) {
      return;
    }
    setRefreshing(true);
    try {
      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(
          registrations.map(async (registration) => {
            registration.waiting?.postMessage({ type: "SKIP_WAITING" });
            await registration.unregister();
          }),
        );
      }
      if ("caches" in window) {
        const keys = await window.caches.keys();
        await Promise.all(keys.map((key) => window.caches.delete(key)));
      }
    } finally {
      window.location.reload();
    }
  };

  const handleRestartBackend = async () => {
    if (!isProduction) {
      setRestartError("PM2 controls are only available in production.");
      return;
    }
    if (!selectedProcessId) {
      setRestartError("Select a PM2 process to restart.");
      return;
    }

    const confirmed = window.confirm(
      `Restart ${selectedProcessLabel ?? "the selected PM2 process"}? This may briefly interrupt backend access.`,
    );
    if (!confirmed) {
      return;
    }

    try {
      setRestartError(null);
      setRestartFeedback(null);
      const response = await restartPm2Process.mutateAsync({ id: Number(selectedProcessId) });
      setRestartFeedback(response.message ?? "Restart request sent.");
    } catch (error) {
      setRestartError(extractErrorMessage(error));
    }
  };

  const handleOpenLogs = async () => {
    if (!isProduction) {
      setLogsError("PM2 logs are only available in production.");
      setLogsOpened(true);
      return;
    }

    setLogsOpened(true);
    setLogsError(null);
    setLogsLoading(true);
    try {
      if (logSource === "pm2") {
        if (!selectedProcessId) {
          setLogsError("Select a PM2 process to load logs.");
        } else {
          const response = await fetchPm2ProcessLogs(Number(selectedProcessId), logsLines);
          const combined = response.stderr
            ? `${response.output}\n\n[stderr]\n${response.stderr}`.trim()
            : response.output;
          setLogsOutput(combined || "(no logs returned)");
        }
      } else {
        const response = await fetchLogFile(logSource, logsLines);
        setLogsOutput(response.output || "(no logs returned)");
      }
    } catch (error) {
      setLogsError(extractErrorMessage(error));
    } finally {
      setLogsLoading(false);
    }
  };

  if (visibleSections.length === 0) {
    return (
      <PageAccessGuard pageSlug={PAGE_SLUG}>
        <Alert color="yellow" title="No accessible sections">
          Your role does not currently have access to any Settings areas. Reach out to your administrator if you
          believe this is an error.
        </Alert>
      </PageAccessGuard>
    );
  }

  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg">
        {visibleSections.map(({ label, description, icon: Icon, to }) => (
          <Card
            key={label}
            withBorder
            radius="md"
            padding="lg"
            style={{ cursor: "pointer" }}
            onClick={() => navigate(to)}
          >
            <Stack gap="xs">
              <ActionIcon variant="light" color="blue" size="lg" aria-label={label}>
                <Icon size={22} />
              </ActionIcon>
              <Title order={4}>{label}</Title>
              <Text size="sm" c="dimmed">
                {description}
              </Text>
            </Stack>
          </Card>
        ))}
        <Card withBorder radius="md" padding="lg">
          <Stack gap="xs">
            <ActionIcon variant="light" color="orange" size="lg" aria-label="Refresh app">
              <IconRefresh size={22} />
            </ActionIcon>
            <Title order={4}>Refresh app</Title>
            <Text size="sm" c="dimmed">
              Clear cached files and reload to fetch the latest version.
            </Text>
            <Button
              variant="light"
              color="orange"
              onClick={handleRefreshApp}
              loading={refreshing}
            >
              Refresh now
            </Button>
          </Stack>
        </Card>
        <Card withBorder radius="md" padding="lg">
          <Stack gap="xs">
            <ActionIcon variant="light" color="teal" size="lg" aria-label="Restart backend">
              <IconBolt size={22} />
            </ActionIcon>
            <Title order={4}>Restart backend</Title>
            <Text size="sm" c="dimmed">
              Choose a PM2 process to restart the backend service.
            </Text>
            {!isProduction ? (
              <Alert color="yellow" title="Available in production only">
                PM2 process controls are disabled outside the production environment.
              </Alert>
            ) : null}
            {pm2ProcessesQuery.isError && isProduction ? (
              <Alert color="red" title="Unable to load PM2 processes">
                {extractErrorMessage(pm2ProcessesQuery.error)}
              </Alert>
            ) : null}
            {restartError ? (
              <Alert color="red" title="Restart failed">
                {restartError}
              </Alert>
            ) : null}
            {restartFeedback ? (
              <Alert color="green" title="Restart requested">
                {restartFeedback}
              </Alert>
            ) : null}
            <Select
              label="PM2 process"
              placeholder={
                !isProduction
                  ? "Available in production only"
                  : pm2ProcessesQuery.isLoading
                  ? "Loading PM2 processes..."
                  : processOptions.length > 0
                    ? "Select a PM2 process"
                    : "No active PM2 processes"
              }
              data={processOptions}
              value={selectedProcessId}
              onChange={setSelectedProcessId}
              searchable
              clearable
              disabled={!isProduction || pm2ProcessesQuery.isLoading || pm2ProcessesQuery.isError || restartPm2Process.isPending}
              nothingFoundMessage="No active PM2 processes"
            />
            <Button
              variant="light"
              color="teal"
              onClick={handleRestartBackend}
              loading={restartPm2Process.isPending}
              disabled={
                !isProduction ||
                !selectedProcessId ||
                pm2ProcessesQuery.isLoading ||
                pm2ProcessesQuery.isError
              }
            >
              Restart now
            </Button>
            <Button
              variant="default"
              onClick={handleOpenLogs}
              disabled={
                !isProduction ||
                !selectedProcessId ||
                pm2ProcessesQuery.isLoading ||
                pm2ProcessesQuery.isError
              }
            >
              View logs
            </Button>
          </Stack>
        </Card>
      </SimpleGrid>

      <Modal
        opened={logsOpened}
        onClose={() => setLogsOpened(false)}
        title="PM2 logs"
        centered
        size="lg"
      >
        <Stack gap="sm">
          <Select
            label="Log source"
            data={[
              { value: "pm2", label: "PM2 (selected process)" },
              { value: "backend", label: "Backend combined.log" },
              { value: "ui", label: "UI combined.log" },
            ]}
            value={logSource}
            onChange={(value) => {
              const next = value === "backend" || value === "ui" ? value : "pm2";
              setLogSource(next);
              setLogsError(null);
              setLogsOutput(null);
            }}
          />
          {logsError ? (
            <Alert color="red" title="Unable to load logs">
              {logsError}
            </Alert>
          ) : null}
          <ScrollArea h={320} type="always">
            <Code block>
              {logsLoading ? "Loading logs..." : logsOutput ?? "Select a process to view logs."}
            </Code>
          </ScrollArea>
          <Button
            variant="default"
            onClick={handleOpenLogs}
            disabled={(logSource === "pm2" && !selectedProcessId) || logsLoading}
            loading={logsLoading}
          >
            Refresh logs
          </Button>
        </Stack>
      </Modal>
    </PageAccessGuard>
  );
};

export default SettingsLanding;
