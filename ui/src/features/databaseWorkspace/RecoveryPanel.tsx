import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Code,
  Group,
  Modal,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { Link } from 'react-router-dom';
import { api, message, activeJob, type Job } from './api';
import { RecordTable } from './RecordTable';
import { DeleteBackupDialog } from './DeleteBackupDialog';
import { downloadBackup } from './backupDownload';
type Backup = {
  id: string;
  filename: string;
  sizeBytes: number;
  createdAt: string;
  modifiedAt: string;
  location: string;
  lastTestedRestore: string | null;
};
export function RecoveryPanel({ targetId }: { targetId: string }) {
  const inventory = useQuery<{
    files: Backup[];
    stores: {
      location: string;
      available: boolean;
      count: number;
      message?: string;
    }[];
    storageMode: string;
    keepLocalAfterUpload: boolean;
    restore: { enabled: boolean; message: string };
    pitr: { verified: boolean; reason: string };
  }>({ queryKey: ['dw-backup-inventory'], queryFn: api.backups, retry: false });
  const [deleteCopy, setDeleteCopy] = useState<Backup>();
  const [filename, setFilename] = useState(''),
    [reason, setReason] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [archive, setArchive] = useState<{
      id: string;
      checksum: string;
      bytes: number;
      archiveMajor: number;
      toolMajor: number;
    }>(),
    [review, setReview] = useState<{
      token: string;
      destination: string;
      warning: string;
    }>(),
    [confirmation, setConfirmation] = useState(''),
    [job, setJob] = useState<Job>(),
    [requestId, setRequestId] = useState('');
  useEffect(() => {
    if (!job || !activeJob(job)) return;
    const timer = window.setInterval(
      () =>
        void api
          .job(job.id)
          .then(setJob)
          .catch((e) => setError(message(e))),
      1000,
    );
    return () => clearInterval(timer);
  }, [job?.id, job?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  async function stage() {
    setBusy(true);
    setError('');
    try {
      setArchive(await api.stageRestore({ targetId, copyId: filename }));
      setReview(undefined);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function prepare() {
    if (!archive) return;
    setBusy(true);
    setError('');
    try {
      setReview(
        await api.reviewRestore({ targetId, archiveId: archive.id, reason }),
      );
      setRequestId(crypto.randomUUID());
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function restore() {
    if (!review || !archive) return;
    setBusy(true);
    setError('');
    try {
      setJob(
        await api.reviewRestore({
          targetId,
          archiveId: archive.id,
          reason,
          destination: review.destination,
          confirmDestination: confirmation,
          reviewToken: review.token,
          action: 'restore',
          idempotencyKey: requestId,
        }),
      );
      setReview(undefined);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Stack>
      <Group justify="space-between">
        <div>
          <Text fw={600}>Backups & isolated recovery</Text>
          <Text size="xs" c="dimmed">
            Uses the existing local/Google Drive DB Backups inventory.
          </Text>
        </div>
        <Group>
          <Button
            variant="default"
            size="xs"
            component={Link}
            to="/settings/db-backups"
          >
            DB Backups settings
          </Button>
          <Button
            variant="light"
            size="xs"
            onClick={() => void inventory.refetch()}
          >
            Refresh inventory
          </Button>
          <Button
            size="xs"
            loading={busy}
            onClick={() => {
              setBusy(true);
              void api
                .createBackup()
                .then(() => inventory.refetch())
                .catch((e) => setError(message(e)))
                .finally(() => setBusy(false));
            }}
          >
            Create backup
          </Button>
        </Group>
      </Group>
      {(error || inventory.error) && (
        <Alert color="red">{error || message(inventory.error)}</Alert>
      )}
      <Alert color="blue">
        {inventory.data?.pitr.reason ||
          'Point-in-time recovery coverage is unverified. Logical dumps are not a WAL archive.'}
      </Alert>
      <Group>
        {inventory.data?.stores?.map((store) => (
          <div className="dw-card" key={store.location}>
            <Text fw={600} size="sm">
              {store.location === 'local' ? 'Server' : 'Google Drive'}
            </Text>
            <Badge variant="light" color={store.available ? 'teal' : 'orange'}>
              {store.available ? `${store.count} copies` : 'Unavailable'}
            </Badge>
            {store.message && (
              <Text size="xs" c="dimmed" mt="xs">
                {store.message}
              </Text>
            )}
          </div>
        ))}
      </Group>
      <Text size="xs" c="dimmed">
        New backup storage: {inventory.data?.storageMode || 'unknown'} · Server
        copy after Drive upload:{' '}
        {inventory.data?.keepLocalAfterUpload ? 'retained' : 'removed'}.
        Matching names alone do not verify identical archive contents.
      </Text>
      <RecordTable
        rows={
          (inventory.data?.files || []) as unknown as Record<string, unknown>[]
        }
        label="Server and Google Drive backup copies"
        actions={(row) => (
          <Group gap={4}>
            <Button
              size="compact-xs"
              variant="default"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError('');
                void downloadBackup(row as unknown as Backup)
                  .catch((e) => setError(message(e)))
                  .finally(() => setBusy(false));
              }}
            >
              Download
            </Button>
            <Button
              size="compact-xs"
              variant="light"
              onClick={() => {
                setFilename(String(row.id));
                setArchive(undefined);
                document
                  .getElementById('dw-restore-details')
                  ?.setAttribute('open', '');
              }}
            >
              Restore
            </Button>
            <Button
              size="compact-xs"
              variant="subtle"
              color="red"
              onClick={() => setDeleteCopy(row as unknown as Backup)}
            >
              Delete copy
            </Button>
          </Group>
        )}
      />
      <details id="dw-restore-details">
        <summary style={{ fontWeight: 600, cursor: 'pointer' }}>
          Restore into a new private database
        </summary>
        <Stack mt="md">
          {inventory.data?.restore && (
            <Alert
              color={inventory.data.restore.enabled ? 'blue' : 'orange'}
              title="Restore as an additional database"
            >
              {inventory.data.restore.message}
            </Alert>
          )}
          <Text size="sm">
            The source/application database is preserved. The worker validates
            archive format, checksum, disk headroom and tool/server
            compatibility, then creates a new isolated destination. It does not
            run schema sync or reseed application permissions.
          </Text>
          <Select
            searchable
            label="Trusted inventory backup"
            value={filename || null}
            onChange={(v) => {
              setFilename(v || '');
              setArchive(undefined);
            }}
            data={(inventory.data?.files || []).map((f) => ({
              value: f.id,
              label: `${f.location === 'local' ? 'Server' : 'Google Drive'} · ${f.filename} · ${(f.sizeBytes / 1048576).toFixed(1)} MiB`,
            }))}
          />
          <Button
            variant="light"
            disabled={!filename || inventory.data?.restore?.enabled === false}
            loading={busy}
            onClick={() => void stage()}
          >
            Stage & inspect trusted archive
          </Button>
          {archive && (
            <>
              <Group>
                <Badge variant="light">
                  Archive PostgreSQL {archive.archiveMajor}
                </Badge>
                <Badge variant="light">Restore tool {archive.toolMajor}</Badge>
              </Group>
              <Code block style={{ overflowWrap: 'anywhere' }}>
                SHA-256 {archive.checksum}
              </Code>
              <Textarea
                label="Purpose / reason"
                value={reason}
                onChange={(e) => setReason(e.currentTarget.value)}
                required
              />
              <Button
                color="orange"
                disabled={reason.trim().length < 5}
                loading={busy}
                onClick={() => void prepare()}
              >
                Review isolated restore
              </Button>
            </>
          )}
          {job && (
            <>
              <Alert
                color={
                  job.error
                    ? 'red'
                    : job.status === 'succeeded'
                      ? 'teal'
                      : 'blue'
                }
              >
                {job.status.replace(/_/g, ' ')} ·{' '}
                {job.transactionOutcome.replace(/_/g, ' ')} {job.error?.message}
              </Alert>
              {job.error?.detail && <Text size="sm">{job.error.detail}</Text>}
              {activeJob(job) && (
                <Button
                  color="red"
                  variant="light"
                  onClick={() => void api.cancel(job.id).then(setJob)}
                >
                  Cancel restore
                </Button>
              )}
              {job.outcomes.map((o) => (
                <Code key={o.index} block style={{ whiteSpace: 'pre-wrap' }}>
                  {o.sql}
                </Code>
              ))}
            </>
          )}
        </Stack>
      </details>
      <details>
        <summary style={{ fontWeight: 600, cursor: 'pointer' }}>
          Production recovery runbook
        </summary>
        <Stack mt="sm">
          <Text size="sm">
            Production replacement requires the infrastructure maintenance
            process. This workspace never overwrites a registered database.
          </Text>
          <ol>
            <li>
              Verify a fresh recovery point, archive checksum, key availability,
              server/tool versions and measured restore test.
            </li>
            <li>
              Stop new application writes and drain background workers through
              the host control plane.
            </li>
            <li>
              Restore and verify an isolated database first. Record migration
              state, constraints, indexes, row counts and owner/grant isolation.
            </li>
            <li>
              Approve a named cutover/recovery point, service coordination and
              rollback plan. Preserve the prior database.
            </li>
            <li>
              Use the infrastructure control plane to switch the application to
              the verified database; verify backend readiness and migrations
              before activating the UI.
            </li>
            <li>
              Verify application health, permissions, ingestion and financial
              workflows before reopening writes. Retain recovery evidence and
              old keys according to policy.
            </li>
          </ol>
          <Text size="xs" c="dimmed">
            Recovery job state and encrypted manifests are stored outside the
            application database. Host operators must have the independent
            control-store bootstrap secret and encryption key available before
            an outage.
          </Text>
        </Stack>
      </details>
      {deleteCopy && (
        <DeleteBackupDialog
          copy={deleteCopy}
          targetId={targetId}
          onClose={() => setDeleteCopy(undefined)}
          onDone={() => void inventory.refetch()}
        />
      )}
      <Modal
        opened={Boolean(review)}
        onClose={() => !busy && setReview(undefined)}
        title="Confirm isolated database restore"
        centered
        size="lg"
      >
        <Stack>
          <Alert color="orange">{review?.warning}</Alert>
          <Text size="sm">
            Source {filename} · target cluster {targetId}
          </Text>
          <Code>{review?.destination}</Code>
          <TextInput
            label="Type the exact new database name"
            value={confirmation}
            onChange={(e) => setConfirmation(e.currentTarget.value)}
          />
          <Button
            color="orange"
            loading={busy}
            disabled={confirmation !== review?.destination}
            onClick={() => void restore()}
          >
            Restore into this new private database
          </Button>
        </Stack>
      </Modal>
    </Stack>
  );
}
