import {
  Alert,
  Anchor,
  Button,
  Card,
  Group,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconExternalLink,
  IconRefresh,
  IconRocket,
} from "@tabler/icons-react";
import { PageAccessGuard } from "../../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../../constants/pageSlugs";
import { useRuntimeReleaseStatus } from "../../api/maintenance";
import { MigrationRunHistory } from "../../features/maintenance/MigrationRunHistory";
const PAGE_SLUG = PAGE_SLUGS.settingsMaintenance;
const GITHUB_REPOSITORY_URL = "https://github.com/pablo-dryfield/omni-lodge";
const RELEASE_ID_PATTERN = /^omnilodge-r(\d+)-a(\d+)-([a-f0-9]{12})$/i;
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
        if (
          first &&
          typeof first === "object" &&
          "message" in first &&
          typeof first.message === "string"
        ) {
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

const formatUptime = (seconds: number | null | undefined): string => {
  if (!Number.isFinite(seconds ?? NaN)) {
    return "—";
  }
  const totalSeconds = Math.max(0, Math.floor(seconds ?? 0));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
};

const SettingsMaintenance = () => {
  const releaseStatusQuery = useRuntimeReleaseStatus();
  const releaseStatus = releaseStatusQuery.data ?? null;
  const releaseInfo = releaseStatus?.release ?? null;
  const releaseMatch = releaseInfo?.id
    ? RELEASE_ID_PATTERN.exec(releaseInfo.id)
    : null;
  const releaseRunId = releaseMatch?.[1] ?? null;
  const releaseRunAttempt = releaseMatch?.[2] ?? null;
  const releaseRunUrl = releaseRunId
    ? `${GITHUB_REPOSITORY_URL}/actions/runs/${releaseRunId}`
    : null;
  const releaseAttemptUrl =
    releaseRunUrl && releaseRunAttempt
      ? `${releaseRunUrl}/attempts/${releaseRunAttempt}`
      : releaseRunUrl;
  const commitUrl = releaseInfo?.gitSha
    ? `${GITHUB_REPOSITORY_URL}/commit/${encodeURIComponent(releaseInfo.gitSha)}`
    : null;
  const deployWorkflowUrl = `${GITHUB_REPOSITORY_URL}/actions/workflows/deploy-production.yml`;
  const rollbackWorkflowUrl = `${GITHUB_REPOSITORY_URL}/actions/workflows/rollback-production.yml`;
  const releasesUrl = `${GITHUB_REPOSITORY_URL}/actions/workflows/release.yml`;
  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <Stack gap="xl">
        <Stack gap={6}>
          <Title order={3}>Maintenance</Title>
          <Text size="sm" c="dimmed">
            Production release status and detailed migration history.
          </Text>
        </Stack>
        <Card withBorder padding="lg" radius="md">
          <Stack gap="md">
            <Group justify="space-between" align="flex-start">
              <Stack gap={4}>
                <Group gap="sm">
                  <IconRocket size={20} />
                  <Title order={4}>Release status</Title>
                </Group>
                <Text size="sm" c="dimmed">
                  Read-only production artifact information and GitHub workflow
                  links.
                </Text>
              </Stack>
              <Button
                variant="light"
                leftSection={<IconRefresh size={16} />}
                loading={releaseStatusQuery.isFetching}
                onClick={() => releaseStatusQuery.refetch()}
              >
                Refresh
              </Button>
            </Group>

            {releaseStatusQuery.isError ? (
              <Alert color="red" icon={<IconAlertCircle size={16} />}>
                {extractErrorMessage(releaseStatusQuery.error)}
              </Alert>
            ) : null}

            <Group align="stretch" gap="md" wrap="wrap">
              <Card
                withBorder
                radius="md"
                padding="sm"
                style={{ flex: "1 1 260px" }}
              >
                <Stack gap={4}>
                  <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                    Current release
                  </Text>
                  <Text size="sm" fw={700} style={{ wordBreak: "break-word" }}>
                    {releaseInfo?.id ?? "Unknown"}
                  </Text>
                  <Text size="xs" c="dimmed">
                    Runtime mode: {releaseInfo?.runtimeMode ?? "—"}
                  </Text>
                </Stack>
              </Card>
              <Card
                withBorder
                radius="md"
                padding="sm"
                style={{ flex: "1 1 220px" }}
              >
                <Stack gap={4}>
                  <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                    Source SHA
                  </Text>
                  <Text size="sm" fw={700} style={{ wordBreak: "break-word" }}>
                    {releaseInfo?.gitSha ?? "Unknown"}
                  </Text>
                  <Text size="xs" c="dimmed">
                    Uptime: {formatUptime(releaseStatus?.uptimeSeconds)}
                  </Text>
                </Stack>
              </Card>
            </Group>

            <Group gap="sm" wrap="wrap">
              {releaseAttemptUrl ? (
                <Button
                  component="a"
                  href={releaseAttemptUrl}
                  target="_blank"
                  rel="noreferrer"
                  variant="light"
                  leftSection={<IconExternalLink size={16} />}
                >
                  Release run
                </Button>
              ) : null}
              {commitUrl ? (
                <Button
                  component="a"
                  href={commitUrl}
                  target="_blank"
                  rel="noreferrer"
                  variant="light"
                  leftSection={<IconExternalLink size={16} />}
                >
                  Source commit
                </Button>
              ) : null}
              <Button
                component="a"
                href={deployWorkflowUrl}
                target="_blank"
                rel="noreferrer"
                variant="light"
                leftSection={<IconExternalLink size={16} />}
              >
                Production deploys
              </Button>
              <Button
                component="a"
                href={rollbackWorkflowUrl}
                target="_blank"
                rel="noreferrer"
                variant="light"
                leftSection={<IconExternalLink size={16} />}
              >
                Rollbacks
              </Button>
              <Anchor
                href={releasesUrl}
                target="_blank"
                rel="noreferrer"
                size="sm"
              >
                All release workflow runs
              </Anchor>
            </Group>

            {!releaseAttemptUrl ? (
              <Text size="xs" c="dimmed">
                Exact Release-run link is available when the current release ID
                follows the managed artifact format.
              </Text>
            ) : null}
          </Stack>
        </Card>

        <MigrationRunHistory />
      </Stack>
    </PageAccessGuard>
  );
};
export default SettingsMaintenance;
