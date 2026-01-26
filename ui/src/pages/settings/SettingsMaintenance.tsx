import { useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconAlertCircle, IconDatabase, IconRefresh, IconSettings, IconTerminal2 } from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";
import { PageAccessGuard } from "../../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../../constants/pageSlugs";
import { restoreConfigDefaults } from "../../api/config";
import {
  runMaintenanceCommand,
  useConfigSeedRuns,
  useMigrationAuditRuns,
  type MaintenanceCommandAction,
  type MaintenanceCommandResult,
} from "../../api/maintenance";

const PAGE_SLUG = PAGE_SLUGS.settingsMaintenance;

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

const formatDateTime = (value: string | null): string => {
  if (!value) {
    return "—";
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
};

const statusColor = (status: string): string => {
  const normalized = status.toLowerCase();
  if (normalized === "success") {
    return "green";
  }
  if (normalized === "failed") {
    return "red";
  }
  if (normalized === "running") {
    return "yellow";
  }
  if (normalized === "warning") {
    return "orange";
  }
  return "gray";
};

const SettingsMaintenance = () => {
  const navigate = useNavigate();
  const seedRunsQuery = useConfigSeedRuns(5);
  const migrationRunsQuery = useMigrationAuditRuns(5);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restorePassword, setRestorePassword] = useState("");
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreResult, setRestoreResult] = useState<{ seededCount: number; seededKeys: string[] } | null>(null);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [commandRunning, setCommandRunning] = useState<MaintenanceCommandAction | null>(null);
  const [commandResult, setCommandResult] = useState<MaintenanceCommandResult | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);

  const seedRuns = useMemo(() => seedRunsQuery.data ?? [], [seedRunsQuery.data]);
  const migrationRuns = useMemo(() => migrationRunsQuery.data ?? [], [migrationRunsQuery.data]);

  const handleRestoreDefaults = async () => {
    if (!restorePassword.trim()) {
      setRestoreError("Enter your password to restore missing defaults.");
      return;
    }
    setRestoreError(null);
    setRestoreLoading(true);
    try {
      const result = await restoreConfigDefaults(restorePassword.trim());
      setRestoreResult(result);
      setRestorePassword("");
      setRestoreOpen(false);
      await seedRunsQuery.refetch();
    } catch (err) {
      setRestoreError(extractErrorMessage(err));
    } finally {
      setRestoreLoading(false);
    }
  };

  const handleRunCommand = async (action: MaintenanceCommandAction) => {
    setCommandRunning(action);
    setCommandError(null);
    setCommandResult(null);
    try {
      const result = await runMaintenanceCommand(action);
      setCommandResult(result);
    } catch (err) {
      setCommandError(extractErrorMessage(err));
    } finally {
      setCommandRunning(null);
    }
  };

  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <Stack gap="xl">
        <Stack gap={6}>
          <Title order={3}>Maintenance</Title>
          <Text size="sm" c="dimmed">
            Track configuration seeds and migration health from one place.
          </Text>
        </Stack>

        <Card withBorder padding="lg" radius="md">
          <Stack gap="xs">
            <Group justify="space-between">
              <Group gap="sm">
                <IconSettings size={20} />
                <Title order={4}>Control Panel</Title>
              </Group>
              <Button variant="light" onClick={() => navigate("/settings/control-panel")}>
                Open control panel
              </Button>
            </Group>
            <Text size="sm" c="dimmed">
              Update runtime configuration values and manage secrets for the platform.
            </Text>
          </Stack>
        </Card>

        <Card withBorder padding="lg" radius="md">
          <Stack gap="md">
            <Stack gap={4}>
              <Group gap="sm">
                <IconTerminal2 size={20} />
                <Title order={4}>Maintenance Commands</Title>
              </Group>
              <Text size="sm" c="dimmed">
                Run routine maintenance scripts from the server. These commands execute on the host running the API.
              </Text>
            </Stack>

            <Group align="flex-start" wrap="wrap">
              <Button
                variant="light"
                leftSection={<IconRefresh size={16} />}
                loading={commandRunning === "git-pull"}
                onClick={() => handleRunCommand("git-pull")}
              >
                Git Pull (master)
              </Button>
              <Button
                variant="light"
                leftSection={<IconDatabase size={16} />}
                loading={commandRunning === "migrate-prod"}
                onClick={() => handleRunCommand("migrate-prod")}
              >
                Run Migrate (prod)
              </Button>
              <Button
                variant="light"
                leftSection={<IconSettings size={16} />}
                loading={commandRunning === "sync-access-control-prod"}
                onClick={() => handleRunCommand("sync-access-control-prod")}
              >
                Sync Access Control (prod)
              </Button>
            </Group>

            {commandError ? (
              <Alert color="red" icon={<IconAlertCircle size={16} />}>
                {commandError}
              </Alert>
            ) : null}

            {commandResult ? (
              <Alert color={commandResult.status === "success" ? "teal" : "red"}>
                <Stack gap={6}>
                  <Text size="sm">
                    {commandResult.action} {commandResult.status} (exit {commandResult.exitCode ?? "n/a"})
                  </Text>
                  {commandResult.stdout ? (
                    <Text size="xs" style={{ whiteSpace: "pre-wrap" }}>
                      {commandResult.stdout}
                    </Text>
                  ) : null}
                  {commandResult.stderr ? (
                    <Text size="xs" c="red" style={{ whiteSpace: "pre-wrap" }}>
                      {commandResult.stderr}
                    </Text>
                  ) : null}
                </Stack>
              </Alert>
            ) : null}
          </Stack>
        </Card>

        <Card withBorder padding="lg" radius="md">
          <Stack gap="md">
            <Group justify="space-between" align="flex-start">
              <Stack gap={4}>
                <Group gap="sm">
                  <IconRefresh size={20} />
                  <Title order={4}>Config Seeds</Title>
                </Group>
                <Text size="sm" c="dimmed">
                  Review recent seed runs and restore any missing defaults.
                </Text>
              </Stack>
              <Button
                variant="light"
                color="orange"
                leftSection={<IconRefresh size={16} />}
                onClick={() => {
                  setRestoreError(null);
                  setRestoreOpen(true);
                }}
              >
                Restore missing defaults
              </Button>
            </Group>

            {seedRunsQuery.isError ? (
              <Alert color="red" icon={<IconAlertCircle size={16} />}>
                {extractErrorMessage(seedRunsQuery.error)}
              </Alert>
            ) : null}

            {restoreResult ? (
              <Alert color="teal" icon={<IconRefresh size={16} />}>
                <Stack gap={4}>
                  <Text size="sm">
                    {restoreResult.seededCount > 0
                      ? `Restored ${restoreResult.seededCount} missing value${restoreResult.seededCount === 1 ? "" : "s"}.`
                      : "No missing configuration values were restored."}
                  </Text>
                  {restoreResult.seededKeys.length > 0 ? (
                    <Text size="xs" c="dimmed">
                      {restoreResult.seededKeys.join(", ")}
                    </Text>
                  ) : null}
                </Stack>
              </Alert>
            ) : null}

            <Table striped highlightOnHover withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Run type</Table.Th>
                  <Table.Th>Seeded</Table.Th>
                  <Table.Th>Actor</Table.Th>
                  <Table.Th>Created</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {seedRunsQuery.isLoading ? (
                  <Table.Tr>
                    <Table.Td colSpan={4}>
                      <Text size="sm" c="dimmed">
                        Loading seed history...
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ) : seedRuns.length === 0 ? (
                  <Table.Tr>
                    <Table.Td colSpan={4}>
                      <Text size="sm" c="dimmed">
                        No seed runs recorded yet.
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ) : (
                  seedRuns.map((run) => (
                    <Table.Tr key={run.id}>
                      <Table.Td>
                        <Badge variant="light">{run.runType}</Badge>
                      </Table.Td>
                      <Table.Td>{run.seededCount}</Table.Td>
                      <Table.Td>{run.seededBy ?? "System"}</Table.Td>
                      <Table.Td>{formatDateTime(run.createdAt)}</Table.Td>
                    </Table.Tr>
                  ))
                )}
              </Table.Tbody>
            </Table>
          </Stack>
        </Card>

        <Card withBorder padding="lg" radius="md">
          <Stack gap="md">
            <Stack gap={4}>
              <Group gap="sm">
                <IconDatabase size={20} />
                <Title order={4}>Migrations</Title>
              </Group>
              <Text size="sm" c="dimmed">
                Latest migration runs from the audit log.
              </Text>
            </Stack>

            {migrationRunsQuery.isError ? (
              <Alert color="red" icon={<IconAlertCircle size={16} />}>
                {extractErrorMessage(migrationRunsQuery.error)}
              </Alert>
            ) : null}

            <Table striped highlightOnHover withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Direction</Table.Th>
                  <Table.Th>Steps</Table.Th>
                  <Table.Th>Started</Table.Th>
                  <Table.Th>Finished</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {migrationRunsQuery.isLoading ? (
                  <Table.Tr>
                    <Table.Td colSpan={5}>
                      <Text size="sm" c="dimmed">
                        Loading migration audit history...
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ) : migrationRuns.length === 0 ? (
                  <Table.Tr>
                    <Table.Td colSpan={5}>
                      <Text size="sm" c="dimmed">
                        No migration runs recorded yet.
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ) : (
                  migrationRuns.map((run) => (
                    <Table.Tr key={`${run.runId}-${run.direction}`}>
                      <Table.Td>
                        <Badge color={statusColor(run.status)} variant="light">
                          {run.status}
                        </Badge>
                        {run.failedSteps > 0 ? (
                          <Text size="xs" c="dimmed">
                            {run.failedSteps} failed step{run.failedSteps === 1 ? "" : "s"}
                          </Text>
                        ) : null}
                      </Table.Td>
                      <Table.Td>{run.direction}</Table.Td>
                      <Table.Td>{run.stepCount}</Table.Td>
                      <Table.Td>{formatDateTime(run.startedAt)}</Table.Td>
                      <Table.Td>{formatDateTime(run.finishedAt)}</Table.Td>
                    </Table.Tr>
                  ))
                )}
              </Table.Tbody>
            </Table>
          </Stack>
        </Card>
      </Stack>

      <Modal
        opened={restoreOpen}
        onClose={() => {
          if (restoreLoading) {
            return;
          }
          setRestoreOpen(false);
          setRestorePassword("");
          setRestoreError(null);
        }}
        title="Restore missing defaults"
        centered
        size="md"
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            This will insert any missing configuration values from defaults or environment fallback values.
          </Text>
          <TextInput
            label="Password confirmation"
            type="password"
            value={restorePassword}
            onChange={(event) => setRestorePassword(event.currentTarget.value)}
            placeholder="Enter your password"
          />
          {restoreError ? (
            <Alert color="red" icon={<IconAlertCircle size={16} />}>
              {restoreError}
            </Alert>
          ) : null}
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => {
                if (restoreLoading) {
                  return;
                }
                setRestoreOpen(false);
                setRestorePassword("");
                setRestoreError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              color="orange"
              leftSection={<IconRefresh size={16} />}
              onClick={handleRestoreDefaults}
              loading={restoreLoading}
            >
              Restore
            </Button>
          </Group>
        </Stack>
      </Modal>
    </PageAccessGuard>
  );
};

export default SettingsMaintenance;
