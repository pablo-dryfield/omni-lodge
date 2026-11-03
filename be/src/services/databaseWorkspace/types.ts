export type ExecutionMode = 'read' | 'write' | 'maintenance';
export type JobStatus = 'queued' | 'running' | 'cancel_requested' | 'succeeded' | 'failed' | 'cancelled' | 'outcome_unknown';
export type TransactionOutcome = 'not_started' | 'read_only' | 'committed' | 'rolled_back' | 'partial' | 'not_applicable' | 'unknown';
export type WireValue = string | null;
export type Field = { id: string; name: string; oid: number; pgType: string; pgTypeSchema?:string; encoding: 'pg-text'; tableOid?: number; column?: number };
export type ResultManifest = { index: number; fields: Field[]; capturedRows: number; capturedBytes: number; complete: boolean; capReason?: string; artifactId: string; expiresAt: string };
export type StatementOutcome = { index: number; sql: string; sourceStart: number; sourceEnd: number; kind: string; command?: string; affectedRows?: number; durationMs: number; result?: ResultManifest; error?: WorkspaceErrorInfo };
export type WorkspaceErrorInfo = { code: string; message: string; sqlState?: string; position?: number; statementIndex?: number; detail?: string; hint?: string };
export type Statement = { sql: string; start: number; end: number; kind: string; mutating: boolean; complexWrite: boolean; tree: Record<string, unknown>; relations: Array<{ schema: string; name: string }>; parameterCount?:number; parameters?:WireValue[]; expectedAffected?:number };
export type Target = { id: string; label: string; environment: 'production' | 'staging' | 'development' | 'test'; host: string; port: number; database: string; major: 15 | 16 | 17; schemas: string[]; tls: boolean; ca?: string; readOnly?: boolean };
export type Credential = { user: string; password: string };
export type Limits = {
  queryMaxBytes: number; batchMaxStatements: number; readTimeoutMs: number; writeTimeoutMs: number; lockTimeoutMs: number; jobMaxDurationMs: number;
  activeJobsPerUser: number; activeJobsPerTarget: number; activeWritesPerTarget: number; queueMaxJobs: number; queueWaitMs: number;
  resultPageRows: number; resultMaxRows: number; resultMaxBytes: number; resultTtlMinutes: number; writeMaxRows: number; reviewTokenTtlSeconds: number;
  artifactDirectory: string; storageBudgetBytes: number;
};
export type ExecutionInput = { targetId: string; sql: string; parameters: WireValue[]; mode: ExecutionMode; reason?: string; reviewToken?: string; idempotencyKey?: string };
export type JobPayload = { actorId: number; target: Target; credential: Credential; statements: Statement[]; parameters: WireValue[]; mode: ExecutionMode; reason: string; limits: Limits; policyHash: string; protectedObjects: string[]; schemaChecks?:Array<{oid:string;qualifiedName:string;fingerprint:string}>; tableView?:{fingerprint:string;sort:Array<{column:string;direction:'asc'|'desc';nulls:'first'|'last'}>;pageSize:number;stable:boolean;objectId:string;qualifiedName:string} };
export type JobRecord = { id: string; actorId: number; targetId: string; mode: ExecutionMode; status: JobStatus; transactionOutcome: TransactionOutcome; createdAt: string; startedAt?: string; finishedAt?: string; workerId?: string; generation: number; summary: string; statementCount: number; outcomes: StatementOutcome[]; error?: WorkspaceErrorInfo; cancelCause?: string };

export class WorkspaceError extends Error {
  constructor(public status: number, public code: string, message: string, public context: Partial<WorkspaceErrorInfo> = {}) { super(message); this.name = 'WorkspaceError'; }
}
export const errorInfo = (error: unknown): WorkspaceErrorInfo => {
  if (error instanceof WorkspaceError) return { code: error.code, message: error.message, ...error.context };
  const e = error as { code?: string; message?: string; position?: string; detail?: string; hint?: string };
  return { code: 'DATABASE_ERROR', message: e?.message || 'Database operation failed', sqlState: /^[A-Z0-9]{5}$/.test(e?.code || '') ? e.code : undefined,
    position: e?.position ? Number(e.position) : undefined };
};
