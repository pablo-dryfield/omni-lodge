import { useEffect, useRef, useState } from 'react';
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
import {
  api,
  activeJob,
  message,
  type Capabilities,
  type Job,
  type Mode,
} from './api';
import { SqlEditor, type EditorHandle } from './SqlEditor';
import { ResultGrid } from './ResultGrid';

export function SessionPanel({
  targetId,
  capabilities,
}: {
  targetId: string;
  capabilities: Capabilities;
}) {
  const sessions = useQuery({
    queryKey: ['dw-sessions'],
    queryFn: api.sessions,
    refetchInterval: 1500,
    retry: false,
  });
  const [selected, setSelected] = useState(''),
    [mode, setMode] = useState<Mode>('read'),
    [sql, setSql] = useState('SELECT NOW();'),
    [params, setParams] = useState('[]'),
    [reason, setReason] = useState(''),
    [name, setName] = useState('checkpoint'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [job, setJob] = useState<Job>();
  const [pending, setPending] = useState<{
    input: Record<string, unknown>;
    review: { token: string; sql: string; command: string; expiresAt: string };
  }>();
  const editor = useRef<EditorHandle>(null);
  const current = sessions.data?.find((s) => s.id === selected),
    live = Boolean(current && ['idle', 'aborted'].includes(current.state));
  useEffect(() => {
    if (!selected && sessions.data?.length) setSelected(sessions.data[0].id);
  }, [selected, sessions.data]);
  useEffect(() => {
    if (!job || !activeJob(job)) return;
    let stopped = false;
    const timer = window.setInterval(
      () =>
        void api
          .job(job.id)
          .then((j) => {
            if (!stopped) setJob(j);
          })
          .catch((e) => setError(message(e))),
      600,
    );
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [job?.id, job?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  async function open() {
    setBusy(true);
    setError('');
    try {
      const s = await api.openSession(targetId, mode);
      setSelected(s.id);
      await sessions.refetch();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function submit(command: string) {
    if (!current) return;
    setBusy(true);
    setError('');
    try {
      const parameters = JSON.parse(params);
      if (
        !Array.isArray(parameters) ||
        parameters.some((v) => v !== null && typeof v !== 'string')
      )
        throw new Error('Use a JSON array of exact text values or null.');
      const input = {
        command,
        name,
        sql: editor.current?.scope().sql || sql,
        parameters,
        reason,
        revision: current.revision,
        idempotencyKey: crypto.randomUUID(),
      };
      const actualPlan =
        command === 'sql' && /\bEXPLAIN\b[\s\S]*\bANALYZE\b/i.test(input.sql);
      if (
        (current.mode === 'write' &&
          (command === 'sql' || command === 'commit')) ||
        actualPlan
      ) {
        const review = await api.sessionCommand(current.id, {
          ...input,
          action: 'review',
        });
        setPending({ input, review });
      } else {
        setJob(await api.sessionCommand(current.id, input));
        await sessions.refetch();
      }
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    if (!current || !pending) return;
    setBusy(true);
    setError('');
    try {
      setJob(
        await api.sessionCommand(current.id, {
          ...pending.input,
          reviewToken: pending.review.token,
        }),
      );
      setPending(undefined);
      await sessions.refetch();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="dw-pane">
      <Group justify="space-between" mb="md">
        <div>
          <Text fw={700}>Expert transactions</Text>
          <Text size="xs" c="dimmed">
            A dedicated connection keeps one transaction open across commands.
          </Text>
        </div>
        <Group>
          <Select
            size="xs"
            aria-label="New transaction mode"
            w={145}
            value={mode}
            allowDeselect={false}
            onChange={(v) => setMode(v === 'write' ? 'write' : 'read')}
            data={[
              { value: 'read', label: 'Read only' },
              {
                value: 'write',
                label: 'Reviewed write',
                disabled:
                  !capabilities.writesEnabled || !capabilities.actions.write,
              },
            ]}
          />
          <Button size="xs" onClick={() => void open()} loading={busy}>
            Open transaction
          </Button>
        </Group>
      </Group>
      {(error || sessions.error) && (
        <Alert color="red" mb="md" withCloseButton onClose={() => setError('')}>
          {error || message(sessions.error)}
        </Alert>
      )}
      <Select
        label="Transaction session"
        placeholder="Open a session to begin"
        value={selected || null}
        onChange={(v) => setSelected(v || '')}
        data={(sessions.data || []).map((s) => ({
          value: s.id,
          label: `${s.targetId} · ${s.mode} · ${s.state} · ${new Date(s.createdAt).toLocaleTimeString()}`,
        }))}
      />
      {current && (
        <Stack gap="sm" mt="md">
          <Group>
            <Badge color={current.state === 'aborted' ? 'red' : 'blue'}>
              {current.state}
            </Badge>
            <Badge variant="light">{current.outcome.replace(/_/g, ' ')}</Badge>
            <Text size="xs">
              {current.affectedRows} rows affected · expires{' '}
              {new Date(current.expiresAt).toLocaleTimeString()}
            </Text>
          </Group>
          {live && (
            <Alert
              color={current.mode === 'write' ? 'orange' : 'blue'}
              title="Transaction remains open"
            >
              Commands are staged until you explicitly commit. Idle timeout,
              loss of authority or session expiry rolls the transaction back.
              Keep this transaction short.
            </Alert>
          )}
          {current.state === 'aborted' && (
            <Alert color="red">
              A command failed. Roll back the transaction or roll back to an
              existing savepoint before continuing.
            </Alert>
          )}
          {live && (
            <>
              <div
                style={{
                  height: 230,
                  border: '1px solid var(--dw-border)',
                  borderRadius: 6,
                  overflow: 'hidden',
                }}
              >
                <SqlEditor
                  ref={editor}
                  value={sql}
                  onChange={setSql}
                  onRun={() => void submit('sql')}
                  schema={[]}
                />
              </div>
              <TextInput
                label="Bound parameters"
                value={params}
                onChange={(e) => setParams(e.currentTarget.value)}
              />
              {
                <Textarea
                  label="Reason for a write, actual plan or commit"
                  value={reason}
                  onChange={(e) => setReason(e.currentTarget.value)}
                  minRows={2}
                />
              }
              <Group>
                <Button
                  size="xs"
                  disabled={current.state === 'aborted'}
                  loading={busy}
                  onClick={() => void submit('sql')}
                >
                  Run current in transaction
                </Button>
                <Button
                  size="xs"
                  color="teal"
                  disabled={current.state === 'aborted'}
                  onClick={() => void submit('commit')}
                >
                  Review & commit
                </Button>
                <Button
                  size="xs"
                  variant="light"
                  color="red"
                  onClick={() => void submit('rollback')}
                >
                  Roll back transaction
                </Button>
              </Group>
              <Group align="end">
                <TextInput
                  label="Savepoint name"
                  size="xs"
                  value={name}
                  onChange={(e) => setName(e.currentTarget.value)}
                />
                <Button
                  size="xs"
                  variant="default"
                  disabled={current.state === 'aborted'}
                  onClick={() => void submit('savepoint')}
                >
                  Create savepoint
                </Button>
                <Button
                  size="xs"
                  variant="default"
                  onClick={() => void submit('rollbackTo')}
                >
                  Roll back to
                </Button>
                <Button
                  size="xs"
                  variant="default"
                  disabled={current.state === 'aborted'}
                  onClick={() => void submit('release')}
                >
                  Release
                </Button>
              </Group>
            </>
          )}
          {job && (
            <>
              <Group>
                <Text size="sm" fw={600}>
                  Latest command: {job.status.replace(/_/g, ' ')} ·{' '}
                  {job.transactionOutcome.replace(/_/g, ' ')}
                </Text>
                {activeJob(job) && (
                  <Button
                    size="xs"
                    color="red"
                    variant="light"
                    onClick={() => void api.cancel(job.id).then(setJob)}
                  >
                    Cancel command
                  </Button>
                )}
              </Group>
              {job.error && <Alert color="red">{job.error.message}</Alert>}
              {job.outcomes[0]?.result && (
                <div style={{ minHeight: 300 }}>
                  <ResultGrid
                    job={job}
                    index={0}
                    canExport={Boolean(capabilities.actions.export)}
                  />
                </div>
              )}
            </>
          )}
        </Stack>
      )}
      <Modal
        opened={Boolean(pending)}
        onClose={() => !busy && setPending(undefined)}
        title="Review transaction command"
        centered
        size="lg"
      >
        <Stack>
          <Alert color="orange">
            Target {current?.targetId} ·{' '}
            {pending?.review.command === 'commit'
              ? `Commit ${current?.affectedRows} affected rows`
              : 'Changes remain staged in this transaction'}
            .
          </Alert>
          <Code block>
            {pending?.review.sql || pending?.review.command.toUpperCase()}
          </Code>
          <Text size="sm">Reason: {String(pending?.input.reason || '')}</Text>
          <Text size="xs" c="dimmed">
            Review expires{' '}
            {pending && new Date(pending.review.expiresAt).toLocaleTimeString()}
          </Text>
          <Group justify="end">
            <Button variant="default" onClick={() => setPending(undefined)}>
              Cancel
            </Button>
            <Button
              color="orange"
              loading={busy}
              onClick={() => void confirm()}
            >
              Execute reviewed command
            </Button>
          </Group>
        </Stack>
      </Modal>
    </div>
  );
}
