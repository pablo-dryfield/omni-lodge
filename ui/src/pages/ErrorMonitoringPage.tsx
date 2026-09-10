import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Accordion,
  ActionIcon,
  Alert,
  Avatar,
  Badge,
  Box,
  Button,
  Center,
  CopyButton,
  Divider,
  Drawer,
  Group,
  Loader,
  MultiSelect,
  Pagination,
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
  Title,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useDebouncedValue, useMediaQuery } from "@mantine/hooks";
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconBellExclamation,
  IconBug,
  IconCheck,
  IconChevronRight,
  IconCode,
  IconCopy,
  IconDeviceDesktop,
  IconEye,
  IconFilter,
  IconHistory,
  IconRefresh,
  IconSearch,
  IconServer,
  IconShieldCheck,
  IconUser,
  IconWorld,
  IconX,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import { useSearchParams } from "react-router-dom";
import { navigateToPage } from "../actions/navigationActions";
import {
  addErrorMonitoringNote,
  deleteErrorMonitoringNote,
  fetchErrorMonitoringIssue,
  fetchErrorMonitoringIssues,
  fetchErrorMonitoringSummary,
  updateErrorMonitoringIssue,
  type ErrorMonitoringIssueDetailResponse,
  type ErrorMonitoringIssueFilters,
  type ErrorMonitoringIssueSummary,
  type ErrorMonitoringOccurrence,
  type ErrorMonitoringSeverity,
  type ErrorMonitoringStatus,
  type ErrorMonitoringUser,
} from "../api/errorMonitoring";
import { useActiveUsers } from "../api/users";
import { PageAccessGuard } from "../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../constants/pageSlugs";
import { useModuleAccess } from "../hooks/useModuleAccess";
import { useAppDispatch } from "../store/hooks";
import type { GenericPageProps } from "../types/general/GenericPageProps";
import styles from "./ErrorMonitoringPage.module.css";

const PAGE_SLUG = PAGE_SLUGS.errorMonitoring;
const PAGE_SIZE = 25;
const OCCURRENCE_PAGE_SIZE = 15;

const normalizeIssueId = (value: string | null): string | null => {
  const normalized = value?.trim() ?? "";
  if (!/^\d+$/.test(normalized)) {
    return null;
  }
  const numeric = Number(normalized);
  return Number.isSafeInteger(numeric) && numeric > 0 ? String(numeric) : null;
};

const STATUS_OPTIONS: Array<{ value: ErrorMonitoringStatus; label: string }> = [
  { value: "open", label: "Open" },
  { value: "investigating", label: "Investigating" },
  { value: "resolved", label: "Resolved" },
  { value: "ignored", label: "Ignored" },
];

const SEVERITY_OPTIONS: Array<{ value: ErrorMonitoringSeverity; label: string }> = [
  { value: "fatal", label: "Fatal" },
  { value: "error", label: "Error" },
  { value: "warning", label: "Warning" },
];

const SORT_OPTIONS = [
  { value: "lastSeenAt:desc", label: "Recently seen" },
  { value: "firstSeenAt:desc", label: "Recently created" },
  { value: "occurrenceCount:desc", label: "Most frequent" },
  { value: "affectedUserCount:desc", label: "Most users affected" },
  { value: "severity:desc", label: "Highest severity" },
] as const;

const STATUS_META: Record<ErrorMonitoringStatus, { label: string; color: string }> = {
  open: { label: "Open", color: "red" },
  investigating: { label: "Investigating", color: "blue" },
  resolved: { label: "Resolved", color: "teal" },
  ignored: { label: "Ignored", color: "gray" },
};

const SEVERITY_META: Record<ErrorMonitoringSeverity, { label: string; color: string }> = {
  fatal: { label: "Fatal", color: "red" },
  error: { label: "Error", color: "orange" },
  warning: { label: "Warning", color: "yellow" },
};

const formatCount = (value: number): string => new Intl.NumberFormat("en-US").format(value || 0);

const formatTimestamp = (value: string | null | undefined): string => {
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format("DD MMM YYYY, HH:mm:ss") : "Unknown";
};

const formatShortTimestamp = (value: string | null | undefined): string => {
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format("DD MMM, HH:mm") : "Unknown";
};

const formatDuration = (value: number | null): string => {
  if (value == null || !Number.isFinite(value)) {
    return "—";
  }
  return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms`;
};

const humanize = (value: string): string =>
  value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const formatSource = (source: string): string => ({
  client: "Browser",
  server: "Backend",
  request: "API request",
  process: "Background process",
}[source] ?? humanize(source));

const formatUser = (user: ErrorMonitoringUser | null | undefined): string => {
  if (!user) {
    return "Guest / unknown user";
  }
  const fullName = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
  return fullName || user.email?.trim() || (user.id != null ? `User #${user.id}` : "Guest / unknown user");
};

const getInitials = (user: ErrorMonitoringUser | null | undefined): string => {
  const first = user?.firstName?.trim().charAt(0) ?? "";
  const last = user?.lastName?.trim().charAt(0) ?? "";
  return `${first}${last}`.toUpperCase() || "?";
};

const getErrorMessage = (error: unknown): string => {
  if (typeof error === "object" && error !== null) {
    const candidate = error as {
      message?: unknown;
      response?: { data?: { message?: unknown } };
    };
    if (typeof candidate.response?.data?.message === "string") {
      return candidate.response.data.message;
    }
    if (typeof candidate.message === "string") {
      return candidate.message;
    }
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "The request failed.";
};

const stringifyContext = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const StatusBadge = ({ status }: { status: ErrorMonitoringStatus }) => {
  const meta = STATUS_META[status] ?? { label: humanize(status), color: "gray" };
  return (
    <Badge color={meta.color} variant="light" radius="sm">
      {meta.label}
    </Badge>
  );
};

const SeverityBadge = ({ severity }: { severity: ErrorMonitoringSeverity }) => {
  const meta = SEVERITY_META[severity] ?? { label: humanize(severity), color: "gray" };
  return (
    <Badge color={meta.color} variant="filled" radius="sm">
      {meta.label}
    </Badge>
  );
};

const SourceBadge = ({ source }: { source: string }) => (
  <Badge color="gray" variant="outline" radius="sm">
    {formatSource(source)}
  </Badge>
);

type IssueStatusAction = {
  status: ErrorMonitoringStatus;
  label: string;
  color: string;
  icon: typeof IconCheck;
};

const getIssueStatusActions = (status: ErrorMonitoringStatus): IssueStatusAction[] => {
  if (status === "resolved" || status === "ignored") {
    return [{ status: "open", label: "Reopen", color: "blue", icon: IconRefresh }];
  }

  return [
    ...(status === "open"
      ? [{ status: "investigating" as const, label: "Investigate", color: "blue", icon: IconEye }]
      : [{ status: "open" as const, label: "Reopen", color: "blue", icon: IconRefresh }]),
    { status: "resolved", label: "Resolve", color: "teal", icon: IconCheck },
    { status: "ignored", label: "Ignore", color: "gray", icon: IconX },
  ];
};

type IssueQuickActionsProps = {
  issue: ErrorMonitoringIssueSummary;
  canUpdate: boolean;
  disabled?: boolean;
  mobile?: boolean;
  pendingStatus: ErrorMonitoringStatus | null;
  onStatusChange: (status: ErrorMonitoringStatus) => void;
};

const IssueQuickActions = ({
  issue,
  canUpdate,
  disabled = false,
  mobile = false,
  pendingStatus,
  onStatusChange,
}: IssueQuickActionsProps) => {
  if (!canUpdate) {
    return null;
  }

  const busy = disabled || pendingStatus !== null;
  return (
    <Group
      gap={6}
      wrap="nowrap"
      justify="center"
      grow={mobile}
      w={mobile ? "100%" : undefined}
      aria-label={`Actions for ${issue.title}`}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {getIssueStatusActions(issue.status).map(({ status, label, color, icon: Icon }) => (
        <Button
          key={status}
          size="compact-sm"
          variant={status === "resolved" ? "filled" : "light"}
          color={color}
          leftSection={<Icon size={15} aria-hidden="true" />}
          loading={pendingStatus === status}
          disabled={busy}
          className={mobile ? styles.mobileQuickAction : undefined}
          aria-label={`${label} issue: ${issue.title}`}
          onClick={() => onStatusChange(status)}
        >
          {label}
        </Button>
      ))}
    </Group>
  );
};

type MetricCardProps = {
  label: string;
  value: number;
  detail: string;
  color: string;
  icon: typeof IconBug;
};

const MetricCard = ({ label, value, detail, color, icon: Icon }: MetricCardProps) => (
  <Paper withBorder radius="xl" p="lg" className={styles.metricCard}>
    <Group justify="space-between" align="flex-start" wrap="nowrap">
      <Box>
        <Text size="xs" fw={800} c="dimmed" tt="uppercase" lts={0.7}>
          {label}
        </Text>
        <Text className={styles.metricValue} size="2rem" fw={800} lh={1.15} mt={5}>
          {formatCount(value)}
        </Text>
      </Box>
      <ThemeIcon color={color} variant="light" radius="xl" size={44}>
        <Icon size={23} aria-hidden="true" />
      </ThemeIcon>
    </Group>
    <Text size="xs" c="dimmed" mt="sm">
      {detail}
    </Text>
  </Paper>
);

const IssueLocation = ({ issue }: { issue: ErrorMonitoringIssueSummary }) => {
  const location = issue.lastRoute || issue.lastPageUrl || "No route captured";
  return (
    <Tooltip label={location} disabled={location.length < 45} withArrow>
      <Text size="xs" c="dimmed" truncate className={styles.issueTitle}>
        {location}
      </Text>
    </Tooltip>
  );
};

const MobileIssueCard = ({
  issue,
  onOpen,
  canUpdate,
  actionsDisabled,
  pendingStatus,
  onStatusChange,
}: {
  issue: ErrorMonitoringIssueSummary;
  onOpen: () => void;
  canUpdate: boolean;
  actionsDisabled: boolean;
  pendingStatus: ErrorMonitoringStatus | null;
  onStatusChange: (status: ErrorMonitoringStatus) => void;
}) => (
  <Paper
    withBorder
    radius="lg"
    className={styles.mobileIssueCard}
    style={{ borderLeftColor: `var(--mantine-color-${SEVERITY_META[issue.severity]?.color ?? "gray"}-6)` }}
    component="article"
    w="100%"
  >
    <UnstyledButton
      className={styles.mobileIssueOpenButton}
      onClick={onOpen}
      aria-label={`Open ${issue.title}`}
    >
      <Stack gap="sm" style={{ textAlign: "left" }}>
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Group gap={6} wrap="wrap">
            <SeverityBadge severity={issue.severity} />
            <StatusBadge status={issue.status} />
            <SourceBadge source={issue.source} />
          </Group>
          <IconChevronRight size={18} color="#868e96" aria-hidden="true" />
        </Group>
        <Box>
          <Text fw={750} lineClamp={2} className={styles.breakAnywhere}>
            {issue.title}
          </Text>
          <IssueLocation issue={issue} />
        </Box>
        <Group justify="space-between" gap="xs">
          <Group gap={5}>
            <IconHistory size={14} color="#868e96" aria-hidden="true" />
            <Text size="xs" c="dimmed">
              {formatShortTimestamp(issue.lastSeenAt)}
            </Text>
          </Group>
          <Text size="xs" fw={700}>
            {formatCount(issue.occurrenceCount)} weighted events · {formatCount(issue.affectedUserCount)} users
          </Text>
        </Group>
      </Stack>
    </UnstyledButton>
    {canUpdate ? (
      <Box className={styles.mobileIssueActions}>
        <IssueQuickActions
          issue={issue}
          canUpdate={canUpdate}
          disabled={actionsDisabled}
          mobile
          pendingStatus={pendingStatus}
          onStatusChange={onStatusChange}
        />
      </Box>
    ) : null}
  </Paper>
);

const MetadataItem = ({ label, value }: { label: string; value: string }) => (
  <Box>
    <Text size="xs" c="dimmed" fw={700} tt="uppercase" lts={0.4}>
      {label}
    </Text>
    <Text size="sm" fw={600} mt={2} className={styles.breakAnywhere}>
      {value || "—"}
    </Text>
  </Box>
);

const CopyableMetadataItem = ({ label, value }: { label: string; value: string }) => (
  <Box>
    <Text size="xs" c="dimmed" fw={700} tt="uppercase" lts={0.4}>
      {label}
    </Text>
    <Group gap={5} wrap="nowrap" mt={2}>
      <Text size="sm" fw={650} className={`${styles.mono} ${styles.breakAnywhere}`}>
        {value}
      </Text>
      <CopyButton value={value} timeout={1600}>
        {({ copied, copy }) => (
          <Tooltip label={copied ? "Copied" : `Copy ${label.toLowerCase()}`} withArrow>
            <ActionIcon
              size="sm"
              variant="subtle"
              color={copied ? "teal" : "gray"}
              aria-label={`Copy ${label.toLowerCase()}`}
              onClick={copy}
            >
              {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
            </ActionIcon>
          </Tooltip>
        )}
      </CopyButton>
    </Group>
  </Box>
);

const TechnicalBlock = ({ title, value, dark = false }: { title: string; value: unknown; dark?: boolean }) => (
  <Box>
    <Text size="sm" fw={750} mb={6}>
      {title}
    </Text>
    <pre className={dark ? styles.stackBlock : styles.jsonBlock}>
      {typeof value === "string" ? value : stringifyContext(value)}
    </pre>
  </Box>
);

const OccurrencePanel = ({ occurrence }: { occurrence: ErrorMonitoringOccurrence }) => {
  const path = occurrence.pageUrlPath || occurrence.httpUrlPath || occurrence.route || "No route captured";
  const hasTechnicalContext =
    occurrence.stack ||
    occurrence.componentStack ||
    occurrence.context ||
    occurrence.tags ||
    (occurrence.breadcrumbs?.length ?? 0) > 0;

  return (
    <Stack gap="lg">
      <SimpleGrid cols={{ base: 1, xs: 2, sm: 3 }} spacing="md">
        <MetadataItem label="Occurred" value={formatTimestamp(occurrence.occurredAt)} />
        <MetadataItem label="Received" value={formatTimestamp(occurrence.receivedAt)} />
        <MetadataItem label="User" value={formatUser(occurrence.user)} />
        <MetadataItem
          label="Request"
          value={[occurrence.httpMethod, occurrence.httpStatus, formatDuration(occurrence.durationMs)]
            .filter((value) => value != null && value !== "—")
            .join(" · ") || "—"}
        />
        <CopyableMetadataItem label="Error reference" value={occurrence.clientEventId || occurrence.eventId} />
        <CopyableMetadataItem label="Server event ID" value={occurrence.eventId} />
        {occurrence.requestId ? <CopyableMetadataItem label="Request ID" value={occurrence.requestId} /> : null}
        <MetadataItem label="Release" value={occurrence.release ?? "—"} />
        <MetadataItem label="Environment" value={occurrence.environment ?? "—"} />
        <MetadataItem label="Route / page" value={path} />
      </SimpleGrid>

      {occurrence.userAgent ? <MetadataItem label="Browser / device" value={occurrence.userAgent} /> : null}

      {hasTechnicalContext ? (
        <Stack gap="md">
          {occurrence.stack ? <TechnicalBlock title="Stack trace" value={occurrence.stack} dark /> : null}
          {occurrence.componentStack ? (
            <TechnicalBlock title="React component stack" value={occurrence.componentStack} dark />
          ) : null}
          {occurrence.context ? <TechnicalBlock title="Context" value={occurrence.context} /> : null}
          {occurrence.tags ? <TechnicalBlock title="Tags" value={occurrence.tags} /> : null}
          {occurrence.breadcrumbs?.length ? (
            <TechnicalBlock title="Breadcrumbs" value={occurrence.breadcrumbs} />
          ) : null}
        </Stack>
      ) : (
        <Text size="sm" c="dimmed">
          No additional technical context was captured for this stored sample.
        </Text>
      )}
    </Stack>
  );
};

type IssueDrawerProps = {
  issueId: string | null;
  onClose: () => void;
  activeUserOptions: Array<{ value: string; label: string }>;
  onChanged: () => void;
  canUpdate: boolean;
};

const IssueDrawer = ({ issueId, onClose, activeUserOptions, onChanged, canUpdate }: IssueDrawerProps) => {
  const isMobile = useMediaQuery("(max-width: 48em)") ?? false;
  const queryClient = useQueryClient();
  const [occurrencePage, setOccurrencePage] = useState(1);
  const [noteBody, setNoteBody] = useState("");
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  useEffect(() => {
    setOccurrencePage(1);
    setNoteBody("");
    setActionMessage(null);
  }, [issueId]);

  const detailQuery = useQuery<ErrorMonitoringIssueDetailResponse>({
    queryKey: ["error-monitoring", "issue", issueId, occurrencePage],
    queryFn: () => fetchErrorMonitoringIssue(issueId as string, occurrencePage, OCCURRENCE_PAGE_SIZE),
    enabled: Boolean(issueId),
    staleTime: 10_000,
  });

  const invalidateIssueData = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["error-monitoring", "issue", issueId] }),
      queryClient.invalidateQueries({ queryKey: ["error-monitoring", "issues"] }),
      queryClient.invalidateQueries({ queryKey: ["error-monitoring", "summary"] }),
    ]);
    onChanged();
  }, [issueId, onChanged, queryClient]);

  const updateMutation = useMutation({
    mutationFn: (changes: Parameters<typeof updateErrorMonitoringIssue>[1]) =>
      updateErrorMonitoringIssue(issueId as string, changes),
    onSuccess: async () => {
      setActionMessage(null);
      await invalidateIssueData();
    },
    onError: (error) => setActionMessage(getErrorMessage(error)),
  });

  const noteMutation = useMutation({
    mutationFn: () => addErrorMonitoringNote(issueId as string, noteBody.trim()),
    onSuccess: async () => {
      setNoteBody("");
      setActionMessage(null);
      await invalidateIssueData();
    },
    onError: (error) => setActionMessage(getErrorMessage(error)),
  });

  const deleteNoteMutation = useMutation({
    mutationFn: (noteId: string) => deleteErrorMonitoringNote(issueId as string, noteId),
    onSuccess: async () => {
      setActionMessage(null);
      await invalidateIssueData();
    },
    onError: (error) => setActionMessage(getErrorMessage(error)),
  });

  const detail = detailQuery.data;
  const issue = detail?.issue;
  const busy = updateMutation.isPending || noteMutation.isPending || deleteNoteMutation.isPending;

  const statusActions = issue ? getIssueStatusActions(issue.status) : [];

  return (
    <Drawer
      opened={Boolean(issueId)}
      onClose={onClose}
      position="right"
      size={isMobile ? "100%" : "min(900px, 94vw)"}
      padding={isMobile ? "md" : "xl"}
      title={
        <Group gap="sm" wrap="nowrap">
          <ThemeIcon color="red" variant="light" radius="xl" size={38}>
            <IconBug size={20} aria-hidden="true" />
          </ThemeIcon>
          <Box>
            <Text fw={800}>Issue details</Text>
            <Text size="xs" c="dimmed">
              Diagnosis, history and ownership
            </Text>
          </Box>
        </Group>
      }
      closeButtonProps={{ "aria-label": "Close issue details" }}
      overlayProps={{ backgroundOpacity: 0.42, blur: 2 }}
    >
      {detailQuery.isLoading ? (
        <Center mih={320}>
          <Loader variant="dots" />
        </Center>
      ) : detailQuery.isError ? (
        <Alert color="red" icon={<IconAlertTriangle size={18} />} title="Issue details unavailable">
          <Stack gap="sm">
            <Text size="sm">{getErrorMessage(detailQuery.error)}</Text>
            <Button variant="light" color="red" onClick={() => void detailQuery.refetch()}>
              Try again
            </Button>
          </Stack>
        </Alert>
      ) : issue && detail ? (
        <Stack gap="lg" pb="xl">
          <Box>
            <Group gap="xs" mb="sm" wrap="wrap">
              <SeverityBadge severity={issue.severity} />
              <StatusBadge status={issue.status} />
              <SourceBadge source={issue.source} />
              <Badge variant="dot" color="gray">
                {humanize(issue.kind)}
              </Badge>
            </Group>
            <Title order={2} size={isMobile ? "h3" : "h2"} className={styles.breakAnywhere}>
              {issue.title}
            </Title>
            <Text size="xs" c="dimmed" mt={8} className={`${styles.mono} ${styles.breakAnywhere}`}>
              {issue.fingerprint}
            </Text>
          </Box>

          <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
            <Paper withBorder radius="lg" p="md" ta="center">
              <Text size="xl" fw={800}>{formatCount(issue.occurrenceCount)}</Text>
              <Text size="xs" c="dimmed">Weighted events</Text>
            </Paper>
            <Paper withBorder radius="lg" p="md" ta="center">
              <Text size="xl" fw={800}>{formatCount(issue.affectedUserCount)}</Text>
              <Text size="xs" c="dimmed">Users</Text>
            </Paper>
            <Paper withBorder radius="lg" p="md" ta="center">
              <Text size="sm" fw={800}>{formatShortTimestamp(issue.firstSeenAt)}</Text>
              <Text size="xs" c="dimmed">First seen</Text>
            </Paper>
            <Paper withBorder radius="lg" p="md" ta="center">
              <Text size="sm" fw={800}>{formatShortTimestamp(issue.lastSeenAt)}</Text>
              <Text size="xs" c="dimmed">Last seen</Text>
            </Paper>
          </SimpleGrid>

          <Paper withBorder radius="xl" p="md">
            <SimpleGrid cols={{ base: 1, xs: 2, sm: 3 }} spacing="md">
              <MetadataItem label="Latest route" value={issue.lastRoute || issue.lastPageUrl || "—"} />
              <MetadataItem label="Culprit" value={issue.culprit || "—"} />
              <MetadataItem label="Release" value={issue.lastRelease || "—"} />
              <MetadataItem label="Environment" value={issue.lastEnvironment || "—"} />
              <MetadataItem
                label="Owner"
                value={issue.assignedTo
                  ? `${issue.assignedTo.firstName ?? ""} ${issue.assignedTo.lastName ?? ""}`.trim() || issue.assignedTo.email || "Assigned"
                  : "Unassigned"}
              />
              <MetadataItem label="Reopened" value={`${formatCount(issue.reopenedCount)} times`} />
            </SimpleGrid>
          </Paper>

          {actionMessage ? (
            <Alert color="red" icon={<IconAlertCircle size={18} />} withCloseButton onClose={() => setActionMessage(null)}>
              {actionMessage}
            </Alert>
          ) : null}

          <Paper withBorder radius="xl" p="md">
            <Stack gap="md">
              <Group justify="space-between" align="end" wrap="wrap">
                <Box>
                  <Text fw={800}>Triage</Text>
                  <Text size="xs" c="dimmed">Keep the status, severity and owner current.</Text>
                </Box>
                <Group gap="xs">
                  {!canUpdate ? <Badge color="gray" variant="light">Read only</Badge> : null}
                  {statusActions.map(({ status, label, color, icon: Icon }) => (
                    <Button
                      key={status}
                      size="xs"
                      variant={status === "resolved" ? "filled" : "light"}
                      color={color}
                      leftSection={<Icon size={15} />}
                      loading={updateMutation.isPending}
                      disabled={busy || !canUpdate}
                      onClick={() => {
                        if (
                          status !== "ignored"
                          || window.confirm(
                            "Ignore this issue? Future occurrences will stay grouped as ignored until you reopen it.",
                          )
                        ) {
                          updateMutation.mutate({ status });
                        }
                      }}
                    >
                      {label}
                    </Button>
                  ))}
                </Group>
              </Group>
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <Select
                  label="Severity"
                  data={SEVERITY_OPTIONS}
                  value={issue.severity}
                  disabled={busy || !canUpdate}
                  allowDeselect={false}
                  onChange={(value) => {
                    if (value && value !== issue.severity) {
                      updateMutation.mutate({ severity: value as ErrorMonitoringSeverity });
                    }
                  }}
                />
                <Select
                  label="Assigned to"
                  placeholder="Unassigned"
                  searchable
                  clearable
                  data={activeUserOptions}
                  value={issue.assignedTo?.id != null ? String(issue.assignedTo.id) : null}
                  disabled={busy || !canUpdate}
                  onChange={(value) =>
                    updateMutation.mutate({ assignedToUserId: value ? Number(value) : null })
                  }
                />
              </SimpleGrid>
            </Stack>
          </Paper>

          <Tabs defaultValue="occurrences" keepMounted={false}>
            <Tabs.List grow={isMobile}>
              <Tabs.Tab value="occurrences" leftSection={<IconHistory size={16} />}>
                Stored samples ({formatCount(detail.occurrencePagination.total)})
              </Tabs.Tab>
              <Tabs.Tab value="notes" leftSection={<IconCode size={16} />}>
                Notes ({formatCount(detail.notes.length)})
              </Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="occurrences" pt="md">
              {detail.occurrences.length === 0 ? (
                <Paper withBorder radius="lg" p="xl" ta="center">
                  <Text c="dimmed">No stored samples are available.</Text>
                </Paper>
              ) : (
                <Stack gap="md">
                  <Accordion variant="separated" radius="lg" defaultValue={detail.occurrences[0]?.id}>
                    {detail.occurrences.map((occurrence, index) => {
                      const route = occurrence.pageUrlPath || occurrence.httpUrlPath || occurrence.route;
                      return (
                        <Accordion.Item key={occurrence.id} value={occurrence.id}>
                          <Accordion.Control>
                            <Group justify="space-between" wrap="nowrap" pr="xs">
                              <Box className={styles.occurrenceHeader}>
                                <Group gap={6} wrap="wrap">
                                  <Text size="sm" fw={750}>Sample #{detail.occurrencePagination.total - ((occurrencePage - 1) * OCCURRENCE_PAGE_SIZE + index)}</Text>
                                  {(occurrence.eventCount ?? 1) > 1 ? (
                                    <Badge size="xs" color="violet" variant="light">
                                      {formatCount(occurrence.eventCount ?? 1)} events in this sample
                                    </Badge>
                                  ) : null}
                                  {occurrence.httpStatus ? (
                                    <Badge size="xs" color={occurrence.httpStatus >= 500 ? "red" : "orange"} variant="light">
                                      HTTP {occurrence.httpStatus}
                                    </Badge>
                                  ) : null}
                                </Group>
                                <Text size="xs" c="dimmed" truncate>
                                  {formatTimestamp(occurrence.occurredAt)}{route ? ` · ${route}` : ""}
                                </Text>
                              </Box>
                              <Avatar size="sm" radius="xl" color="blue">
                                {getInitials(occurrence.user)}
                              </Avatar>
                            </Group>
                          </Accordion.Control>
                          <Accordion.Panel>
                            <OccurrencePanel occurrence={occurrence} />
                          </Accordion.Panel>
                        </Accordion.Item>
                      );
                    })}
                  </Accordion>
                  {detail.occurrencePagination.totalPages > 1 ? (
                    <Group justify="center">
                      <Pagination
                        value={occurrencePage}
                        total={detail.occurrencePagination.totalPages}
                        onChange={setOccurrencePage}
                        size={isMobile ? "sm" : "md"}
                      />
                    </Group>
                  ) : null}
                </Stack>
              )}
            </Tabs.Panel>

            <Tabs.Panel value="notes" pt="md">
              <Stack gap="md">
                <Textarea
                  label="Add investigation note"
                  placeholder="What did you find, change, or decide?"
                  minRows={3}
                  maxLength={4000}
                  autosize
                  value={noteBody}
                  onChange={(event) => setNoteBody(event.currentTarget.value)}
                  disabled={!canUpdate}
                />
                <Group justify="flex-end">
                  <Button
                    onClick={() => noteMutation.mutate()}
                    loading={noteMutation.isPending}
                    disabled={!canUpdate || !noteBody.trim() || busy}
                  >
                    Add note
                  </Button>
                </Group>
                <Divider />
                {detail.notes.length === 0 ? (
                  <Text size="sm" c="dimmed" ta="center" py="lg">No investigation notes yet.</Text>
                ) : (
                  detail.notes.map((note) => (
                    <Paper key={note.id} withBorder radius="lg" p="md">
                      <Group justify="space-between" align="flex-start" wrap="nowrap">
                        <Box>
                          <Text size="sm" fw={700}>{formatUser(note.author)}</Text>
                          <Text size="xs" c="dimmed">{formatTimestamp(note.createdAt)}</Text>
                        </Box>
                        <Tooltip label="Delete note">
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            aria-label="Delete note"
                            disabled={busy || !canUpdate}
                            onClick={() => {
                              if (window.confirm("Delete this investigation note?")) {
                                deleteNoteMutation.mutate(note.id);
                              }
                            }}
                          >
                            <IconX size={16} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                      <Text size="sm" mt="sm" style={{ whiteSpace: "pre-wrap" }}>{note.body}</Text>
                    </Paper>
                  ))
                )}
              </Stack>
            </Tabs.Panel>
          </Tabs>
        </Stack>
      ) : null}
    </Drawer>
  );
};

const ErrorMonitoringDashboard = ({ title }: GenericPageProps) => {
  const isMobile = useMediaQuery("(max-width: 48em)") ?? false;
  const moduleAccess = useModuleAccess("error-monitoring-dashboard");
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebouncedValue(search, 300);
  const [statuses, setStatuses] = useState<ErrorMonitoringStatus[]>(["open", "investigating"]);
  const [severities, setSeverities] = useState<ErrorMonitoringSeverity[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [kinds, setKinds] = useState<string[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [pagePath, setPagePath] = useState("");
  const [debouncedPagePath] = useDebouncedValue(pagePath, 300);
  const [release, setRelease] = useState("");
  const [debouncedRelease] = useDebouncedValue(release, 300);
  const [environment, setEnvironment] = useState("");
  const [debouncedEnvironment] = useDebouncedValue(environment, 300);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortValue, setSortValue] = useState<string>("lastSeenAt:desc");
  const [refreshToken, setRefreshToken] = useState(0);
  const [listActionError, setListActionError] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedIssueId = normalizeIssueId(searchParams.get("issue"));
  const { data: activeUsers = [] } = useActiveUsers();

  const [sort, direction] = sortValue.split(":") as [
    NonNullable<ErrorMonitoringIssueFilters["sort"]>,
    NonNullable<ErrorMonitoringIssueFilters["direction"]>,
  ];

  const filters = useMemo<ErrorMonitoringIssueFilters>(
    () => ({
      page,
      limit: PAGE_SIZE,
      search: debouncedSearch.trim() || undefined,
      status: statuses,
      severity: severities,
      source: sources,
      kind: kinds,
      userId: userId ? Number(userId) : null,
      pagePath: debouncedPagePath.trim() || undefined,
      release: debouncedRelease.trim() || undefined,
      environment: debouncedEnvironment.trim() || undefined,
      from: dateFrom ? dayjs(dateFrom).startOf("day").toISOString() : null,
      to: dateTo ? dayjs(dateTo).endOf("day").toISOString() : null,
      sort,
      direction,
    }),
    [dateFrom, dateTo, debouncedEnvironment, debouncedPagePath, debouncedRelease, debouncedSearch, direction, kinds, page, severities, sort, sources, statuses, userId],
  );

  const summaryQuery = useQuery({
    queryKey: ["error-monitoring", "summary", refreshToken],
    queryFn: fetchErrorMonitoringSummary,
    retry: 1,
    refetchInterval: (query) => query.state.status === "error" ? false : 30_000,
    refetchIntervalInBackground: false,
    enabled: moduleAccess.ready && moduleAccess.canView,
  });

  const issuesQuery = useQuery({
    queryKey: ["error-monitoring", "issues", filters, refreshToken],
    queryFn: () => fetchErrorMonitoringIssues(filters),
    retry: 1,
    refetchInterval: (query) => query.state.status === "error" ? false : 30_000,
    refetchIntervalInBackground: false,
    enabled: moduleAccess.ready && moduleAccess.canView,
  });

  const quickStatusMutation = useMutation({
    mutationFn: ({ issueId, status }: { issueId: string; status: ErrorMonitoringStatus }) =>
      updateErrorMonitoringIssue(issueId, { status }),
    onSuccess: async (_updatedIssue, { issueId }) => {
      setListActionError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["error-monitoring", "issues"] }),
        queryClient.invalidateQueries({ queryKey: ["error-monitoring", "summary"] }),
        queryClient.invalidateQueries({ queryKey: ["error-monitoring", "issue", issueId] }),
      ]);
    },
    onError: (error) => setListActionError(getErrorMessage(error)),
  });

  const requestQuickStatusChange = (
    issue: ErrorMonitoringIssueSummary,
    status: ErrorMonitoringStatus,
  ) => {
    if (
      status === "ignored"
      && !window.confirm(
        "Ignore this issue? Future occurrences will stay grouped as ignored until you reopen it.",
      )
    ) {
      return;
    }
    setListActionError(null);
    quickStatusMutation.mutate({ issueId: issue.id, status });
  };

  const summary = summaryQuery.data;
  const issues = useMemo(() => issuesQuery.data?.issues ?? [], [issuesQuery.data?.issues]);
  const pagination = issuesQuery.data?.pagination;
  const activeCount = (summary?.counts.open ?? 0) + (summary?.counts.investigating ?? 0);
  const captureQueue = summary?.queue;
  const captureSpool = captureQueue?.spool;
  const captureLosses = (captureQueue?.dropped ?? 0)
    + (captureSpool?.writeFailures ?? 0)
    + (captureSpool?.malformedDiscarded ?? 0);
  const captureBacklog = captureSpool?.queuedRecords ?? 0;

  const sourceOptions = useMemo(() => {
    const values = new Set<string>(["client", "server", "request", "process"]);
    summary?.sources.forEach(({ source }) => values.add(source));
    issues.forEach((issue) => values.add(issue.source));
    return [...values].sort().map((value) => ({ value, label: formatSource(value) }));
  }, [issues, summary?.sources]);

  const kindOptions = useMemo(() => {
    const values = new Set(issues.map((issue) => issue.kind).filter(Boolean));
    return [...values].sort().map((value) => ({ value, label: humanize(value) }));
  }, [issues]);

  const activeUserOptions = useMemo(
    () =>
      activeUsers.map((user) => {
        const name = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
        return {
          value: String(user.id),
          label: name || user.email || `User #${user.id}`,
        };
      }),
    [activeUsers],
  );

  const hasFilters = Boolean(
    search ||
      statuses.length !== 2 ||
      !statuses.includes("open") ||
      !statuses.includes("investigating") ||
      severities.length ||
      sources.length ||
      kinds.length ||
      userId ||
      pagePath ||
      release ||
      environment ||
      dateFrom ||
      dateTo ||
      sortValue !== "lastSeenAt:desc",
  );

  const clearFilters = () => {
    setSearch("");
    setStatuses(["open", "investigating"]);
    setSeverities([]);
    setSources([]);
    setKinds([]);
    setUserId(null);
    setPagePath("");
    setRelease("");
    setEnvironment("");
    setDateFrom("");
    setDateTo("");
    setSortValue("lastSeenAt:desc");
    setPage(1);
  };

  const changeFilter = <T,>(setter: (value: T) => void, value: T) => {
    setPage(1);
    setter(value);
  };

  const refresh = useCallback(() => setRefreshToken((current) => current + 1), []);

  const openIssue = useCallback((issueId: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("issue", issueId);
    setSearchParams(next);
  }, [searchParams, setSearchParams]);

  const closeIssue = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete("issue");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  if (!moduleAccess.ready || moduleAccess.loading) {
    return <Center mih={320}><Loader variant="dots" /></Center>;
  }

  if (!moduleAccess.canView) {
    return (
      <Alert m="lg" color="red" icon={<IconAlertTriangle size={18} />} title="Access denied">
        You do not have permission to view error monitoring.
      </Alert>
    );
  }

  return (
    <Stack gap="lg" p={isMobile ? "sm" : "lg"} className={styles.page}>
      <Paper className={styles.hero} radius={32} p={isMobile ? "lg" : "xl"} shadow="sm">
        <Group className={styles.heroContent} justify="space-between" align="center" wrap="wrap" gap="lg">
          <Group gap="md" wrap="nowrap">
            <ThemeIcon className={styles.heroIcon} color="gray" c="white" variant="light" size={isMobile ? 48 : 58} radius="xl">
              <IconShieldCheck size={isMobile ? 25 : 31} aria-hidden="true" />
            </ThemeIcon>
            <Box>
              <Badge color="teal" variant="light" radius="xl" mb={6}>Admin diagnostics</Badge>
              <Title order={1} c="white" size={isMobile ? "h2" : "2.25rem"}>{title}</Title>
              <Text c="gray.3" size="sm" mt={4}>Browser, API and server failures grouped into actionable issues.</Text>
            </Box>
          </Group>
          <Button
            variant="white"
            color="dark"
            leftSection={<IconRefresh size={17} />}
            loading={summaryQuery.isFetching || issuesQuery.isFetching}
            onClick={refresh}
          >
            Refresh
          </Button>
        </Group>
      </Paper>

      <SimpleGrid cols={{ base: 2, md: 4 }} spacing="md">
        <MetricCard label="Active issues" value={activeCount} detail={`${formatCount(summary?.counts.investigating ?? 0)} under investigation`} color="red" icon={IconBellExclamation} />
        <MetricCard label="Fatal errors" value={summary?.severity.fatal ?? 0} detail={`${formatCount(summary?.severity.error ?? 0)} error-level issues`} color="red" icon={IconAlertCircle} />
        <MetricCard
          label="Weighted events · 24h"
          value={summary?.occurrences.last24Hours ?? 0}
          detail={`${formatCount(summary?.occurrences.samplesLast24Hours ?? 0)} stored samples · ${formatCount(summary?.occurrences.last7Days ?? 0)} events in 7 days`}
          color="orange"
          icon={IconHistory}
        />
        <MetricCard label="Tracked sources" value={summary?.sources.length ?? 0} detail={`${formatCount(summary?.counts.total ?? 0)} grouped issues total`} color="blue" icon={IconServer} />
      </SimpleGrid>

      {captureQueue ? (
        <Paper withBorder radius="xl" p="md">
          <Group justify="space-between" align="center" wrap="wrap" gap="sm">
            <Group gap="sm" wrap="nowrap">
              <ThemeIcon
                variant="light"
                color={captureLosses > 0 ? "red" : captureBacklog > 0 ? "orange" : "teal"}
                radius="xl"
              >
                {captureLosses > 0 ? <IconAlertTriangle size={17} /> : <IconShieldCheck size={17} />}
              </ThemeIcon>
              <Box>
                <Text fw={800}>Server capture pipeline</Text>
                <Text size="xs" c="dimmed">
                  {captureLosses > 0 ? "Attention required" : captureBacklog > 0 ? "Durable replay pending" : "Healthy"}
                </Text>
              </Box>
            </Group>
            <Group gap="xs" wrap="wrap">
              <Badge variant="light" color={captureQueue.pending > 0 ? "blue" : "gray"}>
                {formatCount(captureQueue.pending)} in memory
              </Badge>
              {captureSpool ? (
                <>
                  <Badge variant="light" color={captureBacklog > 0 ? "orange" : "gray"}>
                    {formatCount(captureBacklog)} queued on disk
                  </Badge>
                  <Badge variant="light" color="teal">
                    {formatCount(captureSpool.replayed)} replayed
                  </Badge>
                </>
              ) : null}
              <Badge variant="light" color={captureQueue.dropped > 0 ? "red" : "gray"}>
                {formatCount(captureQueue.dropped)} dropped
              </Badge>
            </Group>
          </Group>
        </Paper>
      ) : null}

      {summaryQuery.isError ? (
        <Alert color="orange" icon={<IconAlertTriangle size={18} />} title="Summary unavailable">
          {getErrorMessage(summaryQuery.error)}
        </Alert>
      ) : null}

      {captureLosses > 0 ? (
        <Alert color="red" icon={<IconAlertTriangle size={18} />} title="Some server captures could not be retained">
          {captureQueue?.dropped ? `Dropped: ${formatCount(captureQueue.dropped)}. ` : ""}
          {captureSpool?.writeFailures ? `Disk write failures: ${formatCount(captureSpool.writeFailures)}. ` : ""}
          {captureSpool?.malformedDiscarded ? `Malformed spool records discarded: ${formatCount(captureSpool.malformedDiscarded)}.` : ""}
        </Alert>
      ) : captureBacklog > 0 ? (
        <Alert color="orange" icon={<IconAlertTriangle size={18} />} title="Captured errors are waiting for database replay">
          {formatCount(captureBacklog)} durable sample{captureBacklog === 1 ? " is" : "s are"} queued on disk.
          {captureSpool?.retainedForRetry ? ` ${formatCount(captureSpool.retainedForRetry)} could not be replayed yet.` : ""}
        </Alert>
      ) : null}

      <Paper withBorder radius="xl" p={isMobile ? "md" : "lg"}>
        <Stack gap="md">
          <Group justify="space-between" align="center">
            <Group gap="xs">
              <ThemeIcon variant="light" color="blue" radius="xl"><IconFilter size={17} /></ThemeIcon>
              <Text fw={800}>Filters</Text>
              {hasFilters ? <Badge variant="light" color="blue">Active</Badge> : null}
            </Group>
            {hasFilters ? <Button variant="subtle" color="gray" size="xs" onClick={clearFilters}>Reset</Button> : null}
          </Group>
          <div className={styles.filterGrid}>
            <TextInput
              label="Search"
              placeholder="Message, error reference, route or request ID"
              leftSection={<IconSearch size={16} />}
              value={search}
              onChange={(event) => changeFilter(setSearch, event.currentTarget.value)}
            />
            <MultiSelect label="Status" placeholder="All statuses" data={STATUS_OPTIONS} value={statuses} onChange={(value) => changeFilter(setStatuses, value as ErrorMonitoringStatus[])} clearable />
            <MultiSelect label="Severity" placeholder="All severities" data={SEVERITY_OPTIONS} value={severities} onChange={(value) => changeFilter(setSeverities, value as ErrorMonitoringSeverity[])} clearable />
            <MultiSelect label="Source" placeholder="All sources" data={sourceOptions} value={sources} onChange={(value) => changeFilter(setSources, value)} clearable searchable />
          </div>
          <div className={styles.filterGridSecondary}>
            <Select label="User" placeholder="All users" data={activeUserOptions} value={userId} onChange={(value) => changeFilter(setUserId, value)} clearable searchable leftSection={<IconUser size={16} />} />
            <TextInput label="Page / route" placeholder="/bookings or /api/..." value={pagePath} onChange={(event) => changeFilter(setPagePath, event.currentTarget.value)} leftSection={<IconWorld size={16} />} />
            <TextInput label="Release" placeholder="Git SHA or web build" value={release} onChange={(event) => changeFilter(setRelease, event.currentTarget.value)} />
            <TextInput label="Environment" placeholder="production" value={environment} onChange={(event) => changeFilter(setEnvironment, event.currentTarget.value)} />
            <TextInput label="From" type="date" value={dateFrom} onChange={(event) => changeFilter(setDateFrom, event.currentTarget.value)} />
            <TextInput label="To" type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => changeFilter(setDateTo, event.currentTarget.value)} />
            <Select label="Sort" data={[...SORT_OPTIONS]} value={sortValue} allowDeselect={false} onChange={(value) => changeFilter(setSortValue, value ?? "lastSeenAt:desc")} />
          </div>
          {kindOptions.length > 1 ? (
            <MultiSelect label="Error kind" placeholder="All error kinds" data={kindOptions} value={kinds} onChange={(value) => changeFilter(setKinds, value)} clearable searchable />
          ) : null}
        </Stack>
      </Paper>

      <Paper withBorder radius="xl" className={styles.tableShell}>
        <Group justify="space-between" p={isMobile ? "md" : "lg"} pb="sm">
          <Box>
            <Title order={2} size="h3">Issues</Title>
            <Text size="sm" c="dimmed">
              {pagination ? `${formatCount(pagination.total)} grouped issue${pagination.total === 1 ? "" : "s"}` : "Loading grouped issues"}
            </Text>
          </Box>
          {summary?.generatedAt ? (
            <Tooltip label={formatTimestamp(summary.generatedAt)}>
              <Badge variant="dot" color={issuesQuery.isFetching ? "blue" : "teal"}>
                {issuesQuery.isFetching ? "Updating" : "Live"}
              </Badge>
            </Tooltip>
          ) : null}
        </Group>

        {listActionError ? (
          <Alert
            mx={isMobile ? "md" : "lg"}
            mb="sm"
            color="red"
            icon={<IconAlertCircle size={18} />}
            title="Unable to update issue"
            withCloseButton
            onClose={() => setListActionError(null)}
          >
            {listActionError}
          </Alert>
        ) : null}

        {issuesQuery.isLoading ? (
          <Center mih={260}><Loader variant="dots" /></Center>
        ) : issuesQuery.isError ? (
          <Alert m="lg" color="red" icon={<IconAlertTriangle size={18} />} title="Issues unavailable">
            <Stack gap="sm">
              <Text size="sm">{getErrorMessage(issuesQuery.error)}</Text>
              <Button variant="light" color="red" onClick={() => void issuesQuery.refetch()}>Try again</Button>
            </Stack>
          </Alert>
        ) : issues.length === 0 ? (
          <Center mih={280} p="xl">
            <Stack align="center" gap="sm" ta="center">
              <ThemeIcon size={58} radius="xl" color="teal" variant="light"><IconShieldCheck size={30} /></ThemeIcon>
              <Text fw={800} size="lg">No matching issues</Text>
              <Text size="sm" c="dimmed" maw={430}>
                {hasFilters ? "No errors match the current filters." : "No monitored errors have been recorded."}
              </Text>
              {hasFilters ? <Button variant="light" onClick={clearFilters}>Clear filters</Button> : null}
            </Stack>
          </Center>
        ) : (
          <>
            <div className={styles.desktopOnly}>
              <ScrollArea>
                <Table highlightOnHover verticalSpacing="md" horizontalSpacing="lg" className={styles.issuesTable}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Issue</Table.Th>
                      <Table.Th>Source</Table.Th>
                      <Table.Th>Status</Table.Th>
                      <Table.Th ta="center">Weighted events</Table.Th>
                      <Table.Th ta="center">Users</Table.Th>
                      <Table.Th>First seen</Table.Th>
                      <Table.Th>Last seen</Table.Th>
                      {moduleAccess.canUpdate ? (
                        <Table.Th ta="center" className={styles.actionsHeader}>Actions</Table.Th>
                      ) : null}
                      <Table.Th aria-label="Open" className={styles.openHeader} />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {issues.map((issue) => (
                      <Table.Tr
                        key={issue.id}
                        className={styles.issueRow}
                        onClick={() => openIssue(issue.id)}
                      >
                        <Table.Td>
                          <Group gap="sm" wrap="nowrap">
                            <SeverityBadge severity={issue.severity} />
                            <Box className={styles.issueTitle}>
                              <Text fw={750} lineClamp={2} className={styles.breakAnywhere}>{issue.title}</Text>
                              <IssueLocation issue={issue} />
                            </Box>
                          </Group>
                        </Table.Td>
                        <Table.Td><SourceBadge source={issue.source} /></Table.Td>
                        <Table.Td><StatusBadge status={issue.status} /></Table.Td>
                        <Table.Td ta="center"><Text fw={750}>{formatCount(issue.occurrenceCount)}</Text></Table.Td>
                        <Table.Td ta="center"><Text fw={750}>{formatCount(issue.affectedUserCount)}</Text></Table.Td>
                        <Table.Td><Text size="sm" style={{ whiteSpace: "nowrap" }}>{formatShortTimestamp(issue.firstSeenAt)}</Text></Table.Td>
                        <Table.Td><Text size="sm" fw={650} style={{ whiteSpace: "nowrap" }}>{formatShortTimestamp(issue.lastSeenAt)}</Text></Table.Td>
                        {moduleAccess.canUpdate ? (
                          <Table.Td className={styles.actionsCell}>
                            <IssueQuickActions
                              issue={issue}
                              canUpdate={moduleAccess.canUpdate}
                              disabled={quickStatusMutation.isPending}
                              pendingStatus={
                                quickStatusMutation.isPending
                                && quickStatusMutation.variables?.issueId === issue.id
                                  ? quickStatusMutation.variables.status
                                  : null
                              }
                              onStatusChange={(status) => requestQuickStatusChange(issue, status)}
                            />
                          </Table.Td>
                        ) : null}
                        <Table.Td className={styles.openCell}>
                          <ActionIcon
                            variant="subtle"
                            aria-label={`Open ${issue.title}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              openIssue(issue.id);
                            }}
                          >
                            <IconChevronRight size={18} />
                          </ActionIcon>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </ScrollArea>
            </div>
            <div className={styles.mobileOnly}>
              <Stack p="md" pt={0} gap="sm">
                {issues.map((issue) => (
                  <MobileIssueCard
                    key={issue.id}
                    issue={issue}
                    onOpen={() => openIssue(issue.id)}
                    canUpdate={moduleAccess.canUpdate}
                    actionsDisabled={quickStatusMutation.isPending}
                    pendingStatus={
                      quickStatusMutation.isPending
                      && quickStatusMutation.variables?.issueId === issue.id
                        ? quickStatusMutation.variables.status
                        : null
                    }
                    onStatusChange={(status) => requestQuickStatusChange(issue, status)}
                  />
                ))}
              </Stack>
            </div>
          </>
        )}

        {pagination && pagination.totalPages > 1 ? (
          <Group justify="space-between" p={isMobile ? "md" : "lg"} pt="md" wrap="wrap">
            <Text size="sm" c="dimmed">Page {pagination.page} of {pagination.totalPages}</Text>
            <Pagination value={page} total={pagination.totalPages} onChange={setPage} size={isMobile ? "sm" : "md"} siblings={isMobile ? 0 : 1} />
          </Group>
        ) : null}
      </Paper>

      <Alert color="blue" variant="light" radius="xl" icon={<IconDeviceDesktop size={18} />}>
        Sensitive request bodies, passwords, tokens and personal form values are redacted before error context is stored.
      </Alert>

      <IssueDrawer
        issueId={selectedIssueId}
        onClose={closeIssue}
        activeUserOptions={activeUserOptions}
        onChanged={refresh}
        canUpdate={moduleAccess.canUpdate}
      />
    </Stack>
  );
};

const ErrorMonitoringPage = ({ title = "Error monitoring" }: Partial<GenericPageProps>) => {
  const dispatch = useAppDispatch();

  useEffect(() => {
    dispatch(navigateToPage("/error-monitoring"));
    document.title = title;
  }, [dispatch, title]);

  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <ErrorMonitoringDashboard title={title} />
    </PageAccessGuard>
  );
};

export default ErrorMonitoringPage;
