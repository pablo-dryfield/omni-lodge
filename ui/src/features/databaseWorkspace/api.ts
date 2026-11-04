import axios from '../../utils/axiosInstance';

export type Target = {
  id: string;
  label: string;
  environment: string;
  database: string;
  major: number;
  schemas: string[];
  readOnly?: boolean;
  roles?: Record<string, string>;
};
export type Mode = 'read' | 'write';
export type Field = {
  id: string;
  name: string;
  oid: number;
  pgType: string;
  pgTypeSchema?: string;
  encoding: string;
  tableOid?: number;
  column?: number;
};
export type WireValue = string | null;
export type Result = {
  index: number;
  fields: Field[];
  capturedRows: number;
  capturedBytes: number;
  complete: boolean;
  capReason?: string;
  artifactId: string;
  expiresAt: string;
};
export type DbError = {
  code: string;
  message: string;
  sqlState?: string;
  position?: number;
  statementIndex?: number;
  detail?: string;
};
export type StatementOutcome = {
  index: number;
  sql: string;
  kind: string;
  command?: string;
  sourceStart: number;
  sourceEnd: number;
  affectedRows?: number;
  durationMs: number;
  result?: Result;
  error?: DbError;
  messages?: { severity: string; code?: string; message: string }[];
};
export type Job = {
  id: string;
  actorId: number;
  targetId: string;
  mode: Mode;
  status: string;
  transactionOutcome: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  summary: string;
  outcomes: StatementOutcome[];
  error?: DbError;
};
export type Capabilities = {
  enabled: boolean;
  writesEnabled: boolean;
  maintenanceEnabled: boolean;
  controlReady: boolean;
  workerReady?: boolean;
  activityRefreshSeconds?: number;
  metadataTtlSeconds?: number;
  cellDisplayMaxBytes?: number;
  controlStorage?: {
    bytes: number;
    budgetBytes: number;
    admissionBytes: number;
    warning: boolean;
  };
  actions: Record<string, boolean>;
  limits: Record<string, number | string>;
  targets: Target[];
  policyHash: string;
};
export type Input = {
  targetId: string;
  sql: string;
  parameters: WireValue[];
  mode: Mode;
  reason: string;
  reviewToken?: string;
  idempotencyKey?: string;
};
export type Review = {
  token: string;
  expiresAt: string;
  hash: string;
  target: Target;
  statements: {
    sql: string;
    kind: string;
    mutating: boolean;
    rollbackPlan?: boolean;
  }[];
  reason: string;
  atomic: boolean;
  rowLimit: number;
};
export type CatalogObject = {
  id: string;
  schema: string;
  name: string;
  kind: string;
  comment?: string;
  estimated_rows?: string;
  readable: boolean;
  writable: boolean;
};
export type ObjectDetails = CatalogObject & {
  qualifiedName: string;
  columns: {
    ordinal: number;
    name: string;
    type: string;
    pg_type: string;
    oid: number;
    not_null: boolean;
    identity: string;
    generated: string;
    primary_key: boolean;
    default_value?: string;
    comment?: string;
  }[];
  constraints: {
    name: string;
    kind: string;
    definition: string;
    related_object: string;
    target_schema?: string;
    target_name?: string;
    source_columns?: string[];
    target_columns?: string[];
  }[];
  indexes: {
    name: string;
    definition: string;
    valid: boolean;
    unique_index: boolean;
    primary_index: boolean;
  }[];
  definition?: string;
  owner: string;
  size_bytes: string;
  row_security: boolean;
  policies?: Record<string, unknown>[];
  triggers?: Record<string, unknown>[];
  dependencies?: Record<string, unknown>[];
  partitions?: Record<string, unknown>[];
  metadata?: Record<string, unknown>;
};
export type Filter =
  | { group: 'and' | 'or'; children: Filter[] }
  | { column: string; operator: string; value?: string | string[] };
export type Sort = {
  column: string;
  direction: 'asc' | 'desc';
  nulls: 'first' | 'last';
};
export type ResultView = {
  manifest: Result;
  fields: Field[];
  rows: WireValue[][];
  page: number;
  pageSize: number;
  filteredRows: number;
  capturedRows: number;
  complete: boolean;
  scope: string;
  collation: string;
};
export type Document = {
  id: string;
  kind: 'query' | 'draft' | 'layout' | 'share';
  revision: number;
  updatedAt: string;
  value: {
    title?: string;
    sql?: string;
    targetId?: string;
    tags?: string[];
    folder?: string;
    parameterDefinitions?: ParameterDefinition[];
    [key: string]: unknown;
  };
};
export type ParameterDefinition = {
  name: string;
  type: string;
  required: boolean;
  sensitive: boolean;
  defaultValue?: WireValue;
};
export type Session = {
  id: string;
  targetId: string;
  mode: Mode;
  state: string;
  revision: number;
  affectedRows: number;
  createdAt: string;
  expiresAt: string;
  outcome: string;
  pendingJobId: string | null;
};
const base = '/database-workspace';
export const api = {
  capabilities: async () =>
    (await axios.get<Capabilities>(`${base}/capabilities`)).data,
  validate: async (input: Input) =>
    (await axios.post(`${base}/validate`, input)).data,
  review: async (input: Input) =>
    (await axios.post<Review>(`${base}/reviews`, input)).data,
  execute: async (input: Input) =>
    (await axios.post<Job>(`${base}/executions`, input)).data,
  job: async (id: string) =>
    (await axios.get<Job>(`${base}/executions/${id}`)).data,
  cancel: async (id: string) =>
    (await axios.post<Job>(`${base}/executions/${id}/cancel`)).data,
  history: async () => (await axios.get<Job[]>(`${base}/history`)).data,
  result: async (id: string, index: number, options: Record<string, unknown>) =>
    (
      await axios.post<ResultView>(
        `${base}/executions/${id}/results/${index}`,
        options,
      )
    ).data,
  catalog: async (
    targetId: string,
    search = '',
    category = 'relations',
    offset = 0,
  ) =>
    (
      await axios.get<CatalogObject[]>(`${base}/catalog`, {
        params: { targetId, search, category, offset },
      })
    ).data,
  object: async (targetId: string, oid: string) =>
    (
      await axios.get<ObjectDetails>(`${base}/catalog/${oid}`, {
        params: { targetId },
      })
    ).data,
  documents: async (kind = 'query') =>
    (await axios.get<Document[]>(`${base}/documents`, { params: { kind } }))
      .data,
  saveDocument: async (data: Partial<Document>) =>
    (await axios.post<Document>(`${base}/documents`, data)).data,
  deleteDocument: async (id: string) => axios.delete(`${base}/documents/${id}`),
  revisions: async (id: string) =>
    (
      await axios.get<
        { revision: number; createdAt: string; value: Document['value'] }[]
      >(`${base}/documents/${id}/revisions`)
    ).data,
  audit: async (beforeId?: string) =>
    (
      await axios.get<Record<string, unknown>[]>(`${base}/audit`, {
        params: { beforeId },
      })
    ).data,
  adminJob: async (id: string) =>
    (await axios.get<Job>(`${base}/administration/executions/${id}`)).data,
  adminCancel: async (id: string, reason: string) =>
    (
      await axios.post<Job>(`${base}/administration/executions/${id}/cancel`, {
        reason,
      })
    ).data,
  browse: async (input: Record<string, unknown>) =>
    (
      await axios.post<{
        job: Job;
        view: {
          objectId: string;
          stable: boolean;
          pageSize: number;
          sql?: string;
          parameters?: WireValue[];
        };
      }>(`${base}/table-views`, input)
    ).data,
  tablePage: async (id: string) =>
    (
      await axios.get<
        ResultView & {
          hasMore: boolean;
          nextCursor: string | null;
          stable: boolean;
        }
      >(`${base}/table-views/${id}/page`)
    ).data,
  changePlan: async (input: Record<string, unknown>) =>
    (
      await axios.post<{
        token: string;
        expiresAt: string;
        hash: string;
        summary: unknown;
        statements: { sql: string; parameters: WireValue[] }[];
        target: Target;
      }>(`${base}/data-changes`, input)
    ).data,
  commitChanges: async (input: Record<string, unknown>) =>
    (
      await axios.post<Job>(`${base}/data-changes`, {
        ...input,
        action: 'commit',
      })
    ).data,
  sessions: async () => (await axios.get<Session[]>(`${base}/sessions`)).data,
  openSession: async (targetId: string, mode: Mode) =>
    (await axios.post<Session>(`${base}/sessions`, { targetId, mode })).data,
  sessionCommand: async (id: string, input: Record<string, unknown>) =>
    (await axios.post(`${base}/sessions/${id}/commands`, input)).data,
  activity: async (targetId: string) =>
    (
      await axios.get<Record<string, unknown>>(`${base}/activity`, {
        params: { targetId },
      })
    ).data,
  stageImport: async (input: Record<string, unknown>) =>
    (await axios.post(`${base}/imports`, input)).data,
  reviewImport: async (id: string, input: Record<string, unknown>) =>
    (await axios.post(`${base}/imports/${id}`, input)).data,
  adminOperation: async (input: Record<string, unknown>) =>
    (await axios.post(`${base}/administration/operations`, input)).data,
  schema: async (targetId: string) =>
    (await axios.get(`${base}/schema`, { params: { targetId } })).data,
  compareSchemas: async (input: Record<string, unknown>) =>
    (await axios.post(`${base}/schema/compare`, input)).data,
  privileges: async (targetId: string) =>
    (await axios.get(`${base}/privileges`, { params: { targetId } })).data,
  fullExport: async (executionId: string, index: number) =>
    (
      await axios.post<Job>(`${base}/exports`, {
        executionId,
        index,
        idempotencyKey: crypto.randomUUID(),
      })
    ).data,
  auditExport: async (
    id: string,
    index: number,
    format: string,
    scope: string,
  ) =>
    axios.post(`${base}/executions/${id}/export-audit`, {
      index,
      format,
      scope,
    }),
  download: async (id: string, index: number, format: string) =>
    (
      await axios.get<Blob>(`${base}/executions/${id}/download`, {
        params: { index, format },
        responseType: 'blob',
      })
    ).data,
  recipients: async () =>
    (
      await axios.get<{ id: number; name: string }[]>(
        `${base}/share-recipients`,
      )
    ).data,
  share: async (input: Record<string, unknown>) =>
    (await axios.post<{ id: string; path: string }>(`${base}/shares`, input))
      .data,
  openShare: async (id: string) =>
    (
      await axios.get<{
        kind: string;
        title: string;
        job?: Job;
        index?: number;
        query?: Document['value'];
      }>(`${base}/shares/${id}`)
    ).data,
  sharedResult: async (id: string, options: Record<string, unknown>) =>
    (await axios.post<ResultView>(`${base}/shares/${id}/results`, options))
      .data,
  schedules: async () => (await axios.get(`${base}/schedules`)).data,
  createSchedule: async (input: Record<string, unknown>) =>
    (await axios.post(`${base}/schedules`, input)).data,
  scheduleAction: async (id: string, action: string) =>
    (await axios.post(`${base}/schedules/${id}`, { action })).data,
  backups: async () => (await axios.get(`${base}/backups`)).data,
  sharedExportAudit: async (id: string, format: string, scope: string) =>
    axios.post(`${base}/shares/${id}/export-audit`, { format, scope }),
  createBackup: async () => (await axios.post(`${base}/backups`)).data,
  deleteBackup: async (input: Record<string, unknown>) =>
    (await axios.post(`${base}/backups/delete`, input)).data,
  stageRestore: async (input: Record<string, unknown>) =>
    (await axios.post(`${base}/restores/stage`, input)).data,
  reviewRestore: async (input: Record<string, unknown>) =>
    (await axios.post(`${base}/restores/review`, input)).data,
};
export function message(error: unknown): string {
  return (
    (error as { response?: { data?: { message?: string } } })?.response?.data
      ?.message ||
    (error instanceof Error ? error.message : 'The operation failed.')
  );
}
export const activeJob = (job?: Job) =>
  Boolean(
    job && ['queued', 'running', 'cancel_requested'].includes(job.status),
  );
