import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  FileInput,
  Group,
  Modal,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { api, activeJob, message, type Job, type ObjectDetails } from './api';
import { RecordTable } from './RecordTable';

export function ImportWizard({
  targetId,
  object,
  opened,
  onClose,
  onCommitted,
}: {
  targetId: string;
  object: ObjectDetails;
  opened: boolean;
  onClose: () => void;
  onCommitted: () => void;
}) {
  const [file, setFile] = useState<File | null>(null),
    [delimiter, setDelimiter] = useState(','),
    [nullToken, setNullToken] = useState('\\N'),
    [stage, setStage] = useState<{
      id: string;
      headers: string[];
      sample: (string | null)[][];
      rows: number;
    }>(),
    [mapping, setMapping] = useState<Record<string, string>>({}),
    [policy, setPolicy] = useState('insert'),
    [reason, setReason] = useState(''),
    [error, setError] = useState(''),
    [validation, setValidation] = useState<Record<string, unknown>[]>([]),
    [busy, setBusy] = useState(false),
    [review, setReview] = useState<{
      token: string;
      rows: number;
      columns: string[];
      sample: (string | null)[][];
      expiresAt: string;
    }>(),
    [job, setJob] = useState<Job>();
  const columns = object.columns.filter((c) => !c.generated && !c.identity),
    keys = object.columns.filter((c) => c.primary_key).map((c) => c.name);
  const [requestId, setRequestId] = useState('');
  useEffect(() => {
    if (!job || !activeJob(job)) return;
    const timer = window.setInterval(
      () =>
        void api
          .job(job.id)
          .then(setJob)
          .catch((e) => setError(message(e))),
      600,
    );
    return () => clearInterval(timer);
  }, [job]);
  useEffect(() => {
    if (job?.status === 'succeeded' && job.transactionOutcome === 'committed')
      onCommitted();
  }, [job?.status, job?.transactionOutcome]); // eslint-disable-line react-hooks/exhaustive-deps
  async function upload() {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const content = new TextDecoder('utf-8', { fatal: true }).decode(
        await file.arrayBuffer(),
      );
      const saved = await api.stageImport({
        targetId,
        objectId: object.id,
        content,
        format: file.name.toLowerCase().endsWith('.json') ? 'json' : 'csv',
        delimiter,
        nullToken,
      });
      setStage(saved);
      setMapping(
        Object.fromEntries(
          saved.headers
            .filter((h: string) => columns.some((c) => c.name === h))
            .map((h: string) => [h, h]),
        ),
      );
      setReview(undefined);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function prepare() {
    if (!stage) return;
    setBusy(true);
    setError('');
    setValidation([]);
    try {
      setReview(
        await api.reviewImport(stage.id, {
          mapping,
          duplicatePolicy: policy,
          keys: policy === 'insert' ? [] : keys,
          reason,
        }),
      );
      setRequestId(crypto.randomUUID());
    } catch (e) {
      setError(message(e));
      setValidation(
        (e as { response?: { data?: { errors?: Record<string, unknown>[] } } })
          .response?.data?.errors || [],
      );
    } finally {
      setBusy(false);
    }
  }
  async function commit() {
    if (!stage || !review) return;
    setBusy(true);
    setError('');
    try {
      setJob(
        await api.reviewImport(stage.id, {
          mapping,
          duplicatePolicy: policy,
          keys: policy === 'insert' ? [] : keys,
          reason,
          action: 'commit',
          reviewToken: review.token,
          idempotencyKey: requestId,
        }),
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      opened={opened}
      onClose={() => !busy && !activeJob(job) && onClose()}
      title={`Import into ${object.schema}.${object.name}`}
      size="xl"
      centered
    >
      <Stack>
        {error && <Alert color="red">{error}</Alert>}
        {!!validation.length && (
          <RecordTable rows={validation} label="Import validation errors" />
        )}
        {job ? (
          <>
            <Alert
              color={
                job.status === 'succeeded' ? 'teal' : job.error ? 'red' : 'blue'
              }
            >
              {job.status.replace(/_/g, ' ')} · transaction{' '}
              {job.transactionOutcome.replace(/_/g, ' ')}
              {job.error && ` · ${job.error.message}`}
            </Alert>
            <Button disabled={activeJob(job)} onClick={onClose}>
              Close import
            </Button>
          </>
        ) : review ? (
          <>
            <Alert color="orange" title="Review atomic import">
              {review.rows} input rows into {object.schema}.{object.name}.
              Duplicate policy: {policy}. Constraints and triggers run during
              the actual import; a failure rolls back the entire transaction.
            </Alert>
            <RecordTable
              rows={review.sample.map((row) =>
                Object.fromEntries(review.columns.map((c, i) => [c, row[i]])),
              )}
              label="Mapped import sample"
            />
            <Text size="sm">Reason: {reason}</Text>
            <Text size="xs" c="dimmed">
              Review expires {new Date(review.expiresAt).toLocaleTimeString()}.
            </Text>
            <Group justify="end">
              <Button variant="default" onClick={() => setReview(undefined)}>
                Edit mapping
              </Button>
              <Button
                color="orange"
                loading={busy}
                onClick={() => void commit()}
              >
                Import reviewed rows
              </Button>
            </Group>
          </>
        ) : stage ? (
          <>
            <Text size="sm">
              {stage.rows} staged rows. Unmapped table columns use defaults;
              generated columns are omitted.
            </Text>
            {stage.headers.map((header) => (
              <Select
                key={header}
                label={`File: ${header}`}
                value={mapping[header] || null}
                clearable
                placeholder="Do not import this column"
                data={columns.map((c) => ({
                  value: c.name,
                  label: `${c.name} · ${c.type}`,
                }))}
                onChange={(v) =>
                  setMapping((p) => ({ ...p, [header]: v || '' }))
                }
              />
            ))}
            <Select
              label="Existing primary keys"
              value={policy}
              allowDeselect={false}
              data={[
                {
                  value: 'insert',
                  label: 'Insert only; conflicts roll back the import',
                },
                {
                  value: 'upsert',
                  label: `Update rows with matching primary key (${keys.join(', ')})`,
                  disabled: !keys.length,
                },
                {
                  value: 'skip',
                  label: 'Skip existing primary keys',
                  disabled: !keys.length,
                },
              ]}
              onChange={(v) => setPolicy(v || 'insert')}
            />
            <Textarea
              label="Reason"
              value={reason}
              onChange={(e) => setReason(e.currentTarget.value)}
              required
            />
            <Group justify="end">
              <Button
                variant="default"
                onClick={() => {
                  setStage(undefined);
                  setValidation([]);
                }}
              >
                Choose another file
              </Button>
              <Button
                disabled={reason.trim().length < 5}
                loading={busy}
                onClick={() => void prepare()}
              >
                Validate & review import
              </Button>
            </Group>
          </>
        ) : (
          <>
            <Text size="sm">
              Upload UTF-8 CSV or JSON. JSON values must be exact text strings
              or null. Large files must be split into explicitly reviewed,
              separately committed imports.
            </Text>
            <FileInput
              label="Data file"
              accept=".csv,.json,.txt"
              value={file}
              onChange={setFile}
            />
            <Group grow>
              <Select
                label="CSV delimiter"
                value={delimiter}
                onChange={(v) => setDelimiter(v || ',')}
                data={[
                  { value: ',', label: 'Comma' },
                  { value: ';', label: 'Semicolon' },
                  { value: '\t', label: 'Tab' },
                  { value: '|', label: 'Pipe' },
                ]}
              />
              <TextInput
                label="CSV SQL NULL token"
                value={nullToken}
                onChange={(e) => setNullToken(e.currentTarget.value)}
                description="Empty text remains an empty string."
              />
            </Group>
            <Button
              disabled={!file}
              loading={busy}
              onClick={() => void upload()}
            >
              Stage data file
            </Button>
          </>
        )}
      </Stack>
    </Modal>
  );
}
