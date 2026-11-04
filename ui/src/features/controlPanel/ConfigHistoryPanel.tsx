import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Card,
  Code,
  Group,
  Loader,
  Stack,
  Text,
} from '@mantine/core';
import { fetchConfigHistory } from '../../api/config';
export function ConfigHistoryPanel({ configKey }: { configKey: string }) {
  const history = useQuery({
    queryKey: ['config-history', configKey],
    queryFn: () => fetchConfigHistory(configKey),
    retry: false,
  });
  if (history.isLoading)
    return (
      <Group>
        <Loader size="xs" />
        <Text size="sm">Loading change history…</Text>
      </Group>
    );
  if (history.isError)
    return (
      <Alert color="red" title="Unable to load history">
        <Button
          size="xs"
          variant="light"
          onClick={() => void history.refetch()}
        >
          Retry
        </Button>
      </Alert>
    );
  return (
    <Stack gap="sm">
      {!history.data?.length && (
        <Text size="sm" c="dimmed">
          No changes have been recorded for this setting.
        </Text>
      )}
      {history.data?.map((entry) => (
        <Card key={entry.id} withBorder padding="sm">
          <Stack gap="xs">
            <Group justify="space-between">
              <Text size="sm" fw={600}>
                {new Date(entry.createdAt).toLocaleString()}
              </Text>
              <Badge size="xs" variant="light">
                {entry.actorId == null ? 'System' : `User #${entry.actorId}`}
              </Badge>
            </Group>
            <Text size="sm">{entry.reason || 'No reason recorded'}</Text>
            {entry.isSecret ? (
              <Text size="xs" c="dimmed">
                Secret updated. Values are never shown in history.
              </Text>
            ) : (
              <details>
                <summary style={{ cursor: 'pointer' }}>View change</summary>
                <Stack gap={4} mt="xs">
                  <Text size="xs" fw={600}>
                    Before
                  </Text>
                  <Code block className="cp-history-value">
                    {entry.oldValue ?? 'Not set'}
                  </Code>
                  <Text size="xs" fw={600}>
                    After
                  </Text>
                  <Code block className="cp-history-value">
                    {entry.newValue ?? 'Not set'}
                  </Code>
                </Stack>
              </details>
            )}
          </Stack>
        </Card>
      ))}
    </Stack>
  );
}
