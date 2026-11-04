import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Code,
  Group,
  Modal,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { api, message } from './api';
import { RecordTable } from './RecordTable';
type Schedule = {
  id: string;
  title: string;
  targetId: string;
  enabled: boolean;
  revision: number;
  nextRun: string;
  lastJobId?: string;
  disabledReason?: string;
  documentRevision: number;
  spec: { timezone: string; time: string; weekdays: number[] };
};
export function SchedulesPanel() {
  const schedules = useQuery<Schedule[]>({
      queryKey: ['dw-schedules'],
      queryFn: api.schedules,
      refetchInterval: 10000,
      retry: false,
    }),
    queries = useQuery({
      queryKey: ['dw-schedule-queries'],
      queryFn: () => api.documents('query'),
      retry: false,
    });
  const [documentId, setDocumentId] = useState(''),
    [template, setTemplate] = useState('query'),
    [targetId, setTargetId] = useState(''),
    [objectId, setObjectId] = useState(''),
    [concurrent, setConcurrent] = useState(false),
    [mode, setMode] = useState('read'),
    [timezone, setTimezone] = useState('Europe/Warsaw'),
    [time, setTime] = useState('08:00'),
    [weekdays, setWeekdays] = useState(['0', '1', '2', '3', '4', '5', '6']),
    [reason, setReason] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [history, setHistory] = useState<Record<string, unknown>[] | undefined>(),
    [pending, setPending] = useState<{
      input: Record<string, unknown>;
      review: {
        token: string;
        sql: string;
        title: string;
        nextRun: string;
        documentRevision: number;
      };
    }>();
  const capabilities = useQuery({
    queryKey: ['database-workspace-capabilities'],
    queryFn: api.capabilities,
  });
  const objects = useQuery({
    queryKey: ['dw-schedule-objects', targetId],
    queryFn: () => api.catalog(targetId),
    enabled: Boolean(targetId),
    retry: false,
  });
  async function prepare() {
    setBusy(true);
    setError('');
    try {
      const input = {
        documentId,
        template,
        targetId,
        objectId,
        concurrent,
        mode,
        reason,
        spec: {
          timezone,
          time,
          weekdays: weekdays.map(Number),
          missed: 'skip',
          overlap: 'skip',
          dst: 'skip-gap-once-fold',
        },
        idempotencyKey: crypto.randomUUID(),
      };
      setPending({ input, review: await api.createSchedule(input) });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function create() {
    if (!pending) return;
    setBusy(true);
    try {
      await api.createSchedule({
        ...pending.input,
        action: 'create',
        reviewToken: pending.review.token,
      });
      setPending(undefined);
      await schedules.refetch();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function action(id: string, verb: string) {
    setError('');
    try {
      const result = await api.scheduleAction(id, verb);
      if (verb === 'history') setHistory(result);
      await schedules.refetch();
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <Stack>
      {(error || schedules.error) && (
        <Alert color="red">{error || message(schedules.error)}</Alert>
      )}
      <Alert color="blue">
        Schedules pin the exact saved-query revision, target, SQL, mode, limits
        and authority. A changed query or policy requires fresh approval.
        Missed/overlapping runs are recorded and skipped; daylight-saving gaps
        are skipped and repeated local times run once.
      </Alert>
      <div className="dw-grid">
        {schedules.data?.map((s) => (
          <div className="dw-card" key={s.id}>
            <Group justify="space-between">
              <Text size="sm" fw={600}>
                {s.title}
              </Text>
              <Badge variant="light" color={s.enabled ? 'teal' : 'gray'}>
                {s.enabled ? 'Enabled' : 'Paused'}
              </Badge>
            </Group>
            <Text size="xs" c="dimmed" mt="sm">
              {s.targetId} · revision {s.documentRevision} · {s.spec.time}{' '}
              {s.spec.timezone}
            </Text>
            <Text size="xs" mt={4}>
              Next: {new Date(s.nextRun).toLocaleString()}
            </Text>
            {s.disabledReason && (
              <Text size="xs" c="orange" mt={4}>
                {s.disabledReason}
              </Text>
            )}
            <Group gap={5} mt="sm">
              <Button
                size="compact-xs"
                variant="light"
                onClick={() =>
                  void action(s.id, s.enabled ? 'pause' : 'resume')
                }
              >
                {s.enabled ? 'Pause' : 'Resume'}
              </Button>
              <Button
                size="compact-xs"
                variant="default"
                onClick={() => void action(s.id, 'runNow')}
              >
                Run now
              </Button>
              <Button
                size="compact-xs"
                variant="subtle"
                onClick={() => void action(s.id, 'history')}
              >
                History
              </Button>
              <Button
                size="compact-xs"
                variant="subtle"
                color="red"
                onClick={() => void action(s.id, 'delete')}
              >
                Delete
              </Button>
            </Group>
          </div>
        ))}
      </div>
      <details>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
          Create a reviewed schedule
        </summary>
        <Stack mt="md">
          <Select
            label="Operation"
            value={template}
            onChange={(v) => setTemplate(v || 'query')}
            data={[
              { value: 'query', label: 'Versioned saved query' },
              ...['analyze', 'vacuum', 'reindex', 'refresh'].map((value) => ({
                value,
                label: `Maintenance: ${value}`,
              })),
            ]}
          />
          {template === 'query' ? (
            <>
              <Select
                searchable
                label="Versioned saved query"
                value={documentId || null}
                onChange={(v) => setDocumentId(v || '')}
                data={(queries.data || [])
                  .filter((d) => d.value.sql)
                  .map((d) => ({
                    value: d.id,
                    label: `${d.value.title || 'Untitled'} · revision ${d.revision}`,
                  }))}
              />
              <Select
                label="Execution mode"
                value={mode}
                onChange={(v) => setMode(v || 'read')}
                data={[
                  { value: 'read', label: 'Read-only report' },
                  {
                    value: 'write',
                    label: 'Recurring DML — exact write approval required',
                  },
                ]}
              />
            </>
          ) : (
            <>
              <Select
                label="Connection"
                searchable
                value={targetId || null}
                onChange={(v) => {
                  setTargetId(v || '');
                  setObjectId('');
                }}
                data={(capabilities.data?.targets || []).map((t) => ({
                  value: t.id,
                  label: `${t.label} · ${t.database}`,
                }))}
              />
              <Select
                label="Table or materialized view"
                searchable
                value={objectId || null}
                onChange={(v) => setObjectId(v || '')}
                data={(objects.data || [])
                  .filter((o) => ['r', 'p', 'm'].includes(o.kind))
                  .map((o) => ({
                    value: o.id,
                    label: `${o.schema}.${o.name}`,
                  }))}
              />
              {['reindex', 'refresh'].includes(template) && (
                <Checkbox
                  label="Concurrent operation"
                  checked={concurrent}
                  onChange={(e) => setConcurrent(e.currentTarget.checked)}
                />
              )}
            </>
          )}
          <Group grow>
            <TextInput
              label="IANA timezone"
              value={timezone}
              onChange={(e) => setTimezone(e.currentTarget.value)}
            />
            <TextInput
              label="Local time"
              type="time"
              value={time}
              onChange={(e) => setTime(e.currentTarget.value)}
            />
          </Group>
          <Checkbox.Group
            label="Local weekdays"
            value={weekdays}
            onChange={setWeekdays}
          >
            <Group mt="xs">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(
                (name, i) => (
                  <Checkbox key={name} value={String(i)} label={name} />
                ),
              )}
            </Group>
          </Checkbox.Group>
          <Textarea
            label="Reason for recurring execution"
            value={reason}
            onChange={(e) => setReason(e.currentTarget.value)}
            required
          />
          <Button
            color="orange"
            disabled={
              (template === 'query' ? !documentId : !targetId || !objectId) ||
              !weekdays.length ||
              reason.trim().length < 5
            }
            loading={busy}
            onClick={() => void prepare()}
          >
            Prepare schedule review
          </Button>
        </Stack>
      </details>
      <Modal
        opened={Boolean(history)}
        onClose={() => setHistory(undefined)}
        title="Scheduled run history"
        size="xl"
      >
        <RecordTable rows={history || []} label="Schedule runs" />
      </Modal>
      <Modal
        opened={Boolean(pending)}
        onClose={() => !busy && setPending(undefined)}
        title="Approve recurring database execution"
        centered
        size="lg"
      >
        <Stack>
          <Alert color="orange">
            {pending?.review.title} · saved revision{' '}
            {pending?.review.documentRevision} · mode{' '}
            {String(pending?.input.mode)}. Every future run uses this exact
            approved query and its resource limits.
          </Alert>
          <Code block>{pending?.review.sql}</Code>
          <Text size="sm">
            Next occurrence:{' '}
            {pending && new Date(pending.review.nextRun).toLocaleString()}
          </Text>
          <Text size="sm">Reason: {String(pending?.input.reason || '')}</Text>
          <Button color="orange" loading={busy} onClick={() => void create()}>
            Approve & enable schedule
          </Button>
        </Stack>
      </Modal>
    </Stack>
  );
}
