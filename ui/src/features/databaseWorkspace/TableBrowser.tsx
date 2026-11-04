import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Checkbox,
  Drawer,
  Group,
  Modal,
  Menu,
  Stack,
  Text,
  Textarea,
  Tooltip,
} from '@mantine/core';
import {
  IconArrowLeft,
  IconArrowRight,
  IconCode,
  IconEdit,
  IconFilter,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import {
  MantineReactTable,
  useMantineReactTable,
  type MRT_ColumnDef,
  type MRT_SortingState,
} from 'mantine-react-table';
import {
  api,
  activeJob,
  message,
  type Capabilities,
  type Field,
  type Filter,
  type Job,
  type ObjectDetails,
  type WireValue,
} from './api';
import { FilterEditor } from './FilterEditor';
import { ImportWizard } from './ImportWizard';

type Change = {
  clientId: string;
  key: string;
  kind: 'insert' | 'update' | 'delete';
  original?: Record<string, WireValue>;
  values: Record<string, WireValue>;
};
type Row = Record<string, WireValue>;
type Edit = {
  kind: 'insert' | 'update';
  original?: Row;
  values: Record<string, WireValue | undefined>;
};
export function TableBrowser({
  targetId,
  objectId,
  capabilities,
  onSql,
}: {
  targetId: string;
  objectId: string;
  capabilities: Capabilities;
  onSql: (sql: string, parameters: WireValue[]) => void;
}) {
  const details = useQuery({
    queryKey: ['database-workspace-object', targetId, objectId],
    queryFn: () => api.object(targetId, objectId),
    retry: false,
  });
  const [importOpen, setImportOpen] = useState(false);
  const [job, setJob] = useState<Job>(),
    [cursor, setCursor] = useState<string>(),
    [previous, setPrevious] = useState<Array<string | undefined>>([]),
    [sorting, setSorting] = useState<MRT_SortingState>([]),
    [reload, setReload] = useState(0);
  const [filter, setFilter] = useState<Filter>(),
    [filterDraft, setFilterDraft] = useState<Filter>({
      group: 'and',
      children: [],
    }),
    [filterOpen, setFilterOpen] = useState(false);
  const [changes, setChanges] = useState<Change[]>([]),
    [edit, setEdit] = useState<Edit>(),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false),
    [requestId, setRequestId] = useState(''),
    [reason, setReason] = useState(''),
    [review, setReview] =
      useState<Awaited<ReturnType<typeof api.changePlan>>>(),
    [busy, setBusy] = useState(false),
    [writeJob, setWriteJob] = useState<Job>();
  const columnsMeta = details.data?.columns || [],
    primary = columnsMeta.filter((c) => c.primary_key),
    canEdit = Boolean(
      capabilities.writesEnabled &&
        capabilities.actions.write &&
        !capabilities.targets.find((t) => t.id === targetId)?.readOnly &&
        primary.length &&
        ['r', 'p'].includes(details.data?.kind || ''),
    );
  const page = useQuery({
    queryKey: ['database-workspace-table-page', job?.id],
    queryFn: () => api.tablePage(job!.id),
    enabled: job?.status === 'succeeded',
    retry: false,
    gcTime: 60000,
  });
  useEffect(() => {
    let disposed = false;
    setError('');
    setJob(undefined);
    const sort = sorting.map((s) => ({
      column: s.id,
      direction: s.desc ? 'desc' : 'asc',
      nulls: 'last',
    }));
    void api
      .browse({
        targetId,
        objectId,
        filter,
        sort,
        cursor,
        pageSize: Math.min(
          200,
          Number(capabilities.limits.resultPageRows || 200),
        ),
      })
      .then((result) => {
        if (disposed) void api.cancel(result.job.id).catch(() => {});
        else setJob(result.job);
      })
      .catch((e) => {
        if (!disposed) setError(message(e));
      });
    return () => {
      disposed = true;
    };
  }, [
    targetId,
    objectId,
    filter,
    sorting,
    cursor,
    reload,
    capabilities.limits.resultPageRows,
  ]);
  const runningIds = [job, writeJob]
    .filter(activeJob)
    .map((j) => j!.id)
    .join('|');
  useEffect(() => {
    if (!runningIds) return;
    let stopped = false;
    const poll = () => {
      void Promise.all(
        runningIds.split('|').map((id) =>
          api
            .job(id)
            .then((next) => {
              if (stopped) return;
              setJob((p) => (p?.id === id ? next : p));
              setWriteJob((p) => (p?.id === id ? next : p));
            })
            .catch(() => {}),
        ),
      );
    };
    poll();
    const timer = window.setInterval(poll, 750);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [runningIds]);
  useEffect(() => {
    if (!writeJob || activeJob(writeJob)) return;
    if (
      writeJob.status === 'succeeded' &&
      writeJob.transactionOutcome === 'committed'
    ) {
      setChanges([]);
      setReviewOpen(false);
      setReview(undefined);
      setCursor(undefined);
      setPrevious([]);
      setReload((n) => n + 1);
      setNotice('Changes committed. The table was refreshed.');
    } else {
      // The consumed review cannot be submitted again. Restore page focus so
      // conflicts/unknown outcomes are visible, with the staged values retained.
      setReview(undefined);
      setReviewOpen(false);
      setError(
        writeJob.error?.message ||
          `Write ${writeJob.status}; transaction ${writeJob.transactionOutcome}.`,
      );
    }
    setWriteJob(undefined);
  }, [writeJob]);
  const fields = useMemo(() => page.data?.fields || [], [page.data?.fields]);
  const data = useMemo(
    () =>
      page.data?.rows.map((row) =>
        Object.fromEntries(fields.map((f, i) => [f.name, row[i]])),
      ) || [],
    [fields, page.data?.rows],
  );
  const rowKey = (row: Row) => JSON.stringify(primary.map((c) => row[c.name]));
  const stage = (change: Change) =>
    setChanges((p) => [...p.filter((c) => c.key !== change.key), change]);
  const columns = useMemo<MRT_ColumnDef<Row>[]>(
    () =>
      fields.map((field) => ({
        id: field.name,
        accessorFn: (row) => row[field.name],
        header: field.name,
        size: 180,
        Header: () => (
          <div>
            <Text size="xs" fw={650}>
              {field.name}
            </Text>
            <Text size="10px" c="dimmed">
              {field.pgType}
            </Text>
          </div>
        ),
        Cell: ({ cell }) => {
          const value = cell.getValue<WireValue>();
          return (
            <Text
              size="xs"
              ff="monospace"
              c={value === null ? 'dimmed' : undefined}
              lineClamp={2}
            >
              {value === null
                ? '⟨NULL⟩'
                : value === ''
                  ? '⟨empty⟩'
                  : value.slice(0, 512)}
            </Text>
          );
        },
      })),
    [fields],
  );
  const table = useMantineReactTable({
    columns,
    data,
    enablePagination: false,
    manualSorting: true,
    enableMultiSort: true,
    enableGlobalFilter: false,
    enableColumnFilters: false,
    enableHiding: true,
    enableColumnOrdering: true,
    enableColumnResizing: true,
    enableColumnPinning: true,
    enableStickyHeader: true,
    enableRowActions:
      canEdit || Boolean(details.data?.constraints.some((c) => c.kind === 'f')),
    state: { sorting, isLoading: activeJob(job) || page.isLoading },
    onSortingChange: (next) => {
      setSorting(next);
      setCursor(undefined);
      setPrevious([]);
    },
    initialState: { density: 'xs' },
    mantinePaperProps: { withBorder: false, shadow: undefined },
    mantineTableContainerProps: {
      style: { maxHeight: 'calc(100dvh - 370px)' },
    },
    mantineTableProps: {
      striped: true,
      highlightOnHover: true,
      withColumnBorders: true,
      'aria-label': `${details.data?.name || 'Table'} data`,
    },
    renderRowActions: ({ row }) => (
      <Group gap={2}>
        <Tooltip label="Stage row edit">
          <ActionIcon
            variant="subtle"
            aria-label="Edit row"
            disabled={!canEdit}
            onClick={() => {
              const pending = changes.find(
                (c) => c.key === rowKey(row.original),
              );
              setEdit({
                kind: 'update',
                original: row.original,
                values: { ...row.original, ...pending?.values },
              });
            }}
          >
            <IconEdit size={14} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Stage row deletion">
          <ActionIcon
            variant="subtle"
            color="red"
            aria-label="Stage row deletion"
            disabled={!canEdit}
            onClick={() =>
              stage({
                clientId: crypto.randomUUID(),
                key: rowKey(row.original),
                kind: 'delete',
                original: row.original,
                values: {},
              })
            }
          >
            <IconTrash size={14} />
          </ActionIcon>
        </Tooltip>
        {details.data?.constraints.some((c) => c.kind === 'f') && (
          <Menu>
            <Menu.Target>
              <Button size="compact-xs" variant="subtle">
                Related rows
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              {details.data.constraints
                .filter(
                  (c) =>
                    c.kind === 'f' &&
                    c.target_name &&
                    c.source_columns?.length &&
                    c.target_columns?.length,
                )
                .map((c) => (
                  <Menu.Item
                    key={c.name}
                    disabled={c.source_columns!.some(
                      (name) => row.original[name] == null,
                    )}
                    onClick={() => {
                      const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
                      onSql(
                        `SELECT * FROM ${q(c.target_schema!)}.${q(c.target_name!)}\nWHERE ${c.target_columns!.map((name, i) => `${q(name)} IS NOT DISTINCT FROM $${i + 1}`).join(' AND ')}\nLIMIT 100;`,
                        c.source_columns!.map((name) => row.original[name]),
                      );
                    }}
                  >
                    {c.name}: {c.target_schema}.{c.target_name}
                  </Menu.Item>
                ))}
            </Menu.Dropdown>
          </Menu>
        )}
      </Group>
    ),
    renderTopToolbarCustomActions: () => (
      <Group gap={5}>
        <Badge variant="light" color="gray" size="sm">
          Live table · page {previous.length + 1}
        </Badge>
        <Button
          size="compact-xs"
          variant={filter ? 'light' : 'subtle'}
          leftSection={<IconFilter size={13} />}
          onClick={() => {
            setFilterDraft(filter || { group: 'and', children: [] });
            setFilterOpen(true);
          }}
        >
          Filter database
        </Button>
        <ActionIcon
          aria-label="Refresh table data"
          variant="subtle"
          onClick={() => setReload((n) => n + 1)}
        >
          <IconRefresh size={14} />
        </ActionIcon>
        {canEdit && (
          <Button
            size="compact-xs"
            variant="subtle"
            leftSection={<IconPlus size={13} />}
            onClick={() => setEdit({ kind: 'insert', values: {} })}
          >
            Insert row
          </Button>
        )}
      </Group>
    ),
  });
  const reset = () => {
    setCursor(undefined);
    setPrevious([]);
  };
  async function prepare() {
    setRequestId(crypto.randomUUID());
    setBusy(true);
    setError('');
    try {
      setReview(
        await api.changePlan({
          targetId,
          objectId,
          reason,
          changes: changes.map(({ clientId, key, ...c }) => c),
        }),
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function commit() {
    if (!review) return;
    setBusy(true);
    try {
      setWriteJob(
        await api.commitChanges({
          targetId,
          objectId,
          reason,
          changes: changes.map(({ clientId, key, ...c }) => c),
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
    <div
      className="dw-table-browser"
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
      }}
    >
      <div className="dw-toolbar">
        <IconTableLabel object={details.data} />
        {canEdit && (
          <Button size="xs" variant="light" onClick={() => setImportOpen(true)}>
            Import data
          </Button>
        )}
        <Button
          ml="auto"
          size="xs"
          variant="subtle"
          leftSection={<IconCode size={14} />}
          onClick={() =>
            onSql(
              job?.outcomes[0]?.sql ||
                `SELECT * FROM ${details.data?.qualifiedName || 'public.table_name'} LIMIT 1000;`,
              [],
            )
          }
        >
          Open SQL
        </Button>
      </div>
      {error && (
        <Alert color="red" withCloseButton onClose={() => setError('')}>
          {error}
        </Alert>
      )}
      {notice && (
        <Alert color="teal" withCloseButton onClose={() => setNotice('')}>
          {notice}
        </Alert>
      )}
      {(job?.status === 'failed' || job?.status === 'outcome_unknown') && (
        <Alert color="red">{job.error?.message || job.status}</Alert>
      )}
      {page.error && <Alert color="red">{message(page.error)}</Alert>}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <MantineReactTable table={table} />
      </div>
      <Group
        p="xs"
        justify="space-between"
        style={{ borderTop: '1px solid var(--dw-border)' }}
      >
        <Text size="xs" c="dimmed">
          {page.data?.rows.length || 0} rows ·{' '}
          {page.data?.stable
            ? 'Primary-key cursor · live data'
            : primary.length
              ? 'Loading…'
              : 'No stable key; next-page navigation unavailable'}
        </Text>
        <Group gap={6}>
          <Button
            size="compact-xs"
            variant="default"
            leftSection={<IconArrowLeft size={12} />}
            disabled={!previous.length || activeJob(job)}
            onClick={() => {
              setCursor(previous[previous.length - 1]);
              setPrevious((p) => p.slice(0, -1));
            }}
          >
            Previous
          </Button>
          <Button
            size="compact-xs"
            variant="default"
            rightSection={<IconArrowRight size={12} />}
            disabled={!page.data?.nextCursor || activeJob(job)}
            onClick={() => {
              setPrevious((p) => [...p, cursor]);
              setCursor(page.data!.nextCursor!);
            }}
          >
            Next
          </Button>
        </Group>
      </Group>
      {!!changes.length && (
        <div
          style={{
            padding: 12,
            borderTop: '1px solid var(--dw-border)',
            background: 'var(--dw-soft)',
          }}
        >
          <Group justify="space-between">
            <div>
              <Text size="sm" fw={650}>
                {changes.length} pending change(s)
              </Text>
              <Text size="xs" c="dimmed">
                Changes remain staged until reviewed and committed.
              </Text>
            </div>
            <Group>
              <Button
                size="xs"
                variant="default"
                onClick={() => setChanges([])}
              >
                Discard
              </Button>
              <Button
                size="xs"
                color="orange"
                onClick={() => {
                  setReview(undefined);
                  setReviewOpen(true);
                }}
              >
                Review changes
              </Button>
            </Group>
          </Group>
          <Group mt="xs" gap={6}>
            {changes.map((c) => (
              <Badge
                key={c.clientId}
                color={c.kind === 'delete' ? 'red' : 'blue'}
                variant="light"
                rightSection={
                  <IconX
                    size={11}
                    style={{ cursor: 'pointer' }}
                    onClick={() =>
                      setChanges((p) =>
                        p.filter((x) => x.clientId !== c.clientId),
                      )
                    }
                  />
                }
              >
                {c.kind} {c.kind === 'insert' ? 'new row' : c.key}
              </Badge>
            ))}
          </Group>
        </div>
      )}
      {details.data && importOpen && (
        <ImportWizard
          targetId={targetId}
          object={details.data}
          opened={importOpen}
          onClose={() => setImportOpen(false)}
          onCommitted={() => {
            setCursor(undefined);
            setPrevious([]);
            setReload((n) => n + 1);
          }}
        />
      )}
      <Drawer
        opened={filterOpen}
        onClose={() => setFilterOpen(false)}
        title="Filter table data in PostgreSQL"
        position="right"
        size="lg"
      >
        <Stack>
          <Text size="xs" c="dimmed">
            Conditions run on the database. Sorting uses this database's
            collation. Applying a new filter starts at page one.
          </Text>
          <FilterEditor
            fields={columnsMeta.map(
              (c, i) =>
                ({
                  id: c.name,
                  name: c.name,
                  pgType: c.pg_type,
                  oid: c.oid,
                  encoding: 'pg-text',
                }) as Field,
            )}
            value={filterDraft}
            onChange={setFilterDraft}
          />
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => {
                setFilter(undefined);
                reset();
                setFilterOpen(false);
              }}
            >
              Clear
            </Button>
            <Button
              onClick={() => {
                setFilter(
                  'group' in filterDraft && !filterDraft.children.length
                    ? undefined
                    : filterDraft,
                );
                reset();
                setFilterOpen(false);
              }}
            >
              Apply database filter
            </Button>
          </Group>
        </Stack>
      </Drawer>
      <Modal
        opened={Boolean(edit)}
        onClose={() => setEdit(undefined)}
        title={
          edit?.kind === 'insert' ? 'Stage a new row' : 'Stage row changes'
        }
        size="lg"
        centered
      >
        <Stack>
          <Text size="xs" c="dimmed">
            Enter exact PostgreSQL text. Use SQL NULL explicitly. Generated
            fields are read-only; omitted insert fields use their database
            defaults.
          </Text>
          {columnsMeta.map((column) => {
            const value = edit?.values[column.name],
              disabled = Boolean(column.identity || column.generated);
            return (
              <div key={column.name}>
                <Group justify="space-between" mb={3}>
                  <Text size="xs" fw={600}>
                    {column.primary_key ? '◆ ' : ''}
                    {column.name}{' '}
                    <Text span c="dimmed" fw={400}>
                      ({column.type})
                    </Text>
                  </Text>
                  <Group gap={10}>
                    {edit?.kind === 'insert' && !disabled && (
                      <Checkbox
                        size="xs"
                        label="Use default / omit"
                        checked={value === undefined}
                        onChange={(e) =>
                          setEdit((p) =>
                            p
                              ? {
                                  ...p,
                                  values: {
                                    ...p.values,
                                    [column.name]: e.currentTarget.checked
                                      ? undefined
                                      : '',
                                  },
                                }
                              : p,
                          )
                        }
                      />
                    )}
                    <Checkbox
                      size="xs"
                      label="SQL NULL"
                      checked={value === null}
                      disabled={column.not_null || disabled}
                      onChange={(e) =>
                        setEdit((p) =>
                          p
                            ? {
                                ...p,
                                values: {
                                  ...p.values,
                                  [column.name]: e.currentTarget.checked
                                    ? null
                                    : '',
                                },
                              }
                            : p,
                        )
                      }
                    />
                  </Group>
                </Group>
                <Textarea
                  aria-label={`Value for ${column.name}`}
                  autosize
                  minRows={1}
                  maxRows={8}
                  value={value ?? ''}
                  disabled={disabled || value === null || value === undefined}
                  onChange={(e) => {
                    const text = e.currentTarget.value;
                    setEdit((p) =>
                      p
                        ? { ...p, values: { ...p.values, [column.name]: text } }
                        : p,
                    );
                  }}
                  styles={{
                    input: {
                      fontFamily: 'ui-monospace,monospace',
                      fontSize: 12,
                    },
                  }}
                />
              </div>
            );
          })}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setEdit(undefined)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!edit) return;
                const values = Object.fromEntries(
                  Object.entries(edit.values).filter(
                    ([name, value]) =>
                      value !== undefined &&
                      (edit.kind === 'insert' ||
                        value !== edit.original?.[name]),
                  ),
                ) as Row;
                if (edit.kind === 'update' && !Object.keys(values).length) {
                  setEdit(undefined);
                  return;
                }
                stage({
                  clientId: crypto.randomUUID(),
                  key:
                    edit.kind === 'insert'
                      ? crypto.randomUUID()
                      : rowKey(edit.original!),
                  kind: edit.kind,
                  original: edit.original,
                  values,
                });
                setEdit(undefined);
              }}
            >
              Stage {edit?.kind === 'insert' ? 'insert' : 'changes'}
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Modal
        opened={reviewOpen}
        onClose={() => !busy && !activeJob(writeJob) && setReviewOpen(false)}
        title="Review staged database changes"
        size="lg"
        centered
      >
        <Stack>
          {error && <Alert color="red">{error}</Alert>}
          <Alert color="orange">
            This changes PostgreSQL directly. Application notifications and
            payment integrations are not invoked. Triggers and foreign-key
            cascades may affect related rows.
          </Alert>
          <Textarea
            label="Reason"
            required
            value={reason}
            disabled={Boolean(review)}
            onChange={(e) => setReason(e.currentTarget.value)}
          />
          {review ? (
            <>
              <Text size="sm">
                {changes.length} operation(s), one atomic transaction. Original
                values and schema are checked again before commit.
              </Text>
              {review.statements.map((s, i) => (
                <div key={i}>
                  <pre className="dw-review-sql">{s.sql}</pre>
                  <Text
                    size="xs"
                    c="dimmed"
                    style={{ overflowWrap: 'anywhere' }}
                  >
                    Bound values: {JSON.stringify(s.parameters)}
                  </Text>
                </div>
              ))}
              <Group justify="flex-end">
                <Button
                  variant="default"
                  disabled={busy || activeJob(writeJob)}
                  onClick={() => setReview(undefined)}
                >
                  Edit review
                </Button>
                <Button
                  color="orange"
                  loading={busy || activeJob(writeJob)}
                  onClick={() => void commit()}
                >
                  Commit reviewed changes
                </Button>
              </Group>
            </>
          ) : (
            <Button
              disabled={reason.trim().length < 5}
              loading={busy}
              onClick={() => void prepare()}
            >
              Prepare exact change review
            </Button>
          )}
        </Stack>
      </Modal>
    </div>
  );
}
function IconTableLabel({ object }: { object?: ObjectDetails }) {
  return (
    <Group gap={7}>
      <Text fw={650} size="sm">
        {object?.schema}.{object?.name || 'Loading table…'}
      </Text>
      <Badge variant="light" color="gray" size="sm">
        Table data
      </Badge>
    </Group>
  );
}
