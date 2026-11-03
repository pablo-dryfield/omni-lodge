export type ExecutionMode = 'read' | 'write' | 'maintenance';
export type JobStatus =
  | 'queued'
  | 'running'
  | 'cancel_requested'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'outcome_unknown';
export type TransactionOutcome =
  | 'not_started'
  | 'read_only'
  | 'committed'
  | 'rolled_back'
  | 'staged'
  | 'partial'
  | 'not_applicable'
  | 'unknown';
export type WireValue = string | null;
export type Field = {
  id: string;
  name: string;
  oid: number;
  pgType: string;
  pgTypeSchema?: string;
  encoding: 'pg-text';
  tableOid?: number;
  column?: number;
};
export type ResultManifest = {
  index: number;
  fields: Field[];
  capturedRows: number;
  capturedBytes: number;
  complete: boolean;
  capReason?: string;
  artifactId: string;
  expiresAt: string;
};
export type StatementOutcome = {
  index: number;
  sql: string;
  sourceStart: number;
  sourceEnd: number;
  kind: string;
  command?: string;
  affectedRows?: number;
  durationMs: number;
  result?: ResultManifest;
  error?: WorkspaceErrorInfo;
  messages?: Array<{ severity: string; code?: string; message: string }>;
};
export type WorkspaceErrorInfo = {
  code: string;
  message: string;
  sqlState?: string;
  position?: number;
  statementIndex?: number;
  detail?: string;
  hint?: string;
};
export type Statement = {
  sql: string;
  start: number;
  end: number;
  kind: string;
  mutating: boolean;
  complexWrite: boolean;
  tree: Record<string, unknown>;
  relations: Array<{ schema: string; name: string }>;
  requiresReview?: boolean;
  /** EXPLAIN ANALYZE of DML always ends in ROLLBACK, never COMMIT. */
  rollbackPlan?: boolean;
  parameterCount?: number;
  parameters?: WireValue[];
  expectedAffected?: number;
};
export type Target = {
  id: string;
  label: string;
  environment: 'production' | 'staging' | 'development' | 'test';
  host: string;
  port: number;
  database: string;
  major: 15 | 16 | 17;
  schemas: string[];
  tls: boolean;
  ca?: string;
  readOnly?: boolean;
};
export type Credential = { user: string; password: string };
export type Limits = {
  queryMaxBytes: number;
  batchMaxStatements: number;
  readTimeoutMs: number;
  writeTimeoutMs: number;
  lockTimeoutMs: number;
  jobMaxDurationMs: number;
  activeJobsPerUser: number;
  activeJobsPerTarget: number;
  activeWritesPerTarget: number;
  queueMaxJobs: number;
  queueWaitMs: number;
  resultPageRows: number;
  resultMaxRows: number;
  resultMaxBytes: number;
  resultTtlMinutes: number;
  writeMaxRows: number;
  reviewTokenTtlSeconds: number;
  artifactDirectory: string;
  storageBudgetBytes: number;
};
export type ExecutionInput = {
  targetId: string;
  sql: string;
  parameters: WireValue[];
  mode: ExecutionMode;
  reason?: string;
  reviewToken?: string;
  idempotencyKey?: string;
};
export type JobPayload = {
  actorId: number;
  target: Target;
  credential: Credential;
  statements: Statement[];
  parameters: WireValue[];
  mode: ExecutionMode;
  reason: string;
  limits: Limits;
  policyHash: string;
  protectedObjects: string[];
  requestHash?: string;
  backupDeletion?: {
    copyId: string;
    fingerprint: string;
    filename: string;
    location: 'local' | 'drive';
    permanent: boolean;
  };
  recovery?: {
    destination: string;
    adminDatabase: string;
    credential: Credential;
    binary: string;
    directory: string;
    archiveId: string;
    cipherIv: string;
    cipherTag: string;
    checksum: string;
    bytes: number;
    sourceFilename: string;
    sourceCopyId?: string;
    sourceFingerprint?: string;
    sourceLocation?: 'local' | 'drive';
    serverMajor: number;
    archiveMajor: number;
    toolMajor: number;
    minFreeBytes: number;
    expansionFactor: number;
  };
  administration?: {
    kind: string;
    sql: string[];
    atomic: boolean;
    action: string;
    schemaHash?: string;
    lockRelations?: string[];
    privilegeHash?: string;
    postCheck?: { kind: string; oid: string };
    signal?: {
      pid: number;
      backendStart: string;
      queryStart: string;
      applicationName: string;
      user: string;
      terminate: boolean;
    };
  };
  sessionCommand?: { command: SessionCommand; name?: string };
  schemaChecks?: Array<{
    oid: string;
    qualifiedName: string;
    fingerprint: string;
  }>;
  tableView?: {
    fingerprint: string;
    sort: Array<{
      column: string;
      direction: 'asc' | 'desc';
      nulls: 'first' | 'last';
    }>;
    pageSize: number;
    stable: boolean;
    objectId: string;
    qualifiedName: string;
  };
};
export type JobRecord = {
  id: string;
  actorId: number;
  targetId: string;
  mode: ExecutionMode;
  status: JobStatus;
  transactionOutcome: TransactionOutcome;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  workerId?: string;
  generation: number;
  summary: string;
  statementCount: number;
  outcomes: StatementOutcome[];
  error?: WorkspaceErrorInfo;
  cancelCause?: string;
};
export type SessionCommand =
  | 'sql'
  | 'savepoint'
  | 'rollbackTo'
  | 'release'
  | 'commit'
  | 'rollback';
export type SessionPolicy = {
  idleMs: number;
  transactionMaxMs: number;
  maxMs: number;
  maxPerTarget: number;
};
export type SessionPayload = JobPayload & { sessionPolicy: SessionPolicy };
export type SessionRecord = {
  id: string;
  targetId: string;
  mode: ExecutionMode;
  state: string;
  revision: number;
  affectedRows: number;
  createdAt: string;
  expiresAt: string;
  outcome: string;
  pendingJobId: string | null;
  savepoints?: string[];
};

export class WorkspaceError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public context: Partial<WorkspaceErrorInfo> = {},
  ) {
    super(message);
    this.name = 'WorkspaceError';
  }
}
export const errorInfo = (error: unknown): WorkspaceErrorInfo => {
  if (error instanceof WorkspaceError)
    return { code: error.code, message: error.message, ...error.context };
  const e = error as {
    code?: string;
    message?: string;
    position?: string;
    detail?: string;
    hint?: string;
  };
  return {
    code: 'DATABASE_ERROR',
    message: e?.message || 'Database operation failed',
    sqlState: /^[A-Z0-9]{5}$/.test(e?.code || '') ? e.code : undefined,
    position: e?.position ? Number(e.position) : undefined,
  };
};
