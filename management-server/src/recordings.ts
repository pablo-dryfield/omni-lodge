import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {Store} from './store.js';
import {Readable,type Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {requireValue,limit,type Context} from './types.js';

export class RecordingBuffer {
  private chunks:Buffer[]=[]; private buffered=0; private total=0; private written=0; private scheduledBytes=0; private pending=0; private failed=false;
  private queue:Promise<unknown>=Promise.resolve(); private timer:NodeJS.Timeout;
  truncated=false; private closed=false;
  constructor(readonly id:string,readonly actorId:number,readonly hostId:string,readonly terminalId:string,private maxBytes:number,private filename:string,private key:Buffer,private store:Store,private notify:(message:string)=>void){
    this.timer=setInterval(()=>this.flush(),2000);this.timer.unref();
  }
  append(bytes:Buffer){
    if(this.truncated||this.closed)return;
    const available=this.maxBytes-this.total;
    if(available<bytes.length){if(available>0)this.append(bytes.subarray(0,available));this.truncated=true;this.notify('Terminal recording reached its limit; the terminal remains active.');this.flush();return;}
    if(this.pending>1048576){this.truncated=true;this.notify('Terminal recording stopped because storage could not keep up.');this.flush();return;}
    this.chunks.push(Buffer.from(bytes));this.buffered+=bytes.length;this.total+=bytes.length;if(this.buffered>=524288)this.flush();
  }
  private flush(){
    if(!this.buffered)return;let bytes=Buffer.concat(this.chunks,this.buffered);this.chunks=[];this.buffered=0;const available=this.maxBytes-this.scheduledBytes-32;if(available<bytes.length){bytes=bytes.subarray(0,Math.max(0,available));this.truncated=true;this.notify('Terminal recording reached its encrypted storage limit.');}if(!bytes.length)return;this.scheduledBytes+=bytes.length+32;this.pending+=bytes.length;
    this.queue=this.queue.then(async()=>{
      if(this.failed)return;
      const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',this.key,iv),encrypted=Buffer.concat([cipher.update(bytes),cipher.final()]),size=Buffer.alloc(4);size.writeUInt32BE(encrypted.length);
      const frame=Buffer.concat([size,iv,cipher.getAuthTag(),encrypted]);const handle=await fs.open(this.filename,'a');try{await handle.writeFile(frame);await handle.sync();}finally{await handle.close();}
      const committed=this.written+frame.length;await this.store.pool.query('UPDATE system_management.artifacts SET bytes=$2 WHERE id=$1',[this.id,committed]);this.written=committed;
    }).catch(()=>{this.failed=true;if(!this.truncated)this.notify('Terminal recording stopped after a storage failure.');this.truncated=true;}).finally(()=>{this.pending-=bytes.length;});
  }
  async finish(){if(this.closed)return;this.closed=true;clearInterval(this.timer);this.flush();await this.queue;await this.store.pool.query('UPDATE system_management.artifacts SET kind=$2,reserved_bytes=0 WHERE id=$1',[this.id,this.truncated?'recording-truncated':'recording']);await this.store.event(this.actorId,this.hostId,'recording.saved',this.truncated?'truncated':'completed',this.terminalId);}
}
export class Recordings {
  constructor(private store:Store,private directory:string,private key:Buffer){}
  async create(ctx:Context,hostId:string,terminalId:string,notify:(message:string)=>void){
    if(!(ctx.limits.SYSTEM_MANAGEMENT_RECORDING as {enabled?:boolean}|undefined)?.enabled)return undefined;
    const maximum=limit(ctx,'RECORDING','sessionBytes',10485760),id=crypto.randomUUID(),filename=path.join(this.directory,id+'.recording');
    requireValue(maximum>=8192,400,'RECORDING_LIMIT','Recording sessions require at least 8 KiB of storage.');
    await fs.mkdir(this.directory,{recursive:true,mode:0o700});const client=await this.store.pool.connect();
    try{await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtext('system-management.recording-quota'))");
      const used=Number((await client.query('SELECT COALESCE(sum(GREATEST(bytes,reserved_bytes)),0)::text AS bytes FROM system_management.artifacts')).rows[0].bytes);
      requireValue(used+maximum<=limit(ctx,'RECORDING','totalBytes',67108864),507,'RECORDING_QUOTA','Recording storage is full. Free expired recordings before starting a recorded terminal.');
      const disk=await fs.statfs(this.directory);requireValue(Number(disk.bavail)*Number(disk.bsize)-maximum>=limit(ctx,'STORAGE_POLICY','reserveBytes',1073741824),507,'RECORDING_QUOTA','Recording disk reserve reached.');
      await fs.writeFile(filename,Buffer.alloc(0),{flag:'wx',mode:0o600});
      await client.query(`INSERT INTO system_management.artifacts(id,actor_id,host_id,kind,operation_id,path,bytes,reserved_bytes,expires_at) VALUES($1,$2,$3,'recording-active',$4,$5,0,$6,now()+($7 * interval '1 day'))`,[id,ctx.actorId,hostId,terminalId,id+'.recording',maximum,limit(ctx,'RETENTION','recordingDays',7)]);await client.query('COMMIT');
      return new RecordingBuffer(id,ctx.actorId,hostId,terminalId,maximum,filename,this.key,this.store,notify);
    }catch(error){await client.query('ROLLBACK');await fs.unlink(filename).catch(()=>{});throw error;}finally{client.release();}
  }
  async list(actorId:number){return (await this.store.pool.query('SELECT id,host_id,operation_id,kind,bytes::text,created_at,expires_at FROM system_management.artifacts WHERE actor_id=$1 AND expires_at>now() ORDER BY created_at DESC LIMIT 100',[actorId])).rows;}
  async metadata(actorId:number,id:string){
    const row=(await this.store.pool.query('SELECT * FROM system_management.artifacts WHERE id=$1 AND actor_id=$2 AND expires_at>now()',[id,actorId])).rows[0];
    requireValue(row&&String(row.kind).startsWith('recording')&&row.path===id+'.recording'&&Number(row.bytes)<=104857600,404,'NOT_FOUND','Recording is not available.');
    const filename=path.join(this.directory,row.path),info=await fs.lstat(filename);requireValue(info.isFile()&&!info.isSymbolicLink()&&info.nlink===1&&info.size>=Number(row.bytes),503,'ARTIFACT_INVALID','Recording identity or committed size changed.');
    return {...row,filename};
  }
  private async *frames(row:Record<string,any>){
    const handle=await fs.open(row.filename,'r');let offset=0;
    const exact=async(bytes:number)=>{const out=Buffer.alloc(bytes);let read=0;while(read<bytes){const result=await handle.read(out,read,bytes-read,offset+read);requireValue(result.bytesRead>0,503,'ARTIFACT_INVALID','Recording ended within a committed frame.');read+=result.bytesRead;}offset+=bytes;return out;};
    try{while(offset<Number(row.bytes)){const length=(await exact(4)).readUInt32BE(0);requireValue(length<=1048576&&offset+28+length<=Number(row.bytes),503,'ARTIFACT_INVALID','Invalid recording frame size.');const iv=await exact(12),tag=await exact(16),encrypted=await exact(length),decipher=crypto.createDecipheriv('aes-256-gcm',this.key,iv);decipher.setAuthTag(tag);yield Buffer.concat([decipher.update(encrypted),decipher.final()]);}}finally{await handle.close();}
  }
  async read(actorId:number,id:string){const row=await this.metadata(actorId,id),parts:Buffer[]=[];let bytes=0,previewTruncated=false;for await(const chunk of this.frames(row)){const available=262144-bytes;parts.push(chunk.subarray(0,available));bytes+=Math.min(available,chunk.length);if(chunk.length>available||bytes>=262144){previewTruncated=true;break;}}return {hostId:String(row.host_id),text:new TextDecoder('utf-8').decode(Buffer.concat(parts)),truncated:row.kind!=='recording',previewTruncated};}
  async download(actorId:number,id:string,destination:Writable){const row=await this.metadata(actorId,id);await pipeline(Readable.from(this.frames(row)),destination);}
  async recover(){await this.store.pool.query("UPDATE system_management.artifacts SET kind='recording-truncated',reserved_bytes=0 WHERE kind='recording-active'");}
  async cleanup(){const rows=(await this.store.pool.query("SELECT id,path FROM system_management.artifacts WHERE expires_at<now() AND kind<>'recording-active' LIMIT 100")).rows;for(const row of rows){if(!/^[0-9a-f-]{36}\.recording$/.test(row.path)||row.path!==row.id+'.recording')continue;await fs.unlink(path.join(this.directory,row.path)).catch(error=>{if(error.code!=='ENOENT')throw error;});await this.store.pool.query('DELETE FROM system_management.artifacts WHERE id=$1 AND expires_at<now()',[row.id]);}}
}
