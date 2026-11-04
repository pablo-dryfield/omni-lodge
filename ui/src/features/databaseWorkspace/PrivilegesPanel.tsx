import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Code,
  Group,
  Modal,
  MultiSelect,
  Select,
  Stack,
  Tabs,
  Text,
  Textarea,
} from '@mantine/core';
import { api, message, activeJob, type Job } from './api';
import { RecordTable } from './RecordTable';
import { RoleWizard } from './RoleWizard';
type Snapshot = {
  roles: Array<Record<string, unknown> & { name: string; protected: boolean }>;
  memberships: Record<string, unknown>[];
  grants: Record<string, unknown>[];
  defaults: Record<string, unknown>[];
  notice: string;
};
export function PrivilegesPanel({ targetId }: { targetId: string }) {
  const snapshot = useQuery<Snapshot>({
    queryKey: ['dw-privileges', targetId],
    queryFn: () => api.privileges(targetId),
    retry: false,
  });
  const catalog = useQuery({
    queryKey: ['dw-privilege-objects', targetId],
    queryFn: () => api.catalog(targetId),
    retry: false,
  });
  const [role, setRole] = useState(''),
    [scope, setScope] = useState('table'),
    [operation, setOperation] = useState('grant'),
    [objectId, setObjectId] = useState(''),
    [privileges, setPrivileges] = useState<string[]>(['SELECT']),
    [reason, setReason] = useState(''),
    [schema, setSchema] = useState('public'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<{
      input: Record<string, unknown>;
      review: { token: string; operation: { sql: string[] }; warning: string };
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
      750,
    );
    return () => clearInterval(timer);
  }, [job?.id, job?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  async function review() {
    setBusy(true);
    setError('');
    try {
      const input = {
        targetId,
        kind: 'privilege',
        role,
        scope,
        operation,
        objectId,
        privileges,
        schema,
        reason,
        idempotencyKey: crypto.randomUUID(),
      };
      setPending({ input, review: await api.adminOperation(input) });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function execute() {
    if (!pending) return;
    setBusy(true);
    try {
      setJob(
        await api.adminOperation({
          ...pending.input,
          action: 'execute',
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
  const allowed =
    scope === 'schema'
      ? ['USAGE', 'CREATE']
      : scope === 'sequence'
        ? ['SELECT', 'USAGE', 'UPDATE']
        : ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'REFERENCES', 'TRIGGER'];
  return (
    <Stack>
      {(error || snapshot.error) && (
        <Alert color="red">{error || message(snapshot.error)}</Alert>
      )}
      <Alert color="blue">
        {snapshot.data?.notice || 'Database role and privilege inspection.'}{' '}
        Protected service identities and connected membership paths cannot be
        broadened through these controls.
      </Alert>
      {job && (
        <Alert color={job.error ? 'red' : 'blue'}>
          {job.status} · {job.transactionOutcome} {job.error?.message}
        </Alert>
      )}
      <Tabs defaultValue="roles">
        <Tabs.List>
          {[
            'roles',
            'memberships',
            'grants',
            'defaults',
            'change',
            'role management',
          ].map((t) => (
            <Tabs.Tab key={t} value={t}>
              {t[0].toUpperCase() + t.slice(1)}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        {(['roles', 'memberships', 'grants', 'defaults'] as const).map((t) => (
          <Tabs.Panel key={t} value={t} pt="sm">
            <RecordTable
              rows={snapshot.data?.[t] || []}
              label={`PostgreSQL ${t}`}
            />
          </Tabs.Panel>
        ))}
        <Tabs.Panel value="role management" pt="md">
          <RoleWizard
            targetId={targetId}
            roles={snapshot.data?.roles || []}
            onChanged={() => void snapshot.refetch()}
          />
        </Tabs.Panel>
        <Tabs.Panel value="change" pt="md">
          <Stack>
            <Group grow>
              <Select
                searchable
                label="Ordinary PostgreSQL role"
                value={role || null}
                onChange={(v) => setRole(v || '')}
                data={(snapshot.data?.roles || [])
                  .filter((r) => !r.protected)
                  .map((r) => ({ value: r.name, label: r.name }))}
              />
              <Select
                label="Action"
                value={operation}
                onChange={(v) => setOperation(v || 'grant')}
                data={['grant', 'revoke']}
              />
            </Group>
            <Select
              label="Scope"
              value={scope}
              onChange={(v) => {
                setScope(v || 'table');
                setPrivileges([]);
                setObjectId('');
              }}
              data={[
                { value: 'table', label: 'Table / view' },
                { value: 'sequence', label: 'Sequence' },
                { value: 'schema', label: 'Schema' },
                {
                  value: 'defaults',
                  label:
                    'Default privileges for objects created by the maintenance role',
                },
              ]}
            />
            {scope === 'schema' || scope === 'defaults' ? (
              <Select
                label="Schema"
                value={schema}
                onChange={(v) => setSchema(v || 'public')}
                data={[...new Set((catalog.data || []).map((o) => o.schema))]}
              />
            ) : (
              <Select
                searchable
                label="Object"
                value={objectId || null}
                onChange={(v) => setObjectId(v || '')}
                data={(catalog.data || [])
                  .filter((o) =>
                    scope === 'sequence' ? o.kind === 'S' : o.kind !== 'S',
                  )
                  .map((o) => ({
                    value: o.id,
                    label: `${o.schema}.${o.name}`,
                  }))}
              />
            )}
            <MultiSelect
              label="Explicit privileges"
              value={privileges}
              onChange={setPrivileges}
              data={allowed}
            />
            <Textarea
              label="Reason"
              value={reason}
              onChange={(e) => setReason(e.currentTarget.value)}
              required
            />
            <Button
              disabled={!role || !privileges.length || reason.trim().length < 5}
              loading={busy}
              color="orange"
              onClick={() => void review()}
            >
              Review privilege change
            </Button>
            <Text size="xs" c="dimmed">
              This never grants superuser, RLS bypass, role administration,
              ownership or grant options. PostgreSQL checks that the dedicated
              maintenance identity has authority over the selected object.
            </Text>
          </Stack>
        </Tabs.Panel>
      </Tabs>
      <Modal
        opened={Boolean(pending)}
        onClose={() => setPending(undefined)}
        title="Review PostgreSQL privilege change"
        centered
      >
        <Stack>
          <Alert color="orange">{pending?.review.warning}</Alert>
          {pending?.review.operation.sql.map((sql, i) => (
            <Code key={i} block>
              {sql}
            </Code>
          ))}
          <Button color="orange" loading={busy} onClick={() => void execute()}>
            Apply reviewed privileges
          </Button>
        </Stack>
      </Modal>
    </Stack>
  );
}
