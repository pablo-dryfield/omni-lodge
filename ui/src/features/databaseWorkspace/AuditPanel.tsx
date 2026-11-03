import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Code,
  Group,
  Modal,
  Stack,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { api, activeJob, message, type Job } from './api';
import { RecordTable } from './RecordTable';
export function AuditPanel() {
  const [cursor, setCursor] = useState<string>(),
    [id, setId] = useState(''),
    [job, setJob] = useState<Job>(),
    [reason, setReason] = useState(''),
    [error, setError] = useState('');
  const audit = useQuery({
    queryKey: ['dw-audit', cursor],
    queryFn: () => api.audit(cursor),
    retry: false,
  });
  return (
    <Stack>
      {(error || audit.error) && (
        <Alert color="red">{error || message(audit.error)}</Alert>
      )}
      <Group justify="space-between">
        <Text size="sm">Protected execution and administration audit</Text>
        <Button
          size="xs"
          variant="light"
          onClick={() => {
            setCursor(undefined);
            void audit.refetch();
          }}
        >
          Latest events
        </Button>
      </Group>
      <Text size="xs" c="dimmed">
        Restricted administrators can inspect cross-user job outcomes. Result
        rows and credentials are not exposed through this audit. A
        PostgreSQL/infrastructure superuser is outside the audit protection
        boundary.
      </Text>
      <RecordTable rows={audit.data || []} label="Database Workspace audit" />
      <Button
        size="xs"
        variant="default"
        disabled={!audit.data?.length}
        onClick={() =>
          setCursor(String(audit.data![audit.data!.length - 1].id))
        }
      >
        Load older events
      </Button>
      <Group align="end">
        <TextInput
          label="Inspect execution ID"
          value={id}
          onChange={(e) => setId(e.currentTarget.value)}
          style={{ flex: 1 }}
        />
        <Button
          onClick={() =>
            void api
              .adminJob(id)
              .then(setJob)
              .catch((e) => setError(message(e)))
          }
        >
          Inspect job
        </Button>
      </Group>
      <Modal
        opened={Boolean(job)}
        onClose={() => setJob(undefined)}
        title="Execution audit"
        size="xl"
      >
        <Stack>
          {job && (
            <>
              <Text size="sm">
                {job.summary} · owner #{job.actorId} · {job.targetId} ·{' '}
                {job.status} · {job.transactionOutcome}
              </Text>
              {job.error && <Alert color="red">{job.error.message}</Alert>}
              {job.outcomes.map((o) => (
                <Code block key={o.index}>
                  {o.sql}
                </Code>
              ))}
              {activeJob(job) && (
                <>
                  <Textarea
                    label="Reason for cancelling another administrator’s job"
                    value={reason}
                    onChange={(e) => setReason(e.currentTarget.value)}
                  />
                  <Group>
                    <Button
                      variant="default"
                      onClick={() => void api.adminJob(job.id).then(setJob)}
                    >
                      Refresh status
                    </Button>
                    <Button
                      color="red"
                      disabled={reason.trim().length < 5}
                      onClick={() =>
                        void api
                          .adminCancel(job.id, reason)
                          .then(setJob)
                          .catch((e) => setError(message(e)))
                      }
                    >
                      Request cancellation
                    </Button>
                  </Group>
                </>
              )}
            </>
          )}
        </Stack>
      </Modal>
    </Stack>
  );
}
