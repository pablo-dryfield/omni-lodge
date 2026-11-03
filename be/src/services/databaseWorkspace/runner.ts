import pg from 'pg';
import Cursor from 'pg-cursor';
import type { WorkspaceStore } from './store.js';
import { targetClient, assertRestrictedIdentity } from './connection.js';
import { writeResult } from './artifacts.js';
import { schemaFingerprint } from './schemaFingerprint.js';
import { authorizationSnapshot } from './resultAccess.js';
import { errorInfo, WorkspaceError, type Field, type JobPayload, type JobRecord, type StatementOutcome, type TransactionOutcome, type WireValue } from './types.js';

const rawTypes={getTypeParser:(_oid:number,_format?:string)=>(value:string)=>value};
export async function runJob(store: WorkspaceStore,job: JobRecord,payload: JobPayload,authorize:()=>Promise<void>): Promise<void> {
  const client=targetClient(payload.target,payload.credential,`omnilodge-workspace:${job.id}`);
  const outcomes: StatementOutcome[]=[];
  let transaction=false,committing=false,committed=false,connected=false,stopped=false,leaseLost=false;
  let backend: {pid:number;start:string}|undefined;
  let cancelReason:string|undefined;
  let checking=false;
  const deadline=Date.now()+payload.limits.jobMaxDurationMs;
  const cancel=async(reason:string)=>{
    if(cancelReason)return;
    cancelReason=reason;
    if(!backend)return;
    const control=targetClient(payload.target,payload.credential,'omnilodge-workspace-cancel');
    try {
      await control.connect();
      await control.query('SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE pid=$1 AND backend_start=$2::timestamptz AND application_name=$3',[backend.pid,backend.start,`omnilodge-workspace:${job.id}`]);
    }catch{ /* The query deadline/session close remains a second boundary. */ }finally{await control.end().catch(()=>{});}
  };
  const heartbeat=setInterval(()=>{
    if(checking||stopped)return;checking=true;
    void(async()=>{
      const state=await store.heartbeat(job.id,job.workerId!,job.generation);
      if(!state){leaseLost=true;await cancel('lease_lost');}
      else if(state.status==='cancel_requested')await cancel('user');
      if(Date.now()>deadline)await cancel('deadline');
    })().catch(()=>{leaseLost=true;void cancel('control_store_unavailable');}).finally(()=>{checking=false;});
  },500);
  heartbeat.unref();
  try {
    await authorize();
    await client.connect();connected=true;
    await assertRestrictedIdentity(client,payload.target);
    await store.authorization(job,await authorizationSnapshot(client,payload));
    const identity=await client.query("SELECT pg_backend_pid() AS pid,backend_start::text AS start FROM pg_stat_activity WHERE pid=pg_backend_pid()");
    backend=identity.rows[0];
    await store.backend(job.id,job.workerId!,job.generation,backend!.pid,backend!.start);
    if(cancelReason)throw new WorkspaceError(409,'CANCELLED','Execution cancelled before it started.');
    await client.query(payload.mode==='read'?'BEGIN READ ONLY':'BEGIN');transaction=true;
    await client.query('SELECT set_config($1,$2,true),set_config($3,$4,true)', ['statement_timeout',String(payload.mode==='read'?payload.limits.readTimeoutMs:payload.limits.writeTimeoutMs),'lock_timeout',String(payload.limits.lockTimeoutMs)]);
    await client.query("SELECT set_config('idle_in_transaction_session_timeout','10000',true),set_config('search_path','pg_catalog,public',true)");
    for(const check of payload.schemaChecks||[]){
      await client.query(`LOCK TABLE ${check.qualifiedName} IN ROW EXCLUSIVE MODE`);
      if(await schemaFingerprint(client,check.oid)!==check.fingerprint)throw new WorkspaceError(409,'SCHEMA_CHANGED','The table or its dependencies changed after review. Refresh the table and review the operation again.');
    }
    const types=await client.query('SELECT t.oid,t.typname,n.nspname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace');
    const typeNames=new Map(types.rows.map(t=>[Number(t.oid),{name:String(t.typname),schema:String(t.nspname)}]));
    let affected=0;
    for(let index=0;index<payload.statements.length;index++) {
      if(cancelReason||leaseLost)throw new WorkspaceError(409,'CANCELLED','Execution was cancelled.');
      const statement=payload.statements[index],started=Date.now();
      const bound=statement.parameters??payload.parameters.slice(0,statement.parameterCount||0);
      if(bound.length<(statement.parameterCount||0))throw new WorkspaceError(400,'PARAMETER_REQUIRED','This statement is missing a bound parameter.');
      const captured:WireValue[][]=[];
      let fields:Field[]=[],bytes=0,complete=true,capReason:string|undefined,command='',rowCount=0;
      const describe=(input:pg.FieldDef[])=>input.map((f,n)=>({id:`c${n}`,name:f.name,oid:f.dataTypeID,pgType:typeNames.get(f.dataTypeID)?.name||String(f.dataTypeID),pgTypeSchema:typeNames.get(f.dataTypeID)?.schema,encoding:'pg-text' as const,tableOid:f.tableID,column:f.columnID}));
      const capture=(row:WireValue[])=>{
        const size=Buffer.byteLength(JSON.stringify(row));
        if(captured.length>=payload.limits.resultMaxRows||bytes+size>payload.limits.resultMaxBytes){complete=false;capReason=captured.length>=payload.limits.resultMaxRows?'row_limit':'byte_limit';return false;}
        bytes+=size;captured.push(row);return true;
      };
      try {
        if(!statement.mutating) {
          const cursor=client.query(new Cursor(statement.sql,bound,{rowMode:'array',types:rawTypes}));
          try {
            while(true){
              const batch=await new Promise<pg.QueryResult>((resolve,reject)=>cursor.read(128,(error,rows,result)=>error?reject(error):resolve(result||{rows,fields:[],command:'SELECT',rowCount:rows.length,oid:0})));
              if(!fields.length)fields=describe(batch.fields);
              if(!batch.rows.length)break;
              let full=false;
              for(const row of batch.rows as WireValue[][])if(!capture(row)){full=true;break;}
              if(full)break;
            }
          }finally{await cursor.close();}
          command=statement.kind==='ExplainStmt'?'EXPLAIN':'SELECT';rowCount=captured.length;
        }else{
          const result=await new Promise<pg.QueryResult>((resolve,reject)=>{
            const queryConfig:pg.QueryArrayConfig={text:statement.sql,values:bound,rowMode:'array',types:rawTypes};
            const query=new pg.Query(queryConfig);
            query.on('row',(row:WireValue[])=>{capture(row);});
            query.on('error',reject);query.on('end',resolve);client.query(query);
          });
          fields=describe(result.fields);command=result.command;rowCount=result.rowCount||0;affected+=rowCount;
          if(statement.expectedAffected!==undefined&&rowCount!==statement.expectedAffected)throw new WorkspaceError(409,'ROW_CONFLICT','A selected row changed or was removed. The entire transaction was rolled back; reload its current values before saving.');
          if(affected>payload.limits.writeMaxRows)throw new WorkspaceError(409,'WRITE_ROW_LIMIT',`The transaction affected more than ${payload.limits.writeMaxRows} rows and has been rolled back.`);
          if(capReason==='byte_limit')throw new WorkspaceError(413,'RESULT_BYTE_LIMIT','The write result exceeded its byte budget. The transaction was rolled back.');
        }
        const result=fields.length?await writeResult(store,job,index,fields,captured,complete,{directory:payload.limits.artifactDirectory,ttlMinutes:payload.limits.resultTtlMinutes,storageBudget:payload.limits.storageBudgetBytes,capReason}):undefined;
        outcomes.push({index,sql:statement.sql,sourceStart:statement.start,sourceEnd:statement.end,kind:statement.kind,command,affectedRows:statement.mutating?rowCount:undefined,durationMs:Date.now()-started,result});
      }catch(error){outcomes.push({index,sql:statement.sql,sourceStart:statement.start,sourceEnd:statement.end,kind:statement.kind,durationMs:Date.now()-started,error:errorInfo(error)});throw error;}
    }
    await authorize();
    if(cancelReason||leaseLost)throw new WorkspaceError(409,'CANCELLED','Execution was cancelled before commit.');
    committing=true;await client.query('COMMIT');committed=true;transaction=false;
    await store.finish(job,'succeeded',payload.mode==='read'?'read_only':'committed',outcomes);
  }catch(error){
    let outcome:TransactionOutcome=committed?'committed':committing?'unknown':transaction?'unknown':'not_started';
    if(transaction&&!committing&&connected){try{await client.query('ROLLBACK');outcome='rolled_back';transaction=false;}catch{outcome='unknown';}}
    const unknown=outcome==='unknown'||leaseLost;
    const isCancelled=cancelReason==='user'||cancelReason==='deadline';
    const info=cancelReason==='deadline'?{code:'JOB_TIMEOUT',message:'Execution exceeded its configured duration.'}:errorInfo(error);
    await store.finish(job,unknown?'outcome_unknown':committed?'succeeded':isCancelled?'cancelled':'failed',outcome,outcomes,info).catch(()=>{});
  }finally{stopped=true;clearInterval(heartbeat);await client.end().catch(()=>{});}
}
