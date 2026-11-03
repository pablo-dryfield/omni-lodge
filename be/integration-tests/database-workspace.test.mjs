import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import dotenv from 'dotenv';
import { parseSql } from '../src/services/databaseWorkspace/parser.ts';
import { compareDecimal,validateFilter,compileFilter,quoteIdentifier } from '../src/services/databaseWorkspace/filters.ts';
import { WorkspaceStore,operationHash } from '../src/services/databaseWorkspace/store.ts';
import { runJob } from '../src/services/databaseWorkspace/runner.ts';
import { readResult,cleanupArtifacts } from '../src/services/databaseWorkspace/artifacts.ts';
import { createReview,verifyReview } from '../src/services/databaseWorkspace/reviews.ts';
import { buildDataChanges,buildTableView,tableCursor } from '../src/services/databaseWorkspace/dataChanges.ts';

process.env.CONFIG_ENCRYPTION_KEY=crypto.randomBytes(32).toString('hex');
const policy={maxBytes:102400,maxStatements:20,mode:'read',schemas:['public'],protectedObjects:['users']};
test('real PostgreSQL parser rejects nested writes and unsafe session/function paths',async()=>{
  for(const sql of ["WITH q AS (DELETE FROM sample RETURNING *) SELECT * FROM q",'SELECT * INTO copied FROM sample','EXPLAIN ANALYZE DELETE FROM sample','SELECT set_config(\'statement_timeout\',\'0\',false)','SELECT public.untrusted_function()','SELECT * FROM users','SET ROLE postgres','BEGIN','COPY sample TO PROGRAM \'whoami\'']){
    await assert.rejects(parseSql(sql,17,policy),undefined,sql);
  }
  assert.equal((await parseSql("select E'a\\\';b' AS value; /* nested /* comment */ end */ select $$x;y$$",17,policy)).length,2);
  assert.equal((await parseSql("SELECT 'Kraków 😀' AS value; SELECT 2",17,policy))[1].sql,'SELECT 2');
  await assert.rejects(parseSql(42,17,policy),{code:'INVALID_SQL'});
  await assert.rejects(parseSql('SELECT 1',18,policy),{code:'UNSUPPORTED_SERVER_VERSION'});
  await assert.rejects(parseSql('-- comment only',17,policy),{code:'STATEMENT_LIMIT'});
});
test('typed filters preserve decimals and parameterize hostile values',()=>{
  assert.equal(compareDecimal('9007199254740993','9007199254740992'),1);
  assert.equal(compareDecimal('-0.01','0'),-1);
  assert.equal(compareDecimal('1.200','12e-1'),0);
  const filter=validateFilter({group:'and',children:[{column:'name',operator:'contains',value:"%' OR true--"},{column:'name',operator:'notNull'}]},new Set(['name']));
  const values=[];const sql=compileFilter(filter,new Map([['name','Customer name']]),values);
  assert.equal(sql.includes('OR true'),false);assert.equal(values.length,1);assert.equal(sql.includes('$1'),true);
  assert.throws(()=>validateFilter({column:'bad',operator:'eq',value:'1'},new Set(['name'])));
});
test('review tokens bind the exact operation and actor',()=>{
  const r=createReview('hash',7,60);assert.equal(typeof verifyReview(r.token,'hash',7),'string');
  assert.throws(()=>verifyReview(r.token,'changed',7));assert.throws(()=>verifyReview(r.token,'hash',8));
  const expired=createReview('hash',7,-1);assert.throws(()=>verifyReview(expired.token,'hash',7));
});

const supplied=process.env.WORKSPACE_TEST_ADMIN_URL;
const local=fs.existsSync('.env.dev')?dotenv.parse(fs.readFileSync('.env.dev')):{};
const available=Boolean(supplied||local.DB_HOST);
const suffix=crypto.randomBytes(6).toString('hex');
const controlName=`omni_dw_test_${suffix}_control`,dataName=`omni_dw_test_${suffix}_data`;
const readName=`dw_test_${suffix}_read`,writeName=`dw_test_${suffix}_write`;
const password=crypto.randomBytes(24).toString('hex');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'omnilodge-dw-test-'));
let admin,store,target,config;
const connectConfig=supplied?{connectionString:supplied}:{host:local.DB_HOST,port:Number(local.DB_PORT||5432),database:local.DB_NAME,user:local.DB_USER,password:local.DB_PASSWORD};
before(async()=>{
  if(!available)return;
  const host=supplied?new URL(supplied).hostname:local.DB_HOST;
  assert.ok(['localhost','127.0.0.1','::1'].includes(host),'Integration fixture refuses non-loopback admin connections');
  admin=new pg.Client(connectConfig);await admin.connect();
  await admin.query(`CREATE ROLE ${quoteIdentifier(readName)} LOGIN PASSWORD '${password}'`);
  await admin.query(`CREATE ROLE ${quoteIdentifier(writeName)} LOGIN PASSWORD '${password}'`);
  await admin.query(`CREATE DATABASE ${quoteIdentifier(controlName)}`);
  await admin.query(`CREATE DATABASE ${quoteIdentifier(dataName)}`);
  const base=supplied?new URL(supplied):new URL('postgresql://localhost');
  if(!supplied){base.hostname=local.DB_HOST;base.port=local.DB_PORT||'5432';base.username=local.DB_USER;base.password=local.DB_PASSWORD;}
  base.pathname=controlName;store=new WorkspaceStore(base.toString());await store.initialize();
  const setup=new pg.Client({...connectConfig,connectionString:undefined,database:dataName,host:base.hostname,port:Number(base.port||5432),user:decodeURIComponent(base.username),password:decodeURIComponent(base.password)});
  await setup.connect();
  await setup.query(`CREATE TABLE public.sample(id integer PRIMARY KEY,amount numeric,document jsonb,note text);
    INSERT INTO public.sample VALUES(1,1.20,'null','original');
    GRANT USAGE ON SCHEMA public TO ${quoteIdentifier(readName)},${quoteIdentifier(writeName)};
    GRANT SELECT ON public.sample TO ${quoteIdentifier(readName)};
    GRANT SELECT,INSERT,UPDATE,DELETE ON public.sample TO ${quoteIdentifier(writeName)};`);
  await setup.end();
  target={id:'test',label:'Test',environment:'test',host:base.hostname,port:Number(base.port||5432),database:dataName,major:17,schemas:['public'],tls:false};
  config={queryMaxBytes:102400,batchMaxStatements:20,readTimeoutMs:5000,writeTimeoutMs:5000,lockTimeoutMs:500,jobMaxDurationMs:10000,activeJobsPerUser:1,activeJobsPerTarget:2,activeWritesPerTarget:1,queueMaxJobs:50,queueWaitMs:60000,resultPageRows:200,resultMaxRows:500,resultMaxBytes:1048576,resultTtlMinutes:60,writeMaxRows:5,reviewTokenTtlSeconds:60,artifactDirectory:root,storageBudgetBytes:16777216};
});
after(async()=>{
  await store?.close();
  if(admin){
    for(const database of [controlName,dataName]){assert.match(database,/^omni_dw_test_[a-f0-9]+_(control|data)$/);await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(database)} WITH (FORCE)`);}
    for(const role of [readName,writeName])await admin.query(`DROP ROLE IF EXISTS ${quoteIdentifier(role)}`);
    await admin.end();
  }
  assert.ok(root.startsWith(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});
});
async function enqueue(sql,mode='read',actorId=1,overrides={}){
  const statements=await parseSql(sql,17,{...policy,mode});
  const payload={actorId,target,credential:{user:mode==='read'?readName:writeName,password},statements,parameters:[],mode,reason:'integration test',limits:{...config,...overrides},policyHash:'test',protectedObjects:['users']};
  const job=await store.enqueue(payload,operationHash({sql,mode}),crypto.randomUUID());
  const claimed=await store.claim('test-worker');assert.equal(claimed.job.id,job.id);
  return {job:claimed.job,payload:claimed.payload};
}
async function run(sql,mode='read',overrides={}){const j=await enqueue(sql,mode,1,overrides);await runJob(store,j.job,j.payload,async()=>{});return store.get(j.job.id,1);}
const integration={skip:!available};
test('read jobs preserve duplicate/empty fields, bigint, exact JSON and SQL NULL',integration,async()=>{
  const job=await run(`SELECT 9007199254740993::bigint AS id,42 AS id,NULL::jsonb AS sql_null,'null'::jsonb AS json_null,'{"value":9007199254740993}'::jsonb AS document,1.20::numeric AS amount`);
  assert.equal(job.status,'succeeded',JSON.stringify(job.error));assert.equal(job.transactionOutcome,'read_only');
  const r=await readResult(store,job.id,0,1);assert.equal(r.fields[0].name,r.fields[1].name);assert.notEqual(r.fields[0].id,r.fields[1].id);
  assert.deepEqual(r.rows[0].slice(0,4),['9007199254740993','42',null,'null']);assert.ok(r.rows[0][4].includes('9007199254740993'));
  const empty=await run('SELECT id,amount FROM public.sample WHERE false');const er=await readResult(store,empty.id,0,1);assert.equal(er.fields.length,2);assert.equal(er.rows.length,0);
  await assert.rejects(readResult(store,job.id,0,2),{code:'RESULT_EXPIRED'});
});
test('capturing a large read is bounded and result filters do not rerun SQL',integration,async()=>{
  const job=await run('SELECT generate_series(1,100000) AS n');assert.equal(job.status,'succeeded',JSON.stringify(job.error));
  const r=await readResult(store,job.id,0,1,{filter:{column:'c0',operator:'gt',value:'490'}});
  assert.equal(r.capturedRows,500);assert.equal(r.complete,false);assert.equal(r.rows.length,10);assert.equal(r.rows[0][0],'491');
});
test('a failed write batch rolls back earlier statements and exposes the failed index',integration,async()=>{
  const job=await run("UPDATE sample SET note='changed' WHERE id=1; INSERT INTO sample(id) VALUES(1)",'write');
  assert.equal(job.status,'failed');assert.equal(job.transactionOutcome,'rolled_back');assert.equal(job.outcomes.length,2);assert.equal(job.outcomes[1].error.sqlState,'23505');
  const read=await run('SELECT note FROM sample WHERE id=1');assert.equal((await readResult(store,read.id,0,1)).rows[0][0],'original');
});
test('row budget and revoked authority both roll back writes',integration,async()=>{
  const job=await run('INSERT INTO sample(id) SELECT generate_series(2,20)','write');assert.equal(job.transactionOutcome,'rolled_back');assert.equal(job.error.code,'WRITE_ROW_LIMIT');
  const j=await enqueue("UPDATE sample SET note='not committed' WHERE id=1",'write');let calls=0;
  await runJob(store,j.job,j.payload,async()=>{if(++calls===2)throw new Error('revoked');});
  assert.equal((await store.get(j.job.id,1)).transactionOutcome,'rolled_back');
});
test('idempotency conflicts, single-use reviews and ownership are enforced',integration,async()=>{
  const statements=await parseSql('SELECT 1',17,policy);
  const payload={actorId:4,target,credential:{user:readName,password},statements,parameters:[],mode:'read',reason:'test',limits:config,policyHash:'test',protectedObjects:[]};
  const key=crypto.randomUUID(),nonce=crypto.randomUUID();const first=await store.enqueue(payload,'same',key,nonce);
  assert.equal((await store.enqueue(payload,'same',key,nonce)).id,first.id);
  await assert.rejects(store.enqueue(payload,'different',key),{code:'IDEMPOTENCY_CONFLICT'});
  await assert.rejects(store.enqueue(payload,'same',crypto.randomUUID(),nonce),{code:'REVIEW_ALREADY_USED'});
  await assert.rejects(store.get(first.id,99),{code:'EXECUTION_NOT_FOUND'});
  await store.cancel(first.id,4);
});
test('running query cancellation uses its exact database session and confirms rollback',integration,async()=>{
  const j=await enqueue('SELECT count(*) FROM generate_series(1,100000000)');
  const running=runJob(store,j.job,j.payload,async()=>{});
  for(let n=0;n<30;n++){const q=await store.pool.query('SELECT backend_pid FROM database_workspace.jobs WHERE id=$1',[j.job.id]);if(q.rows[0].backend_pid)break;await new Promise(r=>setTimeout(r,20));}
  await store.cancel(j.job.id,1);await running;
  const result=await store.get(j.job.id,1);assert.equal(result.status,'cancelled',JSON.stringify(result.error));assert.equal(result.transactionOutcome,'rolled_back');
});
test('expired results release their reserved storage',integration,async()=>{
  const job=await run('SELECT 1');await store.pool.query("UPDATE database_workspace.artifacts SET expires_at=now()-interval '1 second' WHERE execution_id=$1",[job.id]);
  assert.ok(await cleanupArtifacts(store)>0);await assert.rejects(readResult(store,job.id,0,1),{code:'RESULT_EXPIRED'});
});
test('structured editing rejects stale rows and commits only the reviewed exact row',integration,async()=>{
  const oid=(await run('SELECT oid::text FROM pg_class WHERE relname=\'sample\''));
  const objectId=(await readResult(store,oid.id,0,1)).rows[0][0];
  const original={id:'1',amount:'1.20',document:'null',note:'original'};
  const plan=await buildDataChanges(target,{user:writeName,password},[],config,{objectId,changes:[{kind:'update',original,values:{note:'edited'}}]});
  const payload={actorId:1,target,credential:{user:writeName,password},statements:plan.statements,parameters:[],mode:'write',reason:'structured test',limits:config,policyHash:'test',protectedObjects:[],schemaChecks:plan.schemaChecks};
  const created=await store.enqueue(payload,operationHash(plan));const claimed=await store.claim('test-worker');assert.equal(created.id,claimed.job.id);
  await runJob(store,claimed.job,payload,async()=>{});assert.equal((await store.get(created.id,1)).transactionOutcome,'committed');
  const stale=await store.enqueue(payload,operationHash(plan));const staleClaim=await store.claim('test-worker');assert.equal(stale.id,staleClaim.job.id);
  await runJob(store,staleClaim.job,payload,async()=>{});const result=await store.get(stale.id,1);assert.equal(result.transactionOutcome,'rolled_back');assert.equal(result.error.code,'ROW_CONFLICT');
});
test('table browsing uses a signed keyset cursor with a primary-key tie breaker',integration,async()=>{
  const inserted=await run('INSERT INTO sample(id,note) SELECT generate_series(2,6),\'same\'','write');assert.equal(inserted.transactionOutcome,'committed');
  const oid=await run('SELECT oid::text FROM pg_class WHERE relname=\'sample\'');const objectId=(await readResult(store,oid.id,0,1)).rows[0][0];
  const first=await buildTableView(target,{user:readName,password},[],config,{objectId,pageSize:2});
  async function page(view){const payload={actorId:1,target,credential:{user:readName,password},statements:view.statements,parameters:[],mode:'read',reason:'table page',limits:config,policyHash:'test',protectedObjects:[]};const created=await store.enqueue(payload,operationHash(view));const claimed=await store.claim('test-worker');await runJob(store,claimed.job,payload,async()=>{});return readResult(store,created.id,0,1);}
  const r=await page(first);assert.deepEqual(r.rows.map(row=>row[0]),['1','2','3']);
  const cursor=tableCursor(first.fingerprint,first.sort,r.fields.map(f=>f.name),r.rows[1]);
  const next=await buildTableView(target,{user:readName,password},[],config,{objectId,pageSize:2,cursor});
  assert.deepEqual((await page(next)).rows.map(row=>row[0]),['3','4','5']);
  await assert.rejects(buildTableView(target,{user:readName,password},[],config,{objectId,pageSize:2,cursor,filter:{column:'id',operator:'gt',value:'3'}}),{code:'CURSOR_EXPIRED'});
});
