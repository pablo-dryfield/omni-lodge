import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Group,
  SimpleGrid,
  Stack,
  Switch,
  Tabs,
  Text,
} from '@mantine/core';
import { api, message } from './api';
import { RecordTable } from './RecordTable';
import { SessionSignalDialog } from './SessionSignalDialog';

export function ActivityPanel({ targetId }: { targetId: string }) {
  const [automatic, setAutomatic] = useState(false);
  const [signal, setSignal] = useState<{
    session: Record<string, unknown>;
    terminate: boolean;
  }>();
  const capabilities = useQuery({
    queryKey: ['database-workspace-capabilities'],
    queryFn: api.capabilities,
  });
  const refreshSeconds = capabilities.data?.activityRefreshSeconds || 10;
  const snapshot = useQuery({
    queryKey: ['dw-activity', targetId],
    queryFn: () => api.activity(targetId),
    enabled: Boolean(targetId),
    refetchInterval: automatic ? refreshSeconds * 1000 : false,
    refetchIntervalInBackground: false,
    retry: false,
  });
  const data = snapshot.data,
    identity = data?.identity as Record<string, unknown> | undefined,
    database = data?.database as Record<string, unknown> | undefined,
    workload = data?.workload as
      | {
          available: boolean;
          reason?: string;
          reset?: string;
          rows: Record<string, unknown>[];
        }
      | undefined;
  return (
    <div className="dw-pane">
      <Group justify="space-between" mb="md">
        <div>
          <Text fw={700}>Database activity & health</Text>
          <Text size="xs" c="dimmed">
            Snapshot {String(identity?.measured_at || 'not loaded')} · effective
            role {String(identity?.role || '—')}
          </Text>
        </div>
        <Group>
          <Switch
            label={`Refresh every ${refreshSeconds}s`}
            checked={automatic}
            onChange={(e) => setAutomatic(e.currentTarget.checked)}
          />
          <Button
            variant="light"
            size="xs"
            loading={snapshot.isFetching}
            onClick={() => void snapshot.refetch()}
          >
            Refresh
          </Button>
        </Group>
      </Group>
      {snapshot.error && <Alert color="red">{message(snapshot.error)}</Alert>}
      {identity && !identity.full_statistics && (
        <Alert color="orange" mb="md">
          The registered read role lacks pg_read_all_stats. PostgreSQL may hide
          other sessions’ details. Ask infrastructure administration to grant
          monitoring access.
        </Alert>
      )}
      {data && (
        <Stack>
          <SimpleGrid cols={{ base: 2, md: 4 }}>
            {[
              ['Connections', `${database?.numbackends || 0} in this database`],
              ['Cluster limit', String(identity?.max_connections || '—')],
              [
                'Database size',
                `${(Number(identity?.database_bytes || 0) / 1048576).toFixed(1)} MiB`,
              ],
              ['Deadlocks', String(database?.deadlocks || '0')],
            ].map(([label, value]) => (
              <div className="dw-card" key={label}>
                <Text size="xs" c="dimmed">
                  {label}
                </Text>
                <Text fw={600}>{value}</Text>
              </div>
            ))}
          </SimpleGrid>
          <Text size="xs" c="dimmed">
            {String(data.semantics)} Counters reset{' '}
            {String(database?.stats_reset || 'unknown')}.
          </Text>
          <Tabs defaultValue="sessions">
            <Tabs.List style={{ flexWrap: 'wrap' }}>
              {[
                'sessions',
                'locks',
                'tables',
                'indexes',
                'workload',
                'progress',
              ].map((name) => (
                <Tabs.Tab key={name} value={name}>
                  {name[0].toUpperCase() + name.slice(1)}
                </Tabs.Tab>
              ))}
            </Tabs.List>
            {['sessions', 'locks', 'tables', 'indexes'].map((name) => (
              <Tabs.Panel key={name} value={name} pt="md">
                <RecordTable
                  rows={(data[name] || []) as Record<string, unknown>[]}
                  label={name}
                  actions={
                    name === 'sessions'
                      ? (row) => (
                          <Group gap={4}>
                            {capabilities.data?.actions.cancelOthers && (
                              <Button
                                size="compact-xs"
                                variant="light"
                                onClick={() =>
                                  setSignal({ session: row, terminate: false })
                                }
                              >
                                Cancel query
                              </Button>
                            )}
                            {capabilities.data?.actions.terminate && (
                              <Button
                                size="compact-xs"
                                color="orange"
                                variant="light"
                                onClick={() =>
                                  setSignal({ session: row, terminate: true })
                                }
                              >
                                Terminate
                              </Button>
                            )}
                          </Group>
                        )
                      : undefined
                  }
                />
              </Tabs.Panel>
            ))}
            <Tabs.Panel value="workload" pt="md">
              {workload?.available ? (
                <>
                  <Badge variant="light" mb="sm">
                    Cumulative since {workload.reset || 'unknown reset'}
                  </Badge>
                  <RecordTable
                    rows={workload.rows}
                    label="Workload statistics"
                  />
                </>
              ) : (
                <Alert color="blue">{workload?.reason}</Alert>
              )}
            </Tabs.Panel>
            <Tabs.Panel value="progress" pt="md">
              <Stack>
                {Object.entries(
                  (data.progress as Record<
                    string,
                    Record<string, unknown>[]
                  >) || {},
                ).map(([view, rows]) => (
                  <div key={view}>
                    <Text size="sm" fw={600} mb="sm">
                      {view.replace('pg_stat_progress_', '')}
                    </Text>
                    <RecordTable rows={rows} label={view} />
                  </div>
                ))}
              </Stack>
            </Tabs.Panel>
          </Tabs>
        </Stack>
      )}
      {signal && (
        <SessionSignalDialog
          targetId={targetId}
          {...signal}
          onClose={() => {
            setSignal(undefined);
            void snapshot.refetch();
          }}
        />
      )}
    </div>
  );
}
