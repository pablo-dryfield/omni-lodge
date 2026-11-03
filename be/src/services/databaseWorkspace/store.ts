import crypto from 'node:crypto';
import pg from 'pg';
import { encryptSecret, decryptSecret } from '../configEncryptionService.js';
import { WorkspaceError, type JobPayload, type JobRecord, type JobStatus, type StatementOutcome, type TransactionOutcome, type WorkspaceErrorInfo } from './types.js';

type Encrypted = ReturnType<typeof encryptSecret>;
type JobRow = { id: string; actor_id: string; target_id: string; mode: JobRecord['mode']; status: JobStatus; transaction_outcome: TransactionOutcome; created_at: Date; started_at: Date|null; finished_at: Date|null; worker_id: string|null; generation: number; summary: string; statement_count: number; outcomes: Encrypted|null; error: Encrypted|null; cancel_cause: string|null; payload?: Encrypted };
const sealed = (value: unknown) => JSON.stringify(encryptSecret(JSON.stringify(value)));
const opened = <T>(value: Encrypted): T => JSON.parse(decryptSecret(value)) as T;
const publicJob = (r: JobRow): JobRecord => ({ id: r.id, actorId: Number(r.actor_id), targetId: r.target_id, mode: r.mode, status: r.status, transactionOutcome: r.transaction_outcome,
  createdAt: r.created_at.toISOString(), startedAt: r.started_at?.toISOString(), finishedAt: r.finished_at?.toISOString(), workerId: r.worker_id||undefined, generation: r.generation,
  summary: r.summary, statementCount: r.statement_count, outcomes: r.outcomes ? opened<StatementOutcome[]>(r.outcomes) : [], error: r.error ? opened<WorkspaceErrorInfo>(r.error) : undefined, cancelCause: r.cancel_cause||undefined });

export class WorkspaceStore {
  readonly pool: pg.Pool;
  constructor(connectionString: string) {
    if (!connectionString) throw new WorkspaceError(503, 'CONTROL_STORE_UNAVAILABLE', 'Database Workspace control storage has not been provisioned.');
    this.pool = new pg.Pool({ connectionString, max: 3, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000, application_name: 'omnilodge-workspace-control' });
    // Avoid unhandled pool errors without forwarding connection strings or SQL to application telemetry.
    this.pool.on('error', () => { /* Readiness reports the failure on its next check. */ });
  }
  async initialize(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('omnilodge.database-workspace.schema'))");
      await client.query(`CREATE SCHEMA IF NOT EXISTS database_workspace;
        CREATE TABLE IF NOT EXISTS database_workspace.jobs (
          id uuid PRIMARY KEY, actor_id bigint NOT NULL, target_id text NOT NULL, mode text NOT NULL,
          status text NOT NULL, transaction_outcome text NOT NULL DEFAULT 'not_started',
          created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, finished_at timestamptz,
          queue_deadline timestamptz NOT NULL, worker_id text, generation integer NOT NULL DEFAULT 0,
          lease_until timestamptz, backend_pid integer, backend_start timestamptz,
          payload jsonb NOT NULL, outcomes jsonb, error jsonb, summary text NOT NULL,
          statement_count integer NOT NULL, idempotency_key text, operation_hash text NOT NULL, review_nonce text UNIQUE,
          cancel_cause text, UNIQUE(actor_id,idempotency_key));
        CREATE INDEX IF NOT EXISTS dw_jobs_queue ON database_workspace.jobs(status,created_at);
        CREATE INDEX IF NOT EXISTS dw_jobs_actor ON database_workspace.jobs(actor_id,created_at DESC);
        CREATE INDEX IF NOT EXISTS dw_jobs_target ON database_workspace.jobs(target_id,status);
        ALTER TABLE database_workspace.jobs ADD COLUMN IF NOT EXISTS authorization_context text;
        ALTER TABLE database_workspace.jobs ADD COLUMN IF NOT EXISTS backend_reconciled boolean NOT NULL DEFAULT false;
        CREATE TABLE IF NOT EXISTS database_workspace.schema_versions(version integer PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now());
        INSERT INTO database_workspace.schema_versions(version) VALUES(1) ON CONFLICT DO NOTHING;
        CREATE TABLE IF NOT EXISTS database_workspace.audit (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor_id bigint, target_id text,
          execution_id uuid, event text NOT NULL, metadata jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
        CREATE INDEX IF NOT EXISTS dw_audit_time ON database_workspace.audit(created_at DESC);
        CREATE TABLE IF NOT EXISTS database_workspace.documents (
          id uuid PRIMARY KEY, actor_id bigint NOT NULL, kind text NOT NULL, revision integer NOT NULL DEFAULT 1,
          payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz);
        CREATE INDEX IF NOT EXISTS dw_documents_actor ON database_workspace.documents(actor_id,kind,updated_at DESC);
        CREATE TABLE IF NOT EXISTS database_workspace.document_revisions (
          document_id uuid NOT NULL REFERENCES database_workspace.documents(id) ON DELETE CASCADE,
          revision integer NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(document_id,revision));
        CREATE TABLE IF NOT EXISTS database_workspace.artifacts (
          id uuid PRIMARY KEY, execution_id uuid NOT NULL REFERENCES database_workspace.jobs(id), actor_id bigint NOT NULL,
          result_index integer NOT NULL, manifest jsonb NOT NULL, directory text NOT NULL, bytes bigint NOT NULL DEFAULT 0,
          expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(execution_id,result_index));
        CREATE INDEX IF NOT EXISTS dw_artifacts_expiry ON database_workspace.artifacts(expires_at);
        CREATE TABLE IF NOT EXISTS database_workspace.storage_budget (id integer PRIMARY KEY CHECK(id=1), bytes bigint NOT NULL DEFAULT 0 CHECK(bytes>=0));
        INSERT INTO database_workspace.storage_budget(id,bytes) VALUES(1,0) ON CONFLICT DO NOTHING;
        CREATE TABLE IF NOT EXISTS database_workspace.schedules (
          id uuid PRIMARY KEY, actor_id bigint NOT NULL, target_id text NOT NULL, enabled boolean NOT NULL DEFAULT false,
          next_run timestamptz, payload jsonb NOT NULL, last_job_id uuid, updated_at timestamptz NOT NULL DEFAULT now());
        CREATE TABLE IF NOT EXISTS database_workspace.sessions (
          id uuid PRIMARY KEY, actor_id bigint NOT NULL, target_id text NOT NULL, worker_id text,
          generation integer NOT NULL DEFAULT 1, state text NOT NULL DEFAULT 'queued', payload jsonb NOT NULL,
          heartbeat_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL);
        REVOKE ALL ON SCHEMA database_workspace FROM PUBLIC;
        REVOKE ALL ON ALL TABLES IN SCHEMA database_workspace FROM PUBLIC;`);
      await client.query('COMMIT');
    } catch(e) { await client.query('ROLLBACK').catch(()=>{}); throw e; } finally { client.release(); }
  }
  async healthy(): Promise<boolean> { try { await this.pool.query('SELECT 1 FROM database_workspace.storage_budget WHERE id=1'); return true; } catch { return false; } }
  async audit(actorId: number|null,event: string,metadata: unknown,targetId?: string,id?: string): Promise<void> {
    await this.pool.query('INSERT INTO database_workspace.audit(actor_id,event,metadata,target_id,execution_id) VALUES($1,$2,$3,$4,$5)',[actorId,event,sealed(metadata),targetId||null,id||null]);
  }
  async enqueue(payload: JobPayload, operationHash: string, idempotencyKey?: string,reviewNonce?:string): Promise<JobRecord> {
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('omnilodge.database-workspace.admission'))");
      if(idempotencyKey) {
        const existing=await client.query('SELECT * FROM database_workspace.jobs WHERE actor_id=$1 AND idempotency_key=$2',[payload.actorId,idempotencyKey]);
        if(existing.rows.length) {
          if(existing.rows[0].operation_hash!==operationHash) throw new WorkspaceError(409,'IDEMPOTENCY_CONFLICT','That request ID was already used for a different operation.');
          await client.query('COMMIT'); return publicJob(existing.rows[0]);
        }
      }
      const count=await client.query("SELECT count(*)::int AS total FROM database_workspace.jobs WHERE status='queued'");
      if(count.rows[0].total>=payload.limits.queueMaxJobs) throw new WorkspaceError(429,'QUEUE_FULL','Database Workspace is busy. Try again after queued jobs finish.');
      const id=crypto.randomUUID();
      if(reviewNonce&&(await client.query('SELECT 1 FROM database_workspace.jobs WHERE review_nonce=$1',[reviewNonce])).rowCount)throw new WorkspaceError(409,'REVIEW_ALREADY_USED','This approval was already submitted. Review a new operation instead of replaying it.');
      const inserted=await client.query(`INSERT INTO database_workspace.jobs(id,actor_id,target_id,mode,status,queue_deadline,payload,summary,statement_count,idempotency_key,operation_hash,review_nonce)
        VALUES($1,$2,$3,$4,'queued',now()+$5::int*interval '1 millisecond',$6,$7,$8,$9,$10,$11) RETURNING *`,
        [id,payload.actorId,payload.target.id,payload.mode,payload.limits.queueWaitMs,sealed(payload),`${payload.statements.length} ${payload.mode} statement(s)`,payload.statements.length,idempotencyKey||null,operationHash,reviewNonce||null]);
      await client.query('INSERT INTO database_workspace.audit(actor_id,target_id,execution_id,event,metadata) VALUES($1,$2,$3,$4,$5)',[payload.actorId,payload.target.id,id,'execution_admitted',sealed({operationHash,mode:payload.mode,reason:payload.reason,policyHash:payload.policyHash})]);
      await client.query('COMMIT'); return publicJob(inserted.rows[0]);
    }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
  }
  async get(id: string,actorId?: number): Promise<JobRecord> {
    const r=await this.pool.query('SELECT * FROM database_workspace.jobs WHERE id=$1 AND ($2::bigint IS NULL OR actor_id=$2)',[id,actorId??null]);
    if(!r.rows.length) throw new WorkspaceError(404,'EXECUTION_NOT_FOUND','Execution not found.');
    return publicJob(r.rows[0]);
  }
  async history(actorId: number,limit=50): Promise<JobRecord[]> {
    const r=await this.pool.query('SELECT * FROM database_workspace.jobs WHERE actor_id=$1 ORDER BY created_at DESC LIMIT $2',[actorId,Math.min(100,limit)]);
    return r.rows.map(publicJob);
  }
  async privatePayload(id:string,actorId:number):Promise<JobPayload>{
    const r=await this.pool.query('SELECT payload FROM database_workspace.jobs WHERE id=$1 AND actor_id=$2',[id,actorId]);
    if(!r.rowCount)throw new WorkspaceError(404,'EXECUTION_NOT_FOUND','Execution not found.');
    return opened<JobPayload>(r.rows[0].payload);
  }
  async claim(workerId: string): Promise<{ job: JobRecord; payload: JobPayload }|null> {
    const c=await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT pg_advisory_xact_lock(hashtext('omnilodge.database-workspace.admission'))");
      await c.query("UPDATE database_workspace.jobs SET status='cancelled',transaction_outcome='not_started',cancel_cause='queue_expired',finished_at=now() WHERE status='queued' AND queue_deadline<now()");
      const pending=await c.query("SELECT * FROM database_workspace.jobs WHERE status='queued' ORDER BY created_at LIMIT 50 FOR UPDATE SKIP LOCKED");
      for(const row of pending.rows) {
        const payload=opened<JobPayload>(row.payload);
        const active=await c.query(`SELECT count(*) FILTER(WHERE actor_id=$1)::int AS actor,
          count(*) FILTER(WHERE target_id=$2)::int AS target,
          count(*) FILTER(WHERE target_id=$2 AND mode<>'read')::int AS writes
          FROM database_workspace.jobs WHERE status IN ('running','cancel_requested') OR (status='outcome_unknown' AND NOT backend_reconciled)`,[payload.actorId,payload.target.id]);
        const counts=active.rows[0];
        if(counts.actor>=payload.limits.activeJobsPerUser || counts.target>=payload.limits.activeJobsPerTarget || (payload.mode!=='read' && counts.writes>=payload.limits.activeWritesPerTarget)) continue;
        const updated=await c.query("UPDATE database_workspace.jobs SET status='running',worker_id=$2,generation=generation+1,lease_until=now()+interval '15 seconds',started_at=now() WHERE id=$1 RETURNING *",[row.id,workerId]);
        await c.query('COMMIT'); return {job:publicJob(updated.rows[0]),payload};
      }
      await c.query('COMMIT');return null;
    }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
  }
  async heartbeat(id: string,workerId: string,generation: number): Promise<{status: JobStatus}|null> {
    const r=await this.pool.query("UPDATE database_workspace.jobs SET lease_until=now()+interval '15 seconds' WHERE id=$1 AND worker_id=$2 AND generation=$3 AND status IN ('running','cancel_requested') RETURNING status",[id,workerId,generation]);
    return r.rows[0]||null;
  }
  async backend(id: string,workerId: string,generation: number,pid: number,start: string): Promise<void> {
    const r=await this.pool.query("UPDATE database_workspace.jobs SET backend_pid=$4,backend_start=$5 WHERE id=$1 AND worker_id=$2 AND generation=$3 AND status IN ('running','cancel_requested')",[id,workerId,generation,pid,start]);
    if(!r.rowCount) throw new WorkspaceError(409,'LEASE_LOST','Execution ownership was lost.');
  }
  async finish(job: JobRecord,status: JobStatus,outcome: TransactionOutcome,outcomes: StatementOutcome[],error?: WorkspaceErrorInfo): Promise<boolean> {
    const c=await this.pool.connect();
    try {
      await c.query('BEGIN');
      const r=await c.query("UPDATE database_workspace.jobs SET status=$4,transaction_outcome=$5,outcomes=$6,error=$7,finished_at=now(),lease_until=NULL WHERE id=$1 AND worker_id=$2 AND generation=$3 AND status IN ('running','cancel_requested') RETURNING id",[job.id,job.workerId,job.generation,status,outcome,sealed(outcomes),error?sealed(error):null]);
      if(r.rowCount) await c.query('INSERT INTO database_workspace.audit(actor_id,target_id,execution_id,event,metadata) VALUES($1,$2,$3,$4,$5)',[job.actorId,job.targetId,job.id,'execution_finished',sealed({status,outcome,errorCode:error?.code})]);
      await c.query('COMMIT');return Boolean(r.rowCount);
    }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
  }
  async cancel(id: string,actorId: number): Promise<JobRecord> {
    await this.get(id,actorId);
    const r=await this.pool.query(`UPDATE database_workspace.jobs SET status=CASE WHEN status='queued' THEN 'cancelled' ELSE 'cancel_requested' END,
      cancel_cause='user',finished_at=CASE WHEN status='queued' THEN now() ELSE finished_at END
      WHERE id=$1 AND actor_id=$2 AND status IN ('queued','running') RETURNING *`,[id,actorId]);
    if(r.rowCount) await this.audit(actorId,'cancel_requested',{},r.rows[0].target_id,id);
    return this.get(id,actorId);
  }
  async expireLostLeases(): Promise<number> {
    // Never replay running work. Retain backend identity for operator reconciliation.
    const r=await this.pool.query("UPDATE database_workspace.jobs SET status='outcome_unknown',transaction_outcome='unknown',finished_at=now() WHERE status IN ('running','cancel_requested') AND lease_until<now()-interval '15 seconds' RETURNING id");
    for(const row of r.rows) await this.audit(null,'worker_lease_lost',{outcome:'unknown'},undefined,row.id);
    return r.rowCount||0;
  }
  async reserveBytes(bytes: number,limit: number): Promise<void> {
    const r=await this.pool.query('UPDATE database_workspace.storage_budget SET bytes=bytes+$1 WHERE id=1 AND bytes+$1<=$2',[bytes,limit]);
    if(!r.rowCount) throw new WorkspaceError(507,'STORAGE_LIMIT','Database Workspace artifact storage is full.');
  }
  async releaseBytes(bytes: number): Promise<void> { await this.pool.query('UPDATE database_workspace.storage_budget SET bytes=GREATEST(0,bytes-$1) WHERE id=1',[bytes]); }
  async saveArtifact(id: string,job: JobRecord,index: number,manifest: unknown,directory: string,bytes: number,expiresAt: string): Promise<void> {
    await this.pool.query('INSERT INTO database_workspace.artifacts(id,execution_id,actor_id,result_index,manifest,directory,bytes,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,job.id,job.actorId,index,sealed(manifest),directory,bytes,expiresAt]);
  }
  async artifact(jobId: string,index: number,actorId: number): Promise<{ id: string; manifest: unknown; directory: string }> {
    const r=await this.pool.query('SELECT * FROM database_workspace.artifacts WHERE execution_id=$1 AND result_index=$2 AND actor_id=$3 AND expires_at>now()',[jobId,index,actorId]);
    if(!r.rows.length) throw new WorkspaceError(410,'RESULT_EXPIRED','This result has expired or is unavailable. Run a permitted read again to capture a new result.');
    return {id:r.rows[0].id,manifest:opened(r.rows[0].manifest),directory:r.rows[0].directory};
  }
  async documents(actorId:number,kind:string) {
    const r=await this.pool.query('SELECT * FROM database_workspace.documents WHERE actor_id=$1 AND kind=$2 AND (expires_at IS NULL OR expires_at>now()) ORDER BY updated_at DESC LIMIT 100',[actorId,kind]);
    return r.rows.map(d=>({id:d.id,kind:d.kind,revision:d.revision,updatedAt:d.updated_at.toISOString(),value:opened(d.payload)}));
  }
  async saveDocument(actorId:number,input:{id?:string;kind:string;revision?:number;value:unknown},ttlDays?:number) {
    const c=await this.pool.connect();const id=input.id||crypto.randomUUID();
    try{
      await c.query('BEGIN');
      if(input.id){
        const old=await c.query('SELECT * FROM database_workspace.documents WHERE id=$1 AND actor_id=$2 AND kind=$3 FOR UPDATE',[id,actorId,input.kind]);
        if(!old.rows.length)throw new WorkspaceError(404,'DOCUMENT_NOT_FOUND','Saved query or draft not found.');
        if(old.rows[0].revision!==input.revision)throw new WorkspaceError(409,'DOCUMENT_CHANGED','This document was changed in another tab. Reload its latest version before saving.');
        await c.query('INSERT INTO database_workspace.document_revisions(document_id,revision,payload) VALUES($1,$2,$3)',[id,old.rows[0].revision,old.rows[0].payload]);
        await c.query('UPDATE database_workspace.documents SET payload=$3,revision=revision+1,updated_at=now(),expires_at=$4 WHERE id=$1 AND actor_id=$2',[id,actorId,sealed(input.value),ttlDays?new Date(Date.now()+ttlDays*86400000):null]);
      }else{
        const count=await c.query('SELECT count(*)::int AS count FROM database_workspace.documents WHERE actor_id=$1 AND kind=$2',[actorId,input.kind]);
        if(count.rows[0].count>=100)throw new WorkspaceError(409,'DOCUMENT_LIMIT','This library already contains 100 documents. Remove an old document first.');
        await c.query('INSERT INTO database_workspace.documents(id,actor_id,kind,payload,expires_at) VALUES($1,$2,$3,$4,$5)',[id,actorId,input.kind,sealed(input.value),ttlDays?new Date(Date.now()+ttlDays*86400000):null]);
      }
      const result=await c.query('SELECT * FROM database_workspace.documents WHERE id=$1',[id]);
      await c.query('COMMIT');const d=result.rows[0];return {id:d.id,kind:d.kind,revision:d.revision,updatedAt:d.updated_at.toISOString(),value:input.value};
    }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
  }
  async deleteDocument(actorId:number,id:string):Promise<void>{
    await this.pool.query('DELETE FROM database_workspace.documents WHERE id=$1 AND actor_id=$2',[id,actorId]);
    await this.audit(actorId,'document_deleted',{id});
  }
  async close(): Promise<void> {await this.pool.end();}
  async existing(actorId:number,key:string|undefined,hash:string):Promise<JobRecord|undefined>{
    if(!key)return undefined;
    const r=await this.pool.query('SELECT * FROM database_workspace.jobs WHERE actor_id=$1 AND idempotency_key=$2',[actorId,key]);
    if(!r.rowCount)return undefined;
    if(r.rows[0].operation_hash!==hash)throw new WorkspaceError(409,'IDEMPOTENCY_CONFLICT','That request ID belongs to a different operation.');
    return publicJob(r.rows[0]);
  }
  async authorization(job:JobRecord,context:string):Promise<void>{
    await this.pool.query('UPDATE database_workspace.jobs SET authorization_context=$4 WHERE id=$1 AND worker_id=$2 AND generation=$3',[job.id,job.workerId,job.generation,context]);
  }
  async authorizationContext(id:string,actorId:number):Promise<string|null>{
    const r=await this.pool.query('SELECT authorization_context FROM database_workspace.jobs WHERE id=$1 AND actor_id=$2',[id,actorId]);return r.rows[0]?.authorization_context||null;
  }
  async unreconciled():Promise<Array<{id:string;pid:number|null;start:string|null;payload:JobPayload}>>{
    const r=await this.pool.query("SELECT id,backend_pid,backend_start::text,payload FROM database_workspace.jobs WHERE status='outcome_unknown' AND NOT backend_reconciled LIMIT 20");
    return r.rows.map(row=>({id:row.id,pid:row.backend_pid,start:row.backend_start,payload:opened<JobPayload>(row.payload)}));
  }
  async reconciled(id:string):Promise<void>{await this.pool.query("UPDATE database_workspace.jobs SET backend_reconciled=true WHERE id=$1 AND status='outcome_unknown'",[id]);await this.audit(null,'orphan_session_reconciled',{},undefined,id);}
}

let instance: WorkspaceStore|undefined;
export const controlStore = (): WorkspaceStore => instance ??= new WorkspaceStore(process.env.DB_WORKSPACE_CONTROL_URL || '');
export const operationHash = (value: unknown) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
