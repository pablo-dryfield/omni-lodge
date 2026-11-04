import { Fragment, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Code,
  Group,
  Loader,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import {
  IconChevronDown,
  IconChevronRight,
  IconDatabase,
  IconRefresh,
} from '@tabler/icons-react';
import {
  fetchMigrationAuditDetails,
  useMigrationAuditRuns,
  type MigrationAuditRun,
  type MigrationAuditStep,
} from '../../api/maintenance';
const date = (value: string | null) =>
  value ? new Date(value).toLocaleString() : '—';
const color = (status: string) =>
  ({ success: 'green', failed: 'red', running: 'yellow', warning: 'orange' })[
    status.toLowerCase()
  ] || 'gray';
const duration = (start: string, end: string | null) => {
  if (!end) return 'In progress';
  const milliseconds = new Date(end).getTime() - new Date(start).getTime();
  return Number.isFinite(milliseconds)
    ? `${(Math.max(0, milliseconds) / 1000).toLocaleString()} s`
    : '—';
};
function MigrationStep({ step }: { step: MigrationAuditStep }) {
  const source = /^[\w.-]+\.(?:ts|js)$/.test(step.migrationName)
    ? `https://github.com/pablo-dryfield/omni-lodge/blob/master/be/src/migrations/${encodeURIComponent(step.migrationName.replace(/\.js$/, '.ts'))}`
    : null;
  return (
    <details
      open={step.status === 'failed'}
      style={{
        border: '1px solid var(--mantine-color-default-border)',
        borderRadius: 8,
        padding: 12,
      }}
    >
      <summary style={{ cursor: 'pointer', overflowWrap: 'anywhere' }}>
        <Text component="span" size="sm" fw={600}>
          {step.migrationName}
        </Text>{' '}
        <Badge size="xs" color={color(step.status)}>
          {step.status}
        </Badge>{' '}
        <Text component="span" size="xs" c="dimmed">
          {duration(step.startedAt, step.finishedAt)}
        </Text>
      </summary>
      <Stack gap="xs" mt="sm">
        <Text size="xs">
          Started: {date(step.startedAt)} · Finished: {date(step.finishedAt)}
        </Text>
        <Group gap="xs">
          <Text size="sm">Verification:</Text>
          <Badge color={color(step.verifyStatus || '')}>
            {step.verifyStatus || 'Not recorded'}
          </Badge>
          {source && (
            <Anchor href={source} target="_blank" rel="noreferrer" size="sm">
              View migration source
            </Anchor>
          )}
        </Group>
        {step.errorMessage && (
          <Alert color="red" title="Migration error">
            <Text
              size="sm"
              style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
            >
              {step.errorMessage}
            </Text>
          </Alert>
        )}
        {step.verifyDetails != null && (
          <>
            <Text size="xs" fw={600}>
              Verification details
            </Text>
            <Code
              block
              style={{
                maxHeight: 320,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
              }}
            >
              {JSON.stringify(step.verifyDetails, null, 2)}
            </Code>
          </>
        )}
        {step.errorStack && (
          <details>
            <summary style={{ cursor: 'pointer' }}>Error stack</summary>
            <Code
              block
              style={{
                maxHeight: 320,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
              }}
            >
              {step.errorStack}
            </Code>
          </details>
        )}
      </Stack>
    </details>
  );
}
function RunDetails({ run }: { run: MigrationAuditRun }) {
  const details = useInfiniteQuery({
    queryKey: ['migration-audit-details', run.runId, run.direction],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      fetchMigrationAuditDetails(run.runId, run.direction, pageParam),
    getNextPageParam: (page) => page.nextOffset ?? undefined,
    staleTime: 60000,
    retry: false,
    refetchInterval: run.status === 'running' ? 5000 : false,
  });
  const steps = details.data?.pages.flatMap((p) => p.steps) || [];
  return (
    <Stack gap="sm" p="sm">
      <Text size="xs" c="dimmed" style={{ overflowWrap: 'anywhere' }}>
        Run {run.runId} · {run.nodeEnv || 'Unknown environment'} · Database:{' '}
        {run.dbName || 'Not recorded'} · Duration:{' '}
        {duration(run.startedAt, run.finishedAt)}
      </Text>
      <Text size="sm">
        {run.successSteps} successful · {run.failedSteps} failed ·{' '}
        {run.runningSteps} running
      </Text>
      {run.errorMessage && (
        <Alert color="red" title="Run error">
          {run.errorMessage}
        </Alert>
      )}
      {details.isLoading && (
        <Group>
          <Loader size="xs" />
          <Text size="sm">Loading migration details…</Text>
        </Group>
      )}
      {details.isError && (
        <Alert color="red" title="Unable to load migration details">
          <Button
            size="xs"
            variant="light"
            onClick={() => void details.refetch()}
          >
            Retry
          </Button>
        </Alert>
      )}
      {!details.isLoading && !details.isError && !steps.length && (
        <Text size="sm" c="dimmed">
          This run recorded no migration steps.
        </Text>
      )}
      {steps.map((step) => (
        <MigrationStep key={step.id} step={step} />
      ))}
      {details.hasNextPage && (
        <Button
          size="xs"
          variant="light"
          loading={details.isFetchingNextPage}
          onClick={() => void details.fetchNextPage()}
        >
          Load more migration steps
        </Button>
      )}
    </Stack>
  );
}
export function MigrationRunHistory() {
  const runs = useMigrationAuditRuns(25),
    [expanded, setExpanded] = useState<Set<string>>(new Set());
  return (
    <Card withBorder padding="lg" radius="md">
      <Stack gap="md">
        <Group justify="space-between">
          <Stack gap={4}>
            <Group gap="sm">
              <IconDatabase size={20} />
              <Title order={4}>Migrations</Title>
            </Group>
            <Text size="sm" c="dimmed">
              Latest migration runs. Expand a run for individual migrations,
              verification results, timing and errors.
            </Text>
          </Stack>
          <Button
            variant="light"
            leftSection={<IconRefresh size={16} />}
            loading={runs.isFetching}
            onClick={() => void runs.refetch()}
          >
            Refresh migrations
          </Button>
        </Group>
        {runs.isError && (
          <Alert color="red">
            Unable to load migration history. Try refreshing.
          </Alert>
        )}
        <Table.ScrollContainer minWidth={650}>
          <Table striped highlightOnHover withTableBorder>
            <Table.Thead>
              <Table.Tr>
                {[
                  'Status',
                  'Direction',
                  'Steps',
                  'Started',
                  'Finished',
                  'Details',
                ].map((label) => (
                  <Table.Th key={label}>{label}</Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(runs.isLoading || !runs.data?.length) && (
                <Table.Tr>
                  <Table.Td colSpan={6}>
                    <Text size="sm" c="dimmed">
                      {runs.isLoading
                        ? 'Loading migration history…'
                        : 'No migration runs recorded yet.'}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
              {runs.data?.map((run) => {
                const key = run.runId + '-' + run.direction,
                  open = expanded.has(key);
                return (
                  <Fragment key={key}>
                    <Table.Tr>
                      <Table.Td>
                        <Badge color={color(run.status)}>{run.status}</Badge>
                      </Table.Td>
                      <Table.Td>{run.direction}</Table.Td>
                      <Table.Td>{run.stepCount}</Table.Td>
                      <Table.Td>{date(run.startedAt)}</Table.Td>
                      <Table.Td>{date(run.finishedAt)}</Table.Td>
                      <Table.Td>
                        <Button
                          size="xs"
                          variant="subtle"
                          aria-expanded={open}
                          aria-controls={'migration-' + key}
                          aria-label={`${open ? 'Hide' : 'Show'} details for migration run ${run.runId}`}
                          leftSection={
                            open ? (
                              <IconChevronDown size={14} />
                            ) : (
                              <IconChevronRight size={14} />
                            )
                          }
                          onClick={() =>
                            setExpanded((previous) => {
                              const next = new Set(previous);
                              if (next.has(key)) next.delete(key);
                              else next.add(key);
                              return next;
                            })
                          }
                        >
                          {open ? 'Hide' : 'Details'}
                        </Button>
                      </Table.Td>
                    </Table.Tr>
                    {open && (
                      <Table.Tr>
                        <Table.Td colSpan={6}>
                          <div id={'migration-' + key}>
                            <RunDetails run={run} />
                          </div>
                        </Table.Td>
                      </Table.Tr>
                    )}
                  </Fragment>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Stack>
    </Card>
  );
}
