import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Code,
  Modal,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { api, activeJob, message, type Job } from './api';
export function RoleWizard({
  targetId,
  roles,
  onChanged,
}: {
  targetId: string;
  roles: Array<{ name: string; protected: boolean }>;
  onChanged: () => void;
}) {
  const [operation, setOperation] = useState('create'),
    [role, setRole] = useState(''),
    [newName, setNewName] = useState(''),
    [member, setMember] = useState(''),
    [reason, setReason] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [job, setJob] = useState<Job>(),
    [pending, setPending] = useState<{
      input: Record<string, unknown>;
      token: string;
      sql: string[];
    }>();
  const available = roles
    .filter((r) => !r.protected)
    .map((r) => ({ value: r.name, label: r.name }));
  useEffect(() => {
    if (!job || !activeJob(job)) return;
    const timer = window.setInterval(
      () =>
        void api
          .job(job.id)
          .then(setJob)
          .catch((e) => setError(message(e))),
      750,
    );
    return () => clearInterval(timer);
  }, [job?.id, job?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (job?.status === 'succeeded') onChanged();
  }, [job?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  async function prepare() {
    setBusy(true);
    setError('');
    try {
      const input = {
          kind: 'role',
          targetId,
          operation,
          role,
          newName,
          member,
          reason,
          idempotencyKey: crypto.randomUUID(),
        },
        review = await api.adminOperation(input);
      setPending({ input, token: review.token, sql: review.operation.sql });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    if (!pending) return;
    setBusy(true);
    try {
      setJob(
        await api.adminOperation({
          ...pending.input,
          action: 'execute',
          reviewToken: pending.token,
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
    <Stack>
      <Alert color="blue">
        Role management uses a separate nonsuperuser CREATEROLE identity and an
        explicit Control Panel policy. New roles are NOLOGIN. Credentials belong
        in the protected integration configuration/infrastructure process, never
        saved SQL. Service identities, privileged roles, ownership changes and
        grant options are excluded.
      </Alert>
      {error && <Alert color="red">{error}</Alert>}
      {job && (
        <Alert color={job.error ? 'red' : 'blue'}>
          {job.status} · {job.transactionOutcome} {job.error?.message}
        </Alert>
      )}
      <Select
        label="Role operation"
        value={operation}
        onChange={(v) => {
          setOperation(v || 'create');
          setRole('');
        }}
        data={[
          { value: 'create', label: 'Create ordinary NOLOGIN role' },
          { value: 'rename', label: 'Rename ordinary role' },
          { value: 'disableLogin', label: 'Disable role login' },
          {
            value: 'drop',
            label: 'Drop role (PostgreSQL rejects unresolved dependencies)',
          },
          {
            value: 'grantMembership',
            label: 'Grant role membership without admin option',
          },
          { value: 'revokeMembership', label: 'Revoke role membership' },
        ]}
      />
      {operation === 'create' ? (
        <TextInput
          label="New PostgreSQL role name"
          value={role}
          onChange={(e) => setRole(e.currentTarget.value)}
          placeholder="Lowercase letters, numbers and underscores"
        />
      ) : (
        <Select
          searchable
          label="Ordinary PostgreSQL role"
          value={role || null}
          onChange={(v) => setRole(v || '')}
          data={available}
        />
      )}{' '}
      {operation === 'rename' && (
        <TextInput
          label="New role name"
          value={newName}
          onChange={(e) => setNewName(e.currentTarget.value)}
        />
      )}{' '}
      {['grantMembership', 'revokeMembership'].includes(operation) && (
        <Select
          searchable
          label="Member role"
          value={member || null}
          onChange={(v) => setMember(v || '')}
          data={available.filter((r) => r.value !== role)}
        />
      )}
      <Textarea
        label="Reason"
        value={reason}
        onChange={(e) => setReason(e.currentTarget.value)}
        required
      />
      <Text size="xs" c="dimmed">
        Disabling LOGIN does not terminate existing sessions. Use the separately
        authorized session controls if needed.
      </Text>
      <Button
        color="orange"
        disabled={!role || reason.trim().length < 5}
        loading={busy}
        onClick={() => void prepare()}
      >
        Review role operation
      </Button>
      <Modal
        opened={Boolean(pending)}
        onClose={() => setPending(undefined)}
        title="Review ordinary PostgreSQL role change"
        centered
      >
        <Stack>
          {pending?.sql.map((sql, i) => (
            <Code block key={i}>
              {sql}
            </Code>
          ))}
          <Alert color="orange">
            PostgreSQL applies its role administration and dependency checks. No
            superuser, database creation, replication, RLS bypass or admin
            membership option is granted.
          </Alert>
          <Button color="orange" loading={busy} onClick={() => void apply()}>
            Apply reviewed role operation
          </Button>
        </Stack>
      </Modal>
    </Stack>
  );
}
