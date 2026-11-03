import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Code,
  Modal,
  Stack,
  Text,
  Textarea,
} from '@mantine/core';
import { api, activeJob, message, type Job } from './api';

export function SessionSignalDialog({
  targetId,
  session,
  terminate,
  onClose,
}: {
  targetId: string;
  session: Record<string, unknown>;
  terminate: boolean;
  onClose: () => void;
}) {
  const [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [pending, setPending] = useState<{
      input: Record<string, unknown>;
      token: string;
    }>(),
    [job, setJob] = useState<Job>();
  useEffect(() => {
    if (!job || !activeJob(job)) return;
    const timer = setInterval(
      () =>
        void api
          .job(job.id)
          .then(setJob)
          .catch((e) => setError(message(e))),
      750,
    );
    return () => clearInterval(timer);
  }, [job]);
  async function submit() {
    setBusy(true);
    setError('');
    try {
      if (pending) {
        setJob(
          await api.adminOperation({
            ...pending.input,
            action: 'execute',
            reviewToken: pending.token,
          }),
        );
        setPending(undefined);
      } else {
        const input = {
          targetId,
          kind: 'signal',
          terminate,
          reason,
          idempotencyKey: crypto.randomUUID(),
          session: {
            pid: Number(session.pid),
            backendStart: session.backend_start,
            queryStart: session.query_start,
            applicationName: session.application_name,
            user: session.usename,
          },
        };
        const review = await api.adminOperation(input);
        setPending({ input, token: review.token });
      }
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      opened
      onClose={() => !busy && onClose()}
      title={terminate ? 'Terminate database session' : 'Cancel running query'}
      centered
      size="lg"
    >
      <Stack>
        <Alert color="orange">
          {terminate
            ? 'Termination disconnects this backend and rolls back its open transaction.'
            : 'Cancellation interrupts its current query; an open transaction may require rollback.'}{' '}
          The backend start, query start, user and application must still match
          at execution.
        </Alert>
        <Text size="sm">
          PID {String(session.pid)} · {String(session.usename)} ·{' '}
          {String(session.application_name)}
        </Text>
        <Code block>{String(session.query || '')}</Code>
        <Textarea
          label="Reason"
          required
          value={reason}
          disabled={Boolean(pending) || Boolean(job)}
          onChange={(e) => setReason(e.currentTarget.value)}
        />
        {error && <Alert color="red">{error}</Alert>}
        {job ? (
          <Alert color={job.status === 'succeeded' ? 'teal' : 'orange'}>
            {job.status.replace(/_/g, ' ')} · {job.transactionOutcome}
            {job.error && `: ${job.error.message}`}
          </Alert>
        ) : (
          <Button
            color="orange"
            disabled={reason.trim().length < 5}
            loading={busy}
            onClick={() => void submit()}
          >
            {pending ? 'Execute reviewed action' : 'Prepare review'}
          </Button>
        )}
      </Stack>
    </Modal>
  );
}
