import crypto from 'node:crypto';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { encryptSecret, decryptSecret } from '../configEncryptionService.js';
import { WorkspaceError, type Field, type JobRecord, type ResultManifest, type WireValue } from './types.js';
import type { WorkspaceStore } from './store.js';
import { matches, compareValues, validateFilter, validateSort } from './filters.js';

type ArtifactData = { manifest: ResultManifest; chunks: number };
const idPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function artifactPath(directory: string,id: string): string {
  if(!idPattern.test(id)) throw new WorkspaceError(400,'INVALID_ARTIFACT','Invalid result reference.');
  return path.join(path.resolve(directory),id);
}
export async function writeResult(store: WorkspaceStore,job: JobRecord,index: number,fields: Field[],rows: WireValue[][],complete: boolean,options: {directory: string; ttlMinutes: number; storageBudget: number; capReason?: string}): Promise<ResultManifest> {
  const id=crypto.randomUUID(), directory=artifactPath(options.directory,id);
  let reserved=0, chunks=0;
  try {
    await fs.mkdir(directory,{recursive:true,mode:0o700});
    for(let offset=0;offset<rows.length;offset+=200) {
      const encrypted=JSON.stringify(encryptSecret(JSON.stringify(rows.slice(offset,offset+200))));
      const bytes=Buffer.byteLength(encrypted);
      await store.reserveBytes(bytes,options.storageBudget);reserved+=bytes;
      await fs.writeFile(path.join(directory,`${chunks++}.json`),encrypted,{flag:'wx',mode:0o600});
    }
    const manifest: ResultManifest={index,fields,capturedRows:rows.length,capturedBytes:reserved,complete,capReason:options.capReason,artifactId:id,expiresAt:new Date(Date.now()+options.ttlMinutes*60000).toISOString()};
    await store.saveArtifact(id,job,index,{manifest,chunks} satisfies ArtifactData,path.resolve(options.directory),reserved,manifest.expiresAt);
    return manifest;
  }catch(error){await fs.rm(directory,{recursive:true,force:true}).catch(()=>{});if(reserved)await store.releaseBytes(reserved);throw error;}
}
export async function readResult(store: WorkspaceStore,jobId: string,index: number,actorId: number,options: {page?: number;pageSize?: number;filter?: unknown;sort?: unknown}={}) {
  const artifact=await store.artifact(jobId,index,actorId);
  const {manifest,chunks}=artifact.manifest as ArtifactData;
  const columns=new Set(manifest.fields.map(f=>f.id));
  const filter=validateFilter(options.filter,columns), sort=validateSort(options.sort,columns);
  const page=Number(options.page||0), pageSize=Number(options.pageSize||200);
  if(!Number.isSafeInteger(page)||page<0||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>500)throw new WorkspaceError(400,'INVALID_PAGE','Invalid result page.');
  // Only bounded interactive artifacts enter this view; large export streams use a separate path.
  const rows: WireValue[][]=[];
  for(let n=0;n<chunks;n++) {
    const encrypted=JSON.parse(await fs.readFile(path.join(artifactPath(artifact.directory,artifact.id),`${n}.json`),'utf8'));
    const chunk=JSON.parse(decryptSecret(encrypted)) as WireValue[][];
    for(const row of chunk)if(matches(row,manifest.fields,filter))rows.push(row);
  }
  if(sort.length)rows.sort((a,b)=>{
    for(const s of sort){const i=manifest.fields.findIndex(f=>f.id===s.column);if(a[i]===null||b[i]===null){if(a[i]===b[i])continue;return(a[i]===null?-1:1)*(s.nulls==='first'?1:-1);}const c=compareValues(a[i],b[i],manifest.fields[i]);if(c)return s.direction==='asc'?c:-c;}return 0;
  });
  return {manifest,fields:manifest.fields,rows:rows.slice(page*pageSize,(page+1)*pageSize),page,pageSize,filteredRows:rows.length,capturedRows:manifest.capturedRows,complete:manifest.complete,scope:'captured-result',collation:'case-sensitive UTF-16 code-unit order; exact decimal numeric comparison'};
}
export async function cleanupArtifacts(store: WorkspaceStore): Promise<number> {
  const c=await store.pool.connect();
  let removed=0;
  try {
    await c.query('BEGIN');
    const expired=await c.query(`SELECT a.* FROM database_workspace.artifacts a JOIN database_workspace.jobs j ON j.id=a.execution_id
      WHERE a.expires_at<now() AND j.status NOT IN ('running','cancel_requested','queued') FOR UPDATE OF a SKIP LOCKED LIMIT 100`);
    for(const a of expired.rows){
      await fs.rm(artifactPath(a.directory,a.id),{recursive:true,force:true});
      await c.query('DELETE FROM database_workspace.artifacts WHERE id=$1',[a.id]);
      await c.query('UPDATE database_workspace.storage_budget SET bytes=GREATEST(0,bytes-$1) WHERE id=1',[a.bytes]);removed++;
    }
    await c.query('COMMIT');return removed;
  }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
}
