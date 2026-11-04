import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Group,
  Modal,
  Stack,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { api, activeJob, message, type Job } from './api';
export function DeleteBackupDialog({
  copy,
  targetId,
  onClose,
  onDone,
}: {
  copy: { id: string; filename: string; location: string };
  targetId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState(''),
    [permanent, setPermanent] = useState(false),
    [confirmation, setConfirmation] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<{
      input: Record<string, unknown>;
      review: { token: string; warning: string; permanent: boolean };
    }>(),
    [job, setJob] = useState<Job>();
  useEffect(() => {
    if (!job || !activeJob(job)) return;
    const timer = window.setInterval(
      () =>
        void api
          .job(job.id)
          .then(setJob)
          .catch((e) => setError(message(e))),
      700,
    );
    return () => clearInterval(timer);
  }, [job?.id, job?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (job && !activeJob(job)) onDone();
  }, [job?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  async function prepare() {
    setBusy(true);
    setError('');
    try {
      const input = {
        targetId,
        copyId: copy.id,
        permanent,
        reason,
        idempotencyKey: crypto.randomUUID(),
      };
      setPending({ input, review: await api.deleteBackup(input) });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!pending) return;
    setBusy(true);
    setError('');
    try {
      setJob(
        await api.deleteBackup({
          ...pending.input,
          action: 'delete',
          confirmFilename: confirmation,
          reviewToken: pending.review.token,
        }),
      );
      setPending(undefined);
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
      title={`Remove ${copy.location === 'local' ? 'server' : 'Google Drive'} backup copy`}
      centered
      size="lg"
    >
      <Stack>
        <Text fw={600} size="sm">
          {copy.filename}
        </Text>
        <Text size="xs" c="dimmed">
          This action affects the selected location only.
        </Text>
        {error && <Alert color="red">{error}</Alert>}
        {job ? (
          <>
            <Alert
              color={
                job.status === 'succeeded' ? 'teal' : job.error ? 'red' : 'blue'
              }
            >
              {job.status.replace(/_/g, ' ')} ·{' '}
              {job.transactionOutcome.replace(/_/g, ' ')} {job.error?.message}
            </Alert>
            {job.status === 'outcome_unknown' && (
              <Text size="sm">
                Refresh the inventory and inspect this exact copy before
                submitting another deletion. The job will not be replayed
                automatically.
              </Text>
            )}
            <Button variant="default" onClick={onClose}>
              Close
            </Button>
          </>
        ) : pending ? (
          <>
            <Alert color="red">{pending.review.warning}</Alert>
            <TextInput
              label="Type the exact backup filename"
              value={confirmation}
              onChange={(e) => setConfirmation(e.currentTarget.value)}
            />
            <Group justify="end">
              <Button variant="default" onClick={() => setPending(undefined)}>
                Go back
              </Button>
              <Button
                color="red"
                loading={busy}
                disabled={confirmation !== copy.filename}
                onClick={() => void remove()}
              >
                {pending.review.permanent
                  ? 'Permanently delete this copy'
                  : 'Move this Drive copy to trash'}
              </Button>
            </Group>
          </>
        ) : (
          <>
            <Textarea
              label="Reason"
              value={reason}
              onChange={(e) => setReason(e.currentTarget.value)}
              required
            />
            {copy.location === 'drive' && (
              <Checkbox
                label="Permanently delete instead of moving to Drive trash"
                checked={permanent}
                onChange={(e) => setPermanent(e.currentTarget.checked)}
              />
            )}
            <Button
              color="red"
              loading={busy}
              disabled={reason.trim().length < 5}
              onClick={() => void prepare()}
            >
              Review removal of this copy
            </Button>
          </>
        )}
      </Stack>
    </Modal>
  );
}
