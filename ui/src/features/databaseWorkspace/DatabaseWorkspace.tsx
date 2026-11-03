import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { consumeWorkspaceQuery, hasWorkspaceQuery } from './pendingQuery';
import { useQuery } from '@tanstack/react-query';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Code,
  Divider,
  Group,
  Loader,
  Menu,
  Modal,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { Link, useSearchParams } from 'react-router-dom';
import {
  IconArrowLeft,
  IconBraces,
  IconChevronDown,
  IconCode,
  IconDatabase,
  IconDeviceFloppy,
  IconFileCode,
  IconFolder,
  IconHistory,
  IconLayoutSidebarLeftCollapse,
  IconPlayerPlay,
  IconPlayerStop,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconTable,
  IconTerminal2,
  IconX,
  IconActivity,
  IconLock,
} from '@tabler/icons-react';
import { format } from 'sql-formatter';
import {
  api,
  activeJob,
  message,
  type Capabilities,
  type CatalogObject,
  type Document,
  type Input,
  type Job,
  type Mode,
  type ObjectDetails,
  type Review,
} from './api';
import { SqlEditor, type EditorHandle } from './SqlEditor';
import { ResultGrid } from './ResultGrid';
import { TableBrowser } from './TableBrowser';
import { SessionPanel } from './SessionPanel';
import { ActivityPanel } from './ActivityPanel';
import { PlanViewer } from './PlanViewer';
import { AdministrationPanel } from './AdministrationPanel';
import { ParameterForm } from './ParameterForm';
import { QueryLibrary } from './QueryLibrary';
import { downloadBookingBlob } from '../../utils/bookingTableExport';
import './DatabaseWorkspace.css';

type QueryTab = {
  id: string;
  title: string;
  sql: string;
  targetId: string;
  mode: Mode;
  dirty: boolean;
  jobId?: string;
  documentId?: string;
  documentRevision?: number;
  objectId?: string;
  parameters?: string;
  parameterDefinitions?: Document['value']['parameterDefinitions'];
};
const newTab = (
  targetId = '',
  sql = 'SELECT NOW();',
  title = 'Untitled query',
): QueryTab => ({
  id: crypto.randomUUID(),
  title,
  sql,
  targetId,
  mode: 'read',
  dirty: false,
});
const statusColor = (status?: string) =>
  status === 'succeeded'
    ? 'teal'
    : ['failed', 'outcome_unknown'].includes(status || '')
      ? 'red'
      : status === 'cancelled'
        ? 'gray'
        : 'blue';
const statusLabel = (job?: Job) =>
  !job
    ? 'Ready'
    : job.status === 'succeeded'
      ? job.transactionOutcome === 'committed'
        ? 'Completed and committed'
        : job.transactionOutcome === 'rolled_back'
          ? 'Diagnostic completed · rolled back'
          : 'Read completed'
      : job.status === 'failed'
        ? job.transactionOutcome === 'rolled_back'
          ? 'Failed · rolled back'
          : 'Failed'
        : job.status === 'outcome_unknown'
          ? 'Outcome unknown · do not rerun automatically'
          : job.status.replace(/_/g, ' ');

function Explorer({
  objects,
  loading,
  search,
  onSearch,
  onOpen,
  onInspect,
  mobile = false,
  page = 0,
  onPage,
}: {
  objects: CatalogObject[];
  loading: boolean;
  search: string;
  onSearch: (v: string) => void;
  onOpen: (o: CatalogObject) => void;
  onInspect: (o: CatalogObject) => void;
  mobile?: boolean;
  page?: number;
  onPage?: (page: number) => void;
}) {
  return (
    <aside
      className={`dw-explorer${mobile ? ' dw-mobile-objects' : ''}`}
      aria-label="Database objects"
    >
      <div className="dw-explorer-head">
        <Group justify="space-between">
          <Text size="xs" fw={700}>
            OBJECT EXPLORER
          </Text>
          <Badge size="xs" variant="light" color="gray">
            {objects.length}
          </Badge>
        </Group>
        <TextInput
          size="xs"
          aria-label="Search database objects"
          placeholder="Find a table or view…"
          leftSection={<IconSearch size={14} />}
          value={search}
          onChange={(e) => onSearch(e.currentTarget.value)}
        />
      </div>
      <div className="dw-explorer-list">
        {loading && <Loader size="xs" m="md" />}
        {[...new Set(objects.map((o) => o.schema))].map((schema) => (
          <div key={schema}>
            <div className="dw-section-label">{schema}</div>
            {objects
              .filter((o) => o.schema === schema)
              .map((object) => (
                <div key={object.id}>
                  <button
                    className="dw-object"
                    onClick={() => onOpen(object)}
                    onDoubleClick={() => onInspect(object)}
                    title={`${object.schema}.${object.name}${object.comment ? ` — ${object.comment}` : ''}`}
                  >
                    <IconTable size={14} stroke={1.5} />
                    <span>{object.name}</span>
                    <span
                      style={{
                        marginLeft: 'auto',
                        fontSize: 9,
                        color: 'var(--dw-muted)',
                      }}
                    >
                      {['v', 'm'].includes(object.kind)
                        ? 'VIEW'
                        : object.kind === 'S'
                          ? 'SEQ'
                          : ''}
                    </span>
                  </button>
                </div>
              ))}
          </div>
        ))}
        {!loading && !objects.length && (
          <Text size="xs" c="dimmed" p="md">
            No matching objects. Connection permissions determine what appears
            here.
          </Text>
        )}
      </div>
      <Text size="10px" c="dimmed" p="sm">
        Select to inspect · use Browse data to open a query
      </Text>
      {onPage && (
        <Group p="xs" justify="space-between">
          <Button
            size="compact-xs"
            variant="subtle"
            disabled={page === 0 || loading}
            onClick={() => onPage(page - 1)}
          >
            Previous
          </Button>
          <Text size="xs">Page {page + 1}</Text>
          <Button
            size="compact-xs"
            variant="subtle"
            disabled={objects.length < 100 || loading}
            onClick={() => onPage(page + 1)}
          >
            Next
          </Button>
        </Group>
      )}
    </aside>
  );
}
function ObjectInspector({
  object,
  onBrowse,
  onClose,
}: {
  object: ObjectDetails;
  onBrowse: () => void;
  onClose?: () => void;
}) {
  const [template, setTemplate] = useState('');
  useEffect(() => setTemplate(''), [object.id]);
  const generate = (kind: string) => {
    const q = (s: string) => `"${s.replace(/"/g, '""')}"`,
      table = object.qualifiedName,
      keys = object.columns.filter((c) => c.primary_key),
      columns = object.columns.filter((c) => !c.generated && !c.identity),
      editable = columns.filter((c) => !c.primary_key);
    if (kind === 'SELECT')
      return `SELECT ${object.columns.map((c) => q(c.name)).join(', ')}\nFROM ${table}\nLIMIT 100;`;
    if (kind === 'INSERT')
      return `INSERT INTO ${table} (${columns.map((c) => q(c.name)).join(', ')})\nVALUES (${columns.map((c, i) => `$${i + 1}::${c.type}`).join(', ')})\nRETURNING *;`;
    if (!keys.length)
      return '-- A stable primary key is required before preparing an UPDATE or DELETE template.';
    const offset = kind === 'UPDATE' ? editable.length : 0,
      where = keys
        .map(
          (c, i) =>
            `${q(c.name)} IS NOT DISTINCT FROM $${offset + i + 1}::${c.type}`,
        )
        .join(' AND ');
    return kind === 'UPDATE'
      ? `UPDATE ${table}\nSET ${editable.map((c, i) => `${q(c.name)} = $${i + 1}::${c.type}`).join(', ')}\nWHERE ${where}\nRETURNING *;`
      : `DELETE FROM ${table}\nWHERE ${where}\nRETURNING *;`;
  };
  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Text fw={700} size="sm">
          {object.name}
        </Text>
        {onClose && (
          <ActionIcon
            variant="subtle"
            aria-label="Close object inspector"
            onClick={onClose}
          >
            <IconX size={15} />
          </ActionIcon>
        )}
      </Group>
      <Code>
        {object.schema}.{object.name}
      </Code>
      {object.comment && (
        <Text size="xs" c="dimmed">
          {object.comment}
        </Text>
      )}
      <Group gap={6}>
        <Badge variant="light" color="gray">
          {object.kind === 'r' || object.kind === 'p'
            ? 'Table'
            : object.kind === 'v'
              ? 'View'
              : object.kind === 'm'
                ? 'Materialized view'
                : object.kind}
        </Badge>
        {object.row_security && <Badge variant="light">Row security</Badge>}
      </Group>
      <Text size="xs" c="dimmed">
        Owner: {object.owner || 'unavailable'} ·{' '}
        {Number(object.size_bytes || 0).toLocaleString()} bytes
      </Text>
      <Button
        size="compact-xs"
        variant="subtle"
        onClick={() =>
          void navigator.clipboard.writeText(
            object.qualifiedName || object.name,
          )
        }
      >
        Copy qualified name
      </Button>
      {['r', 'p', 'v', 'm', 'f'].includes(object.kind) && (
        <Button
          size="xs"
          variant="light"
          leftSection={<IconTable size={14} />}
          onClick={onBrowse}
        >
          Browse data
        </Button>
      )}
      {!!object.columns.length && (
        <>
          <Menu>
            <Menu.Target>
              <Button size="xs" variant="default">
                Generate SQL template
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              {['SELECT', 'INSERT', 'UPDATE', 'DELETE'].map((kind) => (
                <Menu.Item
                  key={kind}
                  onClick={() => setTemplate(generate(kind))}
                >
                  {kind}
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
          {template && (
            <>
              <Code block style={{ fontSize: 11, whiteSpace: 'pre-wrap' }}>
                {template}
              </Code>
              <Button
                size="compact-xs"
                variant="subtle"
                onClick={() => void navigator.clipboard.writeText(template)}
              >
                Copy inert SQL template
              </Button>
            </>
          )}
        </>
      )}
      {object.definition && (
        <>
          <Divider label="Definition" />
          <Code block style={{ fontSize: 11, whiteSpace: 'pre-wrap' }}>
            {object.definition}
          </Code>
        </>
      )}
      <Divider label="Columns" />
      {object.columns.map((c) => (
        <div key={c.ordinal}>
          <Group justify="space-between" gap="xs">
            <Text size="xs" fw={c.primary_key ? 700 : 500}>
              {c.primary_key ? '◆ ' : ''}
              {c.name}
            </Text>
            <Text size="10px" c="dimmed">
              {c.type}
            </Text>
          </Group>
          {c.default_value && (
            <Text size="10px" c="dimmed" lineClamp={2}>
              Default: {c.default_value}
            </Text>
          )}
        </div>
      ))}
      {!!object.constraints.length && (
        <>
          <Divider label="Constraints" />
          {object.constraints.map((c) => (
            <div key={c.name}>
              <Text size="xs" fw={600}>
                {c.name}
              </Text>
              <Code block style={{ fontSize: 10, whiteSpace: 'pre-wrap' }}>
                {c.definition}
              </Code>
            </div>
          ))}
        </>
      )}
      {!!object.indexes.length && (
        <>
          <Divider label="Indexes" />
          {object.indexes.map((i) => (
            <div key={i.name}>
              <Text size="xs">
                {i.name}
                {!i.valid ? ' · invalid' : ''}
              </Text>
              <Code block style={{ fontSize: 10, whiteSpace: 'pre-wrap' }}>
                {i.definition}
              </Code>
            </div>
          ))}
        </>
      )}
      {(['policies', 'triggers', 'dependencies', 'partitions'] as const).map(
        (category) =>
          object[category]?.length ? (
            <details key={category}>
              <summary>
                {category[0].toUpperCase() + category.slice(1)} (
                {object[category]!.length})
              </summary>
              {object[category]!.map((row, index) => (
                <Code
                  key={index}
                  block
                  style={{
                    fontSize: 10,
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'anywhere',
                  }}
                >
                  {JSON.stringify(row, null, 2)}
                </Code>
              ))}
            </details>
          ) : null,
      )}
      {object.metadata && (
        <details>
          <summary>Object properties</summary>
          <Code block style={{ fontSize: 10, whiteSpace: 'pre-wrap' }}>
            {JSON.stringify(object.metadata, null, 2)}
          </Code>
        </details>
      )}
    </Stack>
  );
}

export default function DatabaseWorkspace() {
  const [urlParams, setUrlParams] = useSearchParams(),
    sharedId = urlParams.get('share');
  const mobile = useMediaQuery('(max-width:760px)');
  const [viewportHeight, setViewportHeight] = useState(
    window.visualViewport?.height || window.innerHeight,
  );
  const keyboardOpen = Boolean(
    mobile && viewportHeight < window.innerHeight * 0.78,
  );
  useEffect(() => {
    const resize = () =>
      setViewportHeight(window.visualViewport?.height || window.innerHeight);
    window.visualViewport?.addEventListener('resize', resize);
    return () => window.visualViewport?.removeEventListener('resize', resize);
  }, []);
  useEffect(() => {
    if (!mobile) setSection((s) => (s === 'results' ? 'query' : s));
  }, [mobile]);
  const capabilities = useQuery({
    queryKey: ['database-workspace-capabilities'],
    queryFn: api.capabilities,
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const [tabs, setTabs] = useState<QueryTab[]>([newTab()]),
    [active, setActive] = useState(''),
    [section, setSection] = useState(
      urlParams.get('section') === 'recovery' ? 'admin' : 'query',
    );
  const [category, setCategory] = useState('relations');
  const [catalogPage, setCatalogPage] = useState(0),
    [plainEditor, setPlainEditor] = useState(false),
    [wrapping, setWrapping] = useState(true),
    [fontSize, setFontSize] = useState(14),
    [renaming, setRenaming] = useState(false),
    [tabTitle, setTabTitle] = useState(''),
    [closeOthers, setCloseOthers] = useState(false);
  const [search, setSearch] = useState(''),
    [explorerVisible, setExplorerVisible] = useState(true),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [recentObjects, setRecentObjects] = useState<
      Array<{ targetId: string; object: CatalogObject }>
    >([]),
    [favoriteObjects, setFavoriteObjects] = useState<
      Array<{ targetId: string; object: CatalogObject }>
    >([]);
  const [jobs, setJobs] = useState<Record<string, Job>>({}),
    [selectedObject, setSelectedObject] = useState<CatalogObject>(),
    [resultTab, setResultTab] = useState('data'),
    [resultIndex, setResultIndex] = useState(0);
  const [parametersOpen, setParametersOpen] = useState(false),
    [running, setRunning] = useState(false);
  const [pending, setPending] = useState<{ input: Input; tabId: string }>(),
    [reason, setReason] = useState(''),
    [review, setReview] = useState<Review>(),
    [saveOpen, setSaveOpen] = useState(false),
    [saveTitle, setSaveTitle] = useState(''),
    [saveFolder, setSaveFolder] = useState(''),
    [closeTab, setCloseTab] = useState<string>();
  const [restored, setRestored] = useState(false),
    [draftStatus, setDraftStatus] = useState('');
  const editor = useRef<EditorHandle>(null),
    file = useRef<HTMLInputElement>(null),
    layoutRef = useRef<Document>(),
    draftQueue = useRef<Promise<void>>(Promise.resolve()),
    draftSnapshot = useRef(''),
    savedSnapshot = useRef('');
  const current = tabs.find((t) => t.id === active) || tabs[0],
    target = capabilities.data?.targets.find((t) => t.id === current.targetId),
    job = current.jobId ? jobs[current.jobId] : undefined;
  const ready = Boolean(
      capabilities.data?.enabled && capabilities.data.controlReady,
    ),
    canRun =
      ready &&
      Boolean(capabilities.data?.workerReady) &&
      !running &&
      !activeJob(job);
  const catalog = useQuery({
    queryKey: [
      'database-workspace-catalog',
      current.targetId,
      search,
      category,
      catalogPage,
    ],
    queryFn: () =>
      api.catalog(current.targetId, search, category, catalogPage * 100),
    enabled: ready && Boolean(current.targetId),
    retry: false,
    staleTime: (capabilities.data?.metadataTtlSeconds ?? 60) * 1000,
  });
  const details = useQuery({
    queryKey: [
      'database-workspace-object',
      current.targetId,
      selectedObject?.id,
    ],
    queryFn: () => api.object(current.targetId, selectedObject!.id),
    enabled: ready && Boolean(selectedObject),
    retry: false,
    staleTime: 60000,
  });
  const documents = useQuery({
    queryKey: ['database-workspace-documents'],
    queryFn: () => api.documents('query'),
    enabled: ready,
    retry: false,
  });
  const shared = useQuery({
    queryKey: ['dw-incoming-share', sharedId],
    queryFn: () => api.openShare(sharedId!),
    enabled: ready && Boolean(sharedId),
    retry: false,
  });
  const history = useQuery({
    queryKey: ['database-workspace-history'],
    queryFn: api.history,
    enabled: ready && section === 'history',
    refetchInterval: section === 'history' ? 5000 : false,
    retry: false,
  });
  const patch = useCallback(
    (values: Partial<QueryTab>, id?: string) =>
      setTabs((previous) =>
        previous.map((t) =>
          t.id === (id || active || previous[0].id) ? { ...t, ...values } : t,
        ),
      ),
    [active],
  );
  const parameters = current.parameters || '[]';
  const setParameters = (value: string) => patch({ parameters: value });
  useEffect(() => {
    if (!current.targetId && capabilities.data?.targets.length)
      patch({ targetId: capabilities.data.targets[0].id });
  }, [current.targetId, capabilities.data?.targets, patch]);
  useEffect(() => {
    if (!ready || restored) return;
    let disposed = false;
    void api
      .documents('layout')
      .then((saved) => {
        if (disposed) return;
        const last = saved.find(
          (d) => d.value.scope === 'workspace' || Array.isArray(d.value.tabs),
        );
        layoutRef.current = last;
        const references = (value: unknown) =>
          Array.isArray(value)
            ? value
                .filter(
                  (v) =>
                    v &&
                    typeof v.targetId === 'string' &&
                    typeof v.object?.id === 'string' &&
                    typeof v.object?.name === 'string',
                )
                .slice(0, 30)
            : [];
        setRecentObjects(references(last?.value.recentObjects));
        setFavoriteObjects(references(last?.value.favoriteObjects));
        const preferences = last?.value.preferences as
          | {
              plainEditor?: boolean;
              wrapping?: boolean;
              fontSize?: number;
              explorerVisible?: boolean;
            }
          | undefined;
        if (preferences) {
          setPlainEditor(preferences.plainEditor === true);
          setWrapping(preferences.wrapping !== false);
          setFontSize(
            [12, 14, 16, 18, 20].includes(preferences.fontSize || 0)
              ? preferences.fontSize!
              : 14,
          );
          setExplorerVisible(preferences.explorerVisible !== false);
        }
        const previous = last?.value.tabs;
        if (
          Array.isArray(previous) &&
          previous.length &&
          previous.length <= 20
        ) {
          const valid = previous
            .filter(
              (t) =>
                t &&
                typeof t.sql === 'string' &&
                typeof t.id === 'string' &&
                capabilities.data?.targets.some(
                  (target) => target.id === t.targetId,
                ),
            )
            .map((t) => ({
              ...t,
              mode: 'read',
              objectId: typeof t.objectId === 'string' ? t.objectId : undefined,
            }));
          if (valid.length) {
            setTabs(valid as QueryTab[]);
            setActive(
              typeof last?.value.active === 'string'
                ? last.value.active
                : valid[0].id,
            );
          }
        }
        setRestored(true);
      })
      .catch(() => {
        if (!disposed) setRestored(true);
      });
    return () => {
      disposed = true;
    };
  }, [ready, restored, capabilities.data?.targets]);
  useEffect(() => {
    if (!ready || !restored) return;
    if (tabs.length >= 20 && hasWorkspaceQuery()) {
      setError('Close a query tab to open the pending performance query.');
      return;
    }
    const sql = consumeWorkspaceQuery();
    if (!sql) return;
    const tab = newTab(
      capabilities.data?.targets[0]?.id || '',
      sql,
      'Performance query',
    );
    setTabs((previous) => [...previous, tab]);
    setActive(tab.id);
    setSection('query');
  }, [ready, restored, capabilities.data?.targets, tabs.length]);
  useEffect(() => {
    if (!ready || !restored) return;
    const snapshot = JSON.stringify({
      scope: 'workspace',
      tabs,
      active,
      recentObjects,
      favoriteObjects,
      preferences: { plainEditor, wrapping, fontSize, explorerVisible },
    });
    draftSnapshot.current = snapshot;
    if (snapshot !== savedSnapshot.current) setDraftStatus('Unsaved changes');
    const timer = window.setTimeout(() => {
      draftQueue.current = draftQueue.current
        .catch(() => {})
        .then(async () => {
          if (
            snapshot !== draftSnapshot.current ||
            snapshot === savedSnapshot.current
          )
            return;
          setDraftStatus('Saving draft?');
          const previous = layoutRef.current;
          try {
            const saved = await api.saveDocument({
              id: previous?.id,
              revision: previous?.revision,
              kind: 'layout',
              value: JSON.parse(snapshot),
            });
            layoutRef.current = saved;
            savedSnapshot.current = snapshot;
            if (snapshot === draftSnapshot.current)
              setDraftStatus('Draft saved privately');
          } catch (e) {
            setDraftStatus(`Draft not saved: ${message(e)}`);
          }
        });
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [
    tabs,
    active,
    ready,
    restored,
    recentObjects,
    favoriteObjects,
    plainEditor,
    wrapping,
    fontSize,
    explorerVisible,
  ]);
  const pendingIdsKey = tabs
    .map((t) => t.jobId)
    .filter(
      (id): id is string => Boolean(id) && (!jobs[id!] || activeJob(jobs[id!])),
    )
    .join('|');
  useEffect(() => {
    const pendingIds = pendingIdsKey.split('|').filter(Boolean);
    if (!pendingIds.length) return;
    let stopped = false;
    const poll = () => {
      void Promise.all(
        pendingIds.map((id) =>
          api
            .job(id)
            .then((j) => {
              if (!stopped) setJobs((p) => ({ ...p, [id]: j }));
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
  }, [pendingIdsKey]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (
        tabs.some((t) => t.dirty) &&
        draftStatus !== 'Draft saved privately'
      ) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [tabs, draftStatus]);
  const schema = useMemo(
    () =>
      Object.fromEntries(
        (catalog.data || []).map((o) => [
          o.name,
          details.data?.id === o.id
            ? details.data.columns.map((c) => c.name)
            : [],
        ]),
      ),
    [catalog.data, details.data],
  );
  function addTab(sql?: string, title?: string, targetId = current.targetId) {
    if (tabs.length >= 20) {
      setError(
        'Close a query tab before opening another. The workspace supports 20 open tabs.',
      );
      return;
    }
    const tab = newTab(targetId, sql, title);
    setTabs((p) => [...p, tab]);
    setActive(tab.id);
    setSection('query');
    setError('');
  }
  function openObject(object: CatalogObject) {
    setSelectedObject(object);
    setRecentObjects((previous) =>
      [
        { targetId: current.targetId, object },
        ...previous.filter(
          (r) => r.targetId !== current.targetId || r.object.id !== object.id,
        ),
      ].slice(0, 20),
    );
    if (mobile) setSection('objects');
  }
  const shortcut = useRef<() => void>(() => {}),
    shortcutAll = useRef<() => void>(() => {}),
    shortcutSave = useRef<() => void>(() => {});
  shortcut.current = () => void run();
  shortcutAll.current = () => void run(true);
  shortcutSave.current = () => {
    setSaveTitle(current.title === 'Untitled query' ? '' : current.title);
    setSaveOpen(true);
  };
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        !(event.ctrlKey || event.metaKey) ||
        !(event.target instanceof Element) ||
        !event.target.closest('.dw')
      )
        return;
      if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        shortcutSave.current();
      } else if (event.key === 'Enter' && event.shiftKey) {
        event.preventDefault();
        shortcutAll.current();
      } else if (
        event.key === 'Enter' &&
        event.target instanceof HTMLTextAreaElement &&
        event.target.getAttribute('aria-label') === 'SQL editor (plain text)'
      ) {
        event.preventDefault();
        shortcut.current();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  function browseObject() {
    if (!details.data) return;
    if (tabs.length >= 20) {
      setError('Close a query tab before opening another.');
      return;
    }
    const tab = {
      ...newTab(
        current.targetId,
        `SELECT *\nFROM ${details.data.qualifiedName}\nLIMIT 1000;`,
        details.data.name,
      ),
      objectId: details.data.id,
    };
    setTabs((p) => [...p, tab]);
    setActive(tab.id);
    setSection('query');
  }
  async function execute(input: Input, tabId: string) {
    setRunning(true);
    setError('');
    try {
      const next = await api.execute({
        ...input,
        idempotencyKey: input.idempotencyKey || crypto.randomUUID(),
      });
      setJobs((p) => ({ ...p, [next.id]: next }));
      patch({ jobId: next.id }, tabId);
      setSection(mobile ? 'results' : 'query');
      setResultTab('data');
      setResultIndex(0);
      setPending(undefined);
      setReview(undefined);
    } catch (e) {
      setError(message(e));
    } finally {
      setRunning(false);
    }
  }
  async function run(all = false, override?: string) {
    if (!canRun) return;
    setError('');
    setNotice('');
    try {
      const parsed = JSON.parse(parameters);
      if (
        !Array.isArray(parsed) ||
        parsed.some((v) => v !== null && typeof v !== 'string')
      )
        throw new Error(
          'Parameters must be a JSON array of strings or null, for example ["42", null].',
        );
      const missing =
        current.parameterDefinitions?.findIndex(
          (p, i) =>
            p.required &&
            (parsed[i] === undefined || parsed[i] === null || parsed[i] === ''),
        ) ?? -1;
      if (missing >= 0)
        throw new Error(
          `Enter a value for ${current.parameterDefinitions![missing].name} ($${missing + 1}).`,
        );
      const scoped = override
        ? { sql: override }
        : all
          ? { sql: current.sql }
          : editor.current?.scope() || { sql: current.sql };
      if (!scoped?.sql.trim()) return;
      const input: Input = {
        idempotencyKey: crypto.randomUUID(),
        targetId: current.targetId,
        sql: scoped.sql,
        parameters: parsed,
        mode: current.mode,
        reason: '',
      };
      setRunning(true);
      const validated = await api.validate(input);
      setRunning(false);
      if (
        current.mode === 'write' ||
        validated.statements?.some(
          (s: { requiresReview?: boolean }) => s.requiresReview,
        )
      ) {
        setReason('');
        setReview(undefined);
        setPending({ input, tabId: current.id });
      } else await execute(input, current.id);
    } catch (e) {
      setError(message(e));
      setRunning(false);
    }
  }
  async function prepareReview() {
    if (!pending) return;
    setRunning(true);
    setError('');
    try {
      const input = { ...pending.input, reason };
      const reviewed = await api.review(input);
      setPending({ ...pending, input });
      setReview(reviewed);
    } catch (e) {
      setError(message(e));
    } finally {
      setRunning(false);
    }
  }
  async function saveQuery() {
    setRunning(true);
    try {
      const saved = await api.saveDocument({
        id: current.documentId,
        revision: current.documentRevision,
        kind: 'query',
        value: {
          ...documents.data?.find((d) => d.id === current.documentId)?.value,
          title: saveTitle,
          folder: saveFolder,
          sql: current.sql,
          targetId: current.targetId,
          plan: undefined,
          parameterDefinitions: current.parameterDefinitions || [],
        },
      });
      patch({
        title: saveTitle,
        documentId: saved.id,
        documentRevision: saved.revision,
        dirty: false,
      });
      setSaveOpen(false);
      setNotice('Query saved privately.');
      void documents.refetch();
    } catch (e) {
      setError(message(e));
    } finally {
      setRunning(false);
    }
  }
  function openSaved(doc: Document) {
    if (tabs.length >= 20) {
      setError('Close a query tab before opening another.');
      return;
    }
    const tab = {
      ...newTab(
        String(doc.value.targetId || current.targetId),
        String(doc.value.sql || ''),
        String(doc.value.title || 'Saved query'),
      ),
      documentId: doc.id || undefined,
      documentRevision: doc.id ? doc.revision : undefined,
      parameterDefinitions: doc.value.parameterDefinitions || [],
      parameters: JSON.stringify(
        (doc.value.parameterDefinitions || []).map((p) =>
          p.sensitive ? '' : p.defaultValue === undefined ? '' : p.defaultValue,
        ),
      ),
    };
    setTabs((p) => [...p, tab]);
    setActive(tab.id);
    setSection('query');
  }
  async function openFile(input: File) {
    try {
      if (
        input.size > Number(capabilities.data?.limits.queryMaxBytes || 102400)
      )
        throw new Error('This SQL file exceeds the script size limit.');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(
        await input.arrayBuffer(),
      );
      addTab(text, input.name);
      setNotice('SQL file opened. It has not been executed.');
    } catch (e) {
      setError(message(e));
    }
  }
  const nav = [
    ['query', 'Query', IconTerminal2],
    ['objects', 'Objects', IconDatabase],
    ['activity', 'Activity', IconActivity],
    ['saved', 'Saved queries', IconFolder],
    ['history', 'History', IconHistory],
    ['sessions', 'Transactions', IconLock],
    ['admin', 'Administration', IconSettings],
  ] as const;
  return (
    <div
      className="dw"
      data-keyboard={keyboardOpen}
      style={{ '--dw-viewport': `${viewportHeight}px` } as React.CSSProperties}
    >
      <header className="dw-header">
        <div className="dw-brand">
          <Tooltip label="Back to settings">
            <ActionIcon
              component={Link}
              to="/settings"
              variant="subtle"
              color="gray"
              aria-label="Back to settings"
            >
              <IconArrowLeft size={16} />
            </ActionIcon>
          </Tooltip>
          <span className="dw-brand-icon">
            <IconDatabase size={20} />
          </span>
          <div>
            <h1>Database Workspace</h1>
            <p>PostgreSQL development & administration</p>
          </div>
        </div>
        <Select
          aria-label="Catalog object category"
          size="xs"
          w={125}
          value={category}
          onChange={(v) => {
            setCategory(v || 'relations');
            setCatalogPage(0);
            setSelectedObject(undefined);
          }}
          data={[
            { value: 'relations', label: 'Tables & views' },
            { value: 'schemas', label: 'Schemas' },
            { value: 'routines', label: 'Functions' },
            { value: 'types', label: 'Types' },
            { value: 'extensions', label: 'Extensions' },
            { value: 'infrastructure', label: 'Infrastructure' },
          ]}
          allowDeselect={false}
        />
        <div className="dw-target">
          <Badge
            variant="light"
            color={target?.environment === 'production' ? 'red' : 'gray'}
            size="sm"
          >
            {target?.environment || 'No connection'}
          </Badge>
          <Select
            aria-label="Database connection"
            size="xs"
            value={current.targetId}
            data={(capabilities.data?.targets || []).map((t) => ({
              value: t.id,
              label: `${t.label} · ${t.database}`,
            }))}
            onChange={(id) => {
              patch({
                targetId: id || '',
                mode: 'read',
                jobId: undefined,
                objectId: undefined,
              });
              setSelectedObject(undefined);
              setCatalogPage(0);
            }}
            allowDeselect={false}
          />
        </div>
        <Badge
          leftSection={<IconLock size={11} />}
          variant="light"
          color={current.mode === 'write' ? 'orange' : 'teal'}
        >
          {current.mode === 'write' ? 'Reviewed write' : 'Read only'}
        </Badge>
      </header>
      <Group
        px="sm"
        py={4}
        gap={6}
        style={{ borderBottom: '1px solid var(--dw-border)' }}
      >
        <Menu>
          <Menu.Target>
            <Button size="compact-xs" variant="subtle">
              Recent objects
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            {recentObjects
              .filter((r) => r.targetId === current.targetId)
              .map((r) => (
                <Menu.Item
                  key={r.object.id}
                  onClick={() => openObject(r.object)}
                >
                  {r.object.schema}.{r.object.name}
                </Menu.Item>
              ))}
            {!recentObjects.some((r) => r.targetId === current.targetId) && (
              <Menu.Item disabled>No recent objects</Menu.Item>
            )}
          </Menu.Dropdown>
        </Menu>
        <Menu>
          <Menu.Target>
            <Button size="compact-xs" variant="subtle">
              Favorite objects
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            {favoriteObjects
              .filter((r) => r.targetId === current.targetId)
              .map((r) => (
                <Menu.Item
                  key={r.object.id}
                  onClick={() => openObject(r.object)}
                >
                  {r.object.schema}.{r.object.name}
                </Menu.Item>
              ))}
            {!favoriteObjects.some((r) => r.targetId === current.targetId) && (
              <Menu.Item disabled>No favorites</Menu.Item>
            )}
          </Menu.Dropdown>
        </Menu>
        {selectedObject && (
          <Button
            size="compact-xs"
            variant="subtle"
            onClick={() =>
              setFavoriteObjects((previous) =>
                previous.some(
                  (r) =>
                    r.targetId === current.targetId &&
                    r.object.id === selectedObject.id,
                )
                  ? previous.filter(
                      (r) =>
                        r.targetId !== current.targetId ||
                        r.object.id !== selectedObject.id,
                    )
                  : [
                      ...previous,
                      { targetId: current.targetId, object: selectedObject },
                    ].slice(-30),
              )
            }
          >
            {favoriteObjects.some(
              (r) =>
                r.targetId === current.targetId &&
                r.object.id === selectedObject.id,
            )
              ? 'Remove favorite'
              : 'Favorite selected object'}
          </Button>
        )}
        <Text size="xs" c="dimmed" ml="auto">
          Ctrl/Cmd+S: save · Ctrl/Cmd+Shift+Enter: run script
        </Text>
      </Group>
      <nav
        className="dw-navigation"
        aria-label="Database workspace views"
        role="tablist"
      >
        {(mobile
          ? ([
              ['objects', 'Objects', IconDatabase],
              ['query', 'Query', IconTerminal2],
              ['results', 'Results', IconTable],
              ['activity', 'Activity', IconActivity],
            ] as const)
          : nav
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            className="dw-nav"
            role="tab"
            aria-selected={section === key}
            onClick={() => setSection(key)}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
        {mobile && (
          <Menu>
            <Menu.Target>
              <ActionIcon
                aria-label="More workspace views"
                variant="subtle"
                color="gray"
                ml="auto"
              >
                <IconChevronDown size={15} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              {nav
                .filter(([key]) =>
                  ['saved', 'history', 'sessions', 'admin'].includes(key),
                )
                .map(([key, label]) => (
                  <Menu.Item key={key} onClick={() => setSection(key)}>
                    {label}
                  </Menu.Item>
                ))}
            </Menu.Dropdown>
          </Menu>
        )}
      </nav>
      {error && (
        <Alert
          color="red"
          title="Operation could not complete"
          withCloseButton
          onClose={() => setError('')}
          radius={0}
        >
          {error}
        </Alert>
      )}
      {capabilities.data?.controlStorage?.warning && (
        <Alert color="orange" radius={0} title="Control storage budget">
          {(capabilities.data.controlStorage.bytes / 1048576).toFixed(1)} MiB
          used of{' '}
          {(capabilities.data.controlStorage.budgetBytes / 1048576).toFixed(1)}{' '}
          MiB. New operations stop at 80% so cancellation and outcomes retain
          space. Review retention or increase its Control Panel budget.
        </Alert>
      )}
      {notice && (
        <Alert
          color="teal"
          withCloseButton
          onClose={() => setNotice('')}
          radius={0}
        >
          {notice}
        </Alert>
      )}
      {capabilities.isLoading ? (
        <div className="dw-empty">
          <Loader size="sm" />
          <Text size="sm">Checking workspace permissions…</Text>
        </div>
      ) : capabilities.error ? (
        <div className="dw-empty">
          <IconLock />
          <h2>Workspace unavailable</h2>
          <p>{message(capabilities.error)}</p>
          <Button variant="light" onClick={() => void capabilities.refetch()}>
            Retry
          </Button>
        </div>
      ) : !ready ? (
        <Setup capabilities={capabilities.data!} />
      ) : (
        <div className="dw-body">
          {section === 'query' && explorerVisible && !mobile && (
            <Explorer
              objects={catalog.data || []}
              loading={catalog.isLoading}
              search={search}
              onSearch={(s) => {
                setSearch(s);
                setCatalogPage(0);
              }}
              page={catalogPage}
              onPage={setCatalogPage}
              onOpen={openObject}
              onInspect={openObject}
            />
          )}
          {(section === 'query' || section === 'results') && (
            <main className="dw-main" data-mobile-view={section}>
              <div
                className="dw-query-tabs"
                role="tablist"
                aria-label="Open SQL queries"
              >
                {tabs.map((tab) => (
                  <div
                    key={tab.id}
                    className="dw-query-tab"
                    role="tab"
                    tabIndex={0}
                    aria-selected={current.id === tab.id}
                    onClick={() => setActive(tab.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') setActive(tab.id);
                    }}
                  >
                    <IconFileCode size={14} />
                    <span>
                      {tab.title}
                      {tab.dirty ? ' •' : ''}
                    </span>
                    {current.id === tab.id && (
                      <Menu>
                        <Menu.Target>
                          <ActionIcon
                            size="xs"
                            variant="subtle"
                            aria-label={`Actions for ${tab.title}`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <IconChevronDown size={12} />
                          </ActionIcon>
                        </Menu.Target>
                        <Menu.Dropdown>
                          <Menu.Item
                            onClick={() => {
                              setTabTitle(tab.title);
                              setRenaming(true);
                            }}
                          >
                            Rename tab
                          </Menu.Item>
                          <Menu.Item
                            onClick={() =>
                              addTab(tab.sql, `${tab.title} copy`, tab.targetId)
                            }
                          >
                            Duplicate query
                          </Menu.Item>
                          <Menu.Item
                            disabled={tabs.length < 2}
                            onClick={() => setCloseOthers(true)}
                          >
                            Close other tabs
                          </Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
                    )}
                    {tabs.length > 1 && (
                      <button
                        className="dw-tab-close"
                        aria-label={`Close ${tab.title}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (tab.dirty) setCloseTab(tab.id);
                          else {
                            setTabs((p) => p.filter((t) => t.id !== tab.id));
                            if (active === tab.id) setActive('');
                          }
                        }}
                      >
                        <IconX size={12} />
                      </button>
                    )}
                  </div>
                ))}
                <ActionIcon
                  variant="subtle"
                  aria-label="New SQL query"
                  m={5}
                  onClick={() => addTab()}
                >
                  <IconPlus size={15} />
                </ActionIcon>
              </div>
              {current.objectId ? (
                <TableBrowser
                  key={`${current.targetId}:${current.objectId}`}
                  targetId={current.targetId}
                  objectId={current.objectId}
                  capabilities={capabilities.data!}
                  onSql={(sql, values) => {
                    patch({ objectId: undefined, sql, dirty: true });
                    setParameters(JSON.stringify(values));
                  }}
                />
              ) : (
                <>
                  <div className="dw-toolbar">
                    <Tooltip label="Toggle object explorer">
                      <ActionIcon
                        className="dw-hide-mobile"
                        variant="subtle"
                        color="gray"
                        aria-label="Toggle object explorer"
                        onClick={() => setExplorerVisible((v) => !v)}
                      >
                        <IconLayoutSidebarLeftCollapse size={17} />
                      </ActionIcon>
                    </Tooltip>
                    {activeJob(job) ? (
                      <Button
                        size="xs"
                        color="red"
                        variant="light"
                        leftSection={<IconPlayerStop size={14} />}
                        disabled={job?.status === 'cancel_requested'}
                        onClick={() =>
                          job &&
                          void api
                            .cancel(job.id)
                            .then((j) => setJobs((p) => ({ ...p, [j.id]: j })))
                            .catch((e) => setError(message(e)))
                        }
                      >
                        {job?.status === 'cancel_requested'
                          ? 'Cancel requested'
                          : 'Cancel query'}
                      </Button>
                    ) : (
                      <Group gap={1}>
                        <Button
                          size="xs"
                          leftSection={<IconPlayerPlay size={14} />}
                          disabled={!canRun}
                          loading={running}
                          onClick={() => run()}
                        >
                          Run current
                        </Button>
                        <Menu>
                          <Menu.Target>
                            <Button
                              size="xs"
                              px={7}
                              aria-label="More run options"
                              disabled={!canRun}
                            >
                              <IconChevronDown size={13} />
                            </Button>
                          </Menu.Target>
                          <Menu.Dropdown>
                            <Menu.Item onClick={() => run(true)}>
                              Run entire script
                            </Menu.Item>
                            <Menu.Item
                              onClick={() =>
                                run(
                                  false,
                                  `EXPLAIN (FORMAT JSON) ${editor.current?.scope().sql.replace(/;\s*$/, '')}`,
                                )
                              }
                            >
                              Explain current statement
                            </Menu.Item>
                            <Menu.Item
                              onClick={() =>
                                run(
                                  false,
                                  `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${editor.current?.scope().sql.replace(/;\s*$/, '')}`,
                                )
                              }
                            >
                              Explain with execution (review required)
                            </Menu.Item>
                          </Menu.Dropdown>
                        </Menu>
                      </Group>
                    )}
                    <Button
                      size="xs"
                      variant="subtle"
                      color="gray"
                      leftSection={<IconCode size={14} />}
                      onClick={() => {
                        try {
                          patch({
                            sql: format(current.sql, {
                              language: 'postgresql',
                            }),
                            dirty: true,
                          });
                        } catch (e) {
                          setError(message(e));
                        }
                      }}
                    >
                      Format
                    </Button>
                    <Button
                      size="xs"
                      variant="subtle"
                      color="gray"
                      leftSection={<IconDeviceFloppy size={14} />}
                      onClick={() => {
                        setSaveTitle(
                          current.title === 'Untitled query'
                            ? ''
                            : current.title,
                        );
                        setSaveFolder(
                          String(
                            documents.data?.find(
                              (d) => d.id === current.documentId,
                            )?.value.folder || '',
                          ),
                        );
                        setSaveOpen(true);
                      }}
                    >
                      Save
                    </Button>
                    <Menu>
                      <Menu.Target>
                        <ActionIcon
                          variant="subtle"
                          color="gray"
                          aria-label="SQL file actions"
                        >
                          <IconFolder size={16} />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item onClick={() => file.current?.click()}>
                          Open SQL file
                        </Menu.Item>
                        <Menu.Divider />
                        <Menu.Item onClick={() => setPlainEditor((v) => !v)}>
                          {plainEditor
                            ? 'Use CodeMirror editor'
                            : 'Use plain text editor'}
                        </Menu.Item>
                        <Menu.Item onClick={() => setWrapping((v) => !v)}>
                          {wrapping ? 'Disable' : 'Enable'} line wrapping
                        </Menu.Item>
                        <Menu.Item
                          onClick={() =>
                            setFontSize((v) => (v >= 20 ? 12 : v + 2))
                          }
                        >
                          Editor text size: {fontSize}px
                        </Menu.Item>
                        <Menu.Item
                          onClick={() =>
                            addTab(
                              'SELECT * FROM public.table_name\nLIMIT 100;',
                              'Table sample',
                            )
                          }
                        >
                          New table sample snippet
                        </Menu.Item>
                        <Menu.Item
                          onClick={() =>
                            addTab(
                              'SELECT pid, application_name, state, wait_event_type, wait_event\nFROM pg_stat_activity\nWHERE datname = current_database();',
                              'Session diagnostic',
                            )
                          }
                        >
                          New session diagnostic snippet
                        </Menu.Item>
                        <Menu.Item
                          onClick={() =>
                            downloadBookingBlob(
                              new Blob([current.sql], {
                                type: 'text/plain;charset=utf-8',
                              }),
                              `${current.title}.sql`,
                            )
                          }
                        >
                          Download SQL script
                        </Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                    <input
                      ref={file}
                      type="file"
                      accept=".sql,.txt"
                      hidden
                      onChange={(e) => {
                        if (e.target.files?.[0])
                          void openFile(e.target.files[0]);
                        e.target.value = '';
                      }}
                    />
                    <Button
                      size="compact-xs"
                      variant={parametersOpen ? 'light' : 'subtle'}
                      color="gray"
                      leftSection={<IconBraces size={14} />}
                      onClick={() => setParametersOpen((v) => !v)}
                    >
                      Parameters
                    </Button>
                    <div style={{ marginLeft: 'auto' }}>
                      <Select
                        aria-label="SQL execution mode"
                        size="xs"
                        w={120}
                        value={current.mode}
                        onChange={(m) =>
                          patch({ mode: m === 'write' ? 'write' : 'read' })
                        }
                        disabled={activeJob(job)}
                        allowDeselect={false}
                        data={[
                          { value: 'read', label: 'Read only' },
                          {
                            value: 'write',
                            label: 'Write',
                            disabled:
                              !capabilities.data?.writesEnabled ||
                              !capabilities.data?.actions.write ||
                              target?.readOnly,
                          },
                        ]}
                      />
                    </div>
                  </div>
                  {parametersOpen && (
                    <div className="dw-parameters">
                      <ParameterForm
                        value={parameters}
                        onChange={setParameters}
                        definitions={current.parameterDefinitions}
                        onDefinitionsChange={(v) =>
                          patch({ parameterDefinitions: v, dirty: true })
                        }
                      />
                    </div>
                  )}
                  <section
                    className="dw-editor-section"
                    aria-label="Query editor"
                  >
                    {plainEditor ? (
                      <Textarea
                        aria-label="SQL editor (plain text)"
                        value={current.sql}
                        onChange={(e) =>
                          patch({ sql: e.currentTarget.value, dirty: true })
                        }
                        styles={{
                          root: { flex: 1 },
                          wrapper: { height: '100%' },
                          input: {
                            height: '100%',
                            minHeight: 220,
                            fontFamily: 'ui-monospace,monospace',
                            fontSize,
                          },
                        }}
                      />
                    ) : (
                      <SqlEditor
                        key={current.id}
                        ref={editor}
                        value={current.sql}
                        onChange={(sql) => patch({ sql, dirty: true })}
                        onRun={() => run()}
                        schema={schema}
                        wrapping={wrapping}
                        fontSize={fontSize}
                      />
                    )}
                    <div className="dw-editor-help" id="dw-editor-help">
                      <span>
                        Ctrl/Cmd+Enter: run selection or current statement ·
                        Escape, then Tab: leave editor
                      </span>
                      <span className="dw-hide-mobile">
                        PostgreSQL {target?.major} · UTF-8
                      </span>
                    </div>
                  </section>
                  <div className="dw-mobile-result-actions">
                    <Button
                      size="xs"
                      variant="subtle"
                      onClick={() => setSection('query')}
                    >
                      Edit query
                    </Button>
                    {activeJob(job) && (
                      <Button
                        size="xs"
                        variant="light"
                        color="red"
                        onClick={() =>
                          job &&
                          void api
                            .cancel(job.id)
                            .then((j) => setJobs((p) => ({ ...p, [j.id]: j })))
                        }
                      >
                        Cancel query
                      </Button>
                    )}
                  </div>
                  <section className="dw-results" aria-label="Query output">
                    <div
                      className="dw-results-head"
                      role="tablist"
                      aria-label="Output views"
                    >
                      {['data', 'messages', 'execution'].map((t) => (
                        <button
                          className="dw-nav"
                          key={t}
                          role="tab"
                          aria-selected={resultTab === t}
                          onClick={() => setResultTab(t)}
                        >
                          {t[0].toUpperCase() + t.slice(1)}
                        </button>
                      ))}
                      {(job?.outcomes.filter((o) => o.result).length || 0) >
                        1 &&
                        job && (
                          <Select
                            aria-label="Statement result"
                            size="xs"
                            w={135}
                            value={String(resultIndex)}
                            onChange={(v) => setResultIndex(Number(v))}
                            data={job.outcomes
                              .filter((o) => o.result)
                              .map((o) => ({
                                value: String(o.index),
                                label: `Statement ${o.index + 1}`,
                              }))}
                          />
                        )}
                      <div
                        className="dw-result-status"
                        style={{ marginLeft: 'auto' }}
                      >
                        {job && (
                          <Badge
                            size="sm"
                            variant="light"
                            color={statusColor(job.status)}
                          >
                            {statusLabel(job)}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="dw-result-content">
                      {!job ? (
                        <div className="dw-empty">
                          <IconTerminal2 size={30} stroke={1.3} />
                          <h2>Your results will appear here</h2>
                          <p>
                            Explore a table or write a query. Run a selection,
                            the statement at your cursor, or the entire script.
                          </p>
                        </div>
                      ) : activeJob(job) ? (
                        <div className="dw-empty">
                          <Loader size="sm" />
                          <h2>{statusLabel(job)}</h2>
                          <p>
                            The job runs on the server. Its status remains
                            available if you switch tabs or reconnect.
                          </p>
                        </div>
                      ) : resultTab === 'data' &&
                        job.outcomes[resultIndex]?.result ? (
                        job.outcomes[resultIndex]?.kind === 'ExplainStmt' ? (
                          <PlanViewer
                            key={`${job.id}:${resultIndex}`}
                            job={job}
                            index={resultIndex}
                          />
                        ) : (
                          <ResultGrid
                            key={`${job.id}:${resultIndex}`}
                            job={job}
                            index={resultIndex}
                            canExport={Boolean(
                              capabilities.data?.actions.export,
                            )}
                          />
                        )
                      ) : (
                        <div style={{ padding: 15 }}>
                          {job.error && (
                            <Alert
                              color={
                                job.status === 'outcome_unknown'
                                  ? 'orange'
                                  : 'red'
                              }
                              title={job.error.code}
                            >
                              {job.error.message}
                              {job.error.sqlState && (
                                <Text size="xs">
                                  SQLSTATE {job.error.sqlState}
                                </Text>
                              )}
                            </Alert>
                          )}
                          <Text size="sm" fw={600} mb="sm">
                            {statusLabel(job)}
                          </Text>
                          {job.outcomes.map((o) => (
                            <div className="dw-card" key={o.index}>
                              <Group justify="space-between">
                                <Text size="xs">
                                  Statement {o.index + 1} ·{' '}
                                  {o.command || o.kind}
                                </Text>
                                <Text size="xs" c="dimmed">
                                  {o.durationMs} ms
                                </Text>
                              </Group>
                              {o.affectedRows !== undefined && (
                                <Text size="xs">
                                  Affected rows: {o.affectedRows}
                                </Text>
                              )}
                              <Code block mt="xs">
                                {o.sql}
                              </Code>
                              {o.error && (
                                <Text size="xs" c="red" mt="xs">
                                  {o.error.message}
                                </Text>
                              )}
                              {o.error?.position && (
                                <Button
                                  size="compact-xs"
                                  variant="subtle"
                                  onClick={() => {
                                    const offset =
                                      o.sourceStart +
                                      Array.from(o.sql)
                                        .slice(
                                          0,
                                          Math.max(0, o.error!.position! - 1),
                                        )
                                        .join('').length;
                                    if (current.sql.includes(o.sql))
                                      editor.current?.jump(
                                        current.sql.indexOf(o.sql) +
                                          offset -
                                          o.sourceStart,
                                      );
                                    else {
                                      addTab(
                                        o.sql,
                                        'Failed statement',
                                        job.targetId,
                                      );
                                      setTimeout(
                                        () =>
                                          editor.current?.jump(
                                            offset - o.sourceStart,
                                          ),
                                        100,
                                      );
                                    }
                                    setSection('query');
                                  }}
                                >
                                  Jump to error at character {o.error.position}
                                </Button>
                              )}
                              {o.messages?.map((m, i) => (
                                <Alert
                                  key={i}
                                  color={
                                    m.severity === 'WARNING' ? 'orange' : 'blue'
                                  }
                                  mt="xs"
                                  title={m.severity}
                                >
                                  {m.message}
                                </Alert>
                              ))}
                            </div>
                          ))}
                          {resultTab === 'execution' && (
                            <Text size="xs" c="dimmed" mt="md">
                              Execution {job.id} · transaction{' '}
                              {job.transactionOutcome} ·{' '}
                              {new Date(job.createdAt).toLocaleString()}
                            </Text>
                          )}
                        </div>
                      )}
                    </div>
                  </section>
                </>
              )}
            </main>
          )}
          {section === 'query' && details.data && (
            <aside className="dw-inspector">
              <ObjectInspector
                object={details.data}
                onBrowse={browseObject}
                onClose={() => setSelectedObject(undefined)}
              />
            </aside>
          )}
          {section === 'objects' && (
            <>
              <Explorer
                mobile
                objects={catalog.data || []}
                loading={catalog.isLoading}
                search={search}
                onSearch={(s) => {
                  setSearch(s);
                  setCatalogPage(0);
                }}
                page={catalogPage}
                onPage={setCatalogPage}
                onOpen={openObject}
                onInspect={openObject}
              />
              <div className="dw-pane">
                {details.data ? (
                  <ObjectInspector
                    object={details.data}
                    onBrowse={browseObject}
                  />
                ) : (
                  <div className="dw-empty">
                    <IconDatabase size={28} />
                    <h2>Inspect your database</h2>
                    <p>
                      Select an object to inspect its columns, constraints and
                      indexes.
                    </p>
                    {!mobile && (
                      <Stack w="100%" mt="md">
                        {catalog.data?.map((o) => (
                          <button
                            className="dw-object"
                            key={o.id}
                            onClick={() => openObject(o)}
                          >
                            <IconTable size={14} />
                            {o.schema}.{o.name}
                          </button>
                        ))}
                      </Stack>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
          {section === 'saved' && (
            <QueryLibrary
              onOpen={openSaved}
              onNew={() => addTab()}
              canShare={Boolean(capabilities.data?.actions.export)}
            />
          )}
          {section === 'history' && (
            <div className="dw-pane">
              <Group justify="space-between" mb="lg">
                <div>
                  <Text fw={700}>Execution history</Text>
                  <Text size="xs" c="dimmed">
                    Your server-recorded operations and their observed
                    transaction outcomes.
                  </Text>
                </div>
                <ActionIcon
                  aria-label="Refresh execution history"
                  variant="light"
                  onClick={() => void history.refetch()}
                >
                  <IconRefresh size={16} />
                </ActionIcon>
              </Group>
              {history.data?.map((j) => (
                <div className="dw-card" key={j.id}>
                  <Group justify="space-between">
                    <div>
                      <Text size="sm" fw={600}>
                        {j.summary}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {new Date(j.createdAt).toLocaleString()} · {j.targetId}
                      </Text>
                    </div>
                    <Badge color={statusColor(j.status)} variant="light">
                      {statusLabel(j)}
                    </Badge>
                  </Group>
                  <Text size="xs" c="dimmed" mt="xs">
                    Transaction: {j.transactionOutcome}
                  </Text>
                  {j.error && (
                    <Text c="red" size="xs">
                      {j.error.message}
                    </Text>
                  )}
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    mt="sm"
                    onClick={() => {
                      if (tabs.length >= 20) {
                        setError('Close a query tab before opening another.');
                        return;
                      }
                      const tab = newTab(
                        j.targetId,
                        j.outcomes.map((o) => o.sql).join(';\n') ||
                          '-- SQL is unavailable until this job finishes.',
                        'Historical execution',
                      );
                      tab.jobId = j.id;
                      setTabs((p) => [...p, tab]);
                      setJobs((p) => ({ ...p, [j.id]: j }));
                      setActive(tab.id);
                      setSection('query');
                    }}
                  >
                    Inspect execution
                  </Button>
                </div>
              ))}
            </div>
          )}
          {section === 'sessions' && (
            <SessionPanel
              targetId={current.targetId}
              capabilities={capabilities.data!}
            />
          )}
          {section === 'activity' && (
            <ActivityPanel targetId={current.targetId} />
          )}
          {section === 'admin' && (
            <AdministrationPanel
              targetId={current.targetId}
              capabilities={capabilities.data!}
            />
          )}
        </div>
      )}
      <footer className="dw-status" role="status" aria-live="polite">
        <span>
          <span
            className="dw-dot"
            style={{ background: ready ? '#20a774' : '#b8c0ca' }}
          />
          {ready
            ? capabilities.data?.workerReady
              ? 'Workspace ready'
              : 'Worker offline · execution unavailable'
            : 'Connection setup required'}
        </span>
        <span>{target?.database || 'No database selected'}</span>
        {target?.roles?.[current.mode] && (
          <span>Role: {target.roles[current.mode]}</span>
        )}
        <span>{statusLabel(job)}</span>
        {job && <span>Transaction: {job.transactionOutcome}</span>}
        <span style={{ marginLeft: 'auto' }}>
          {draftStatus || 'Private workspace'}
        </span>
      </footer>
      <Modal
        opened={Boolean(sharedId)}
        onClose={() => {
          const next = new URLSearchParams(urlParams);
          next.delete('share');
          setUrlParams(next, { replace: true });
        }}
        title={shared.data?.title || 'Shared database workspace item'}
        size="90%"
      >
        <Stack>
          {shared.error && <Alert color="red">{message(shared.error)}</Alert>}
          {shared.isLoading && <Loader size="sm" />}
          {shared.data?.kind === 'query' && (
            <>
              <Code block>{String(shared.data.query?.sql || '')}</Code>
              <Button
                onClick={() => {
                  addTab(
                    String(shared.data!.query?.sql || ''),
                    shared.data!.title,
                    String(shared.data!.query?.targetId || current.targetId),
                  );
                  const next = new URLSearchParams(urlParams);
                  next.delete('share');
                  setUrlParams(next, { replace: true });
                }}
              >
                Open reviewed query in read-only editor
              </Button>
            </>
          )}
          {shared.data?.job && (
            <ResultGrid
              job={shared.data.job}
              index={shared.data.index || 0}
              canExport={Boolean(capabilities.data?.actions.export)}
              shareId={sharedId!}
            />
          )}
        </Stack>
      </Modal>
      <Modal
        opened={renaming}
        onClose={() => setRenaming(false)}
        title="Rename query tab"
        centered
      >
        <Stack>
          <TextInput
            label="Tab title"
            value={tabTitle}
            maxLength={120}
            onChange={(e) => setTabTitle(e.currentTarget.value)}
            autoFocus
          />
          <Button
            disabled={!tabTitle.trim()}
            onClick={() => {
              patch({ title: tabTitle.trim(), dirty: true });
              setRenaming(false);
            }}
          >
            Rename
          </Button>
        </Stack>
      </Modal>
      <Modal
        opened={closeOthers}
        onClose={() => setCloseOthers(false)}
        title="Close other query tabs?"
        centered
      >
        <Stack>
          <Text size="sm">
            Unsaved SQL in the other tabs will be removed from the workspace
            draft. Running jobs remain available in History.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setCloseOthers(false)}>
              Keep tabs
            </Button>
            <Button
              color="orange"
              onClick={() => {
                setTabs([current]);
                setActive(current.id);
                setCloseOthers(false);
              }}
            >
              Close other tabs
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Modal
        opened={Boolean(pending)}
        onClose={() => {
          if (!running) {
            setPending(undefined);
            setReview(undefined);
          }
        }}
        title={
          review ? 'Review database write' : 'Describe this database write'
        }
        centered
        size="lg"
      >
        <Stack>
          <Alert
            color="orange"
            title={`Target: ${target?.environment || ''} · ${review?.target.database || target?.database}`}
          >
            Changes apply directly to this database. They do not invoke
            OmniLodge booking, refund or payroll workflows.
          </Alert>
          {review?.statements.some((s) => s.rollbackPlan) && (
            <Alert color="orange" title="Actual write plan: rollback required">
              This diagnostic executes the write and always rolls back its
              database transaction. Sequence values and effects of external
              triggers may remain. RETURNING is required to verify the
              affected-row budget.
            </Alert>
          )}
          <Textarea
            label="Reason"
            value={reason}
            onChange={(e) => {
              setReason(e.currentTarget.value);
              setReview(undefined);
            }}
            minRows={2}
            disabled={Boolean(review)}
            required
          />
          {review ? (
            <>
              <Text size="sm">
                {review.statements.length} statement(s) in one transaction.
                Maximum {review.rowLimit} affected rows. Approval expires{' '}
                {new Date(review.expiresAt).toLocaleTimeString()}.
              </Text>
              {review.statements.map((s, i) => (
                <pre key={i} className="dw-review-sql">
                  {s.sql}
                </pre>
              ))}
              <Group justify="flex-end">
                <Button
                  variant="default"
                  disabled={running}
                  onClick={() => {
                    setPending(undefined);
                    setReview(undefined);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  color="orange"
                  loading={running}
                  onClick={() =>
                    pending &&
                    void execute(
                      { ...pending.input, reviewToken: review.token },
                      pending.tabId,
                    )
                  }
                >
                  Execute reviewed write
                </Button>
              </Group>
            </>
          ) : (
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setPending(undefined)}>
                Cancel
              </Button>
              <Button
                disabled={reason.trim().length < 5}
                loading={running}
                onClick={() => void prepareReview()}
              >
                Prepare review
              </Button>
            </Group>
          )}
        </Stack>
      </Modal>
      <Modal
        opened={saveOpen}
        onClose={() => setSaveOpen(false)}
        title="Save SQL query"
        centered
      >
        <Stack>
          <TextInput
            label="Name"
            value={saveTitle}
            onChange={(e) => setSaveTitle(e.currentTarget.value)}
            maxLength={120}
            required
          />
          <TextInput
            label="Folder"
            value={saveFolder}
            onChange={(e) => setSaveFolder(e.currentTarget.value)}
            maxLength={120}
          />
          <Text size="xs" c="dimmed">
            The SQL is saved privately and encrypted. Parameter values are not
            saved with this query.
          </Text>
          <Button
            disabled={!saveTitle.trim()}
            loading={running}
            onClick={() => void saveQuery()}
          >
            Save query
          </Button>
        </Stack>
      </Modal>
      <Modal
        opened={Boolean(closeTab)}
        onClose={() => setCloseTab(undefined)}
        title="Close unsaved query?"
        centered
      >
        <Text size="sm">
          The private recovery draft may expire. Save the query to your library
          if you need to keep it.
        </Text>
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={() => setCloseTab(undefined)}>
            Keep open
          </Button>
          <Button
            color="red"
            onClick={() => {
              setTabs((p) => p.filter((t) => t.id !== closeTab));
              if (active === closeTab) setActive('');
              setCloseTab(undefined);
            }}
          >
            Close query
          </Button>
        </Group>
      </Modal>
    </div>
  );
}
function Setup({ capabilities }: { capabilities: Capabilities }) {
  return (
    <div className="dw-empty">
      <IconDatabase size={34} stroke={1.3} />
      <h2>Configure Database Workspace</h2>
      <p>
        {!capabilities.enabled
          ? 'Enable the workspace in Settings / Control Panel after provisioning its restricted connections.'
          : !capabilities.controlReady
            ? 'The protected control database is not ready. Complete its provisioning and start the execution worker.'
            : 'Register a database connection in Control Panel.'}
      </p>
      <Button
        component={Link}
        to="/settings/control-panel"
        variant="light"
        mt="sm"
      >
        Open Control Panel
      </Button>
      <Text size="xs" c="dimmed">
        Read/write credentials are managed separately from the application
        database login.
      </Text>
    </div>
  );
}
