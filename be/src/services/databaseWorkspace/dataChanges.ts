import { relationDetails } from './catalog.js';
import { quoteIdentifier,compileFilter,validateFilter,validateSort,type Filter,type Sort } from './filters.js';
import { parseSql } from './parser.js';
import { WorkspaceError,type Credential,type Limits,type Statement,type Target,type WireValue } from './types.js';
import { encryptSecret,decryptSecret } from '../configEncryptionService.js';
import { operationHash } from './store.js';
import { targetClient,assertRestrictedIdentity } from './connection.js';
import { schemaFingerprint } from './schemaFingerprint.js';

type Details=Awaited<ReturnType<typeof relationDetails>>;
type Column={name:string;type:string;pg_type:string;oid:number;not_null:boolean;identity:string;generated:string;primary_key:boolean};
const columnsOf=(d:Details)=>d.columns as unknown as Column[];
export async function buildTableView(target:Target,credential:Credential,protectedObjects:string[],limits:Limits,request:Record<string,unknown>) {
  const details=await relationDetails(target,credential,String(request.objectId||''),protectedObjects),columns=columnsOf(details);
  const mapping=new Map(columns.map(c=>[c.name,c.name]));
  const filter=validateFilter(request.filter,new Set(mapping.keys())),sort=validateSort(request.sort,new Set(mapping.keys()));
  const pageSize=Number(request.pageSize||limits.resultPageRows);
  if(!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>Math.min(500,limits.resultMaxRows-1))throw new WorkspaceError(400,'INVALID_PAGE','The table page exceeds the configured capture budget.');
  const selected=request.columns==null?columns.map(c=>c.name):request.columns;
  if(!Array.isArray(selected)||!selected.length||selected.some(v=>typeof v!=='string'||!mapping.has(v)))throw new WorkspaceError(400,'INVALID_COLUMNS','Choose valid table columns.');
  const primary=columns.filter(c=>c.primary_key).map(c=>c.name);
  for(const key of primary)if(!sort.some(s=>s.column===key))sort.push({column:key,direction:'asc',nulls:'last'});
  if(!sort.length)sort.push({column:columns[0].name,direction:'asc',nulls:'last'});
  // A keyset cursor is meaningful only with an actual unique primary key.
  const stable=primary.length>0;
  const fingerprint=operationHash({target:target.id,oid:details.id,selected,filter,sort});
  const values:WireValue[]=[];
  let where=compileFilter(filter,mapping,values);
  if(request.cursor){
    let cursor:{fingerprint:string;keys:WireValue[];expiresAt:number};
    try{cursor=JSON.parse(decryptSecret(JSON.parse(Buffer.from(String(request.cursor),'base64url').toString('utf8'))));}catch{throw new WorkspaceError(400,'INVALID_CURSOR','The table cursor is invalid.');}
    if(!stable||cursor.fingerprint!==fingerprint||cursor.expiresAt<Date.now()||cursor.keys.length!==sort.length)throw new WorkspaceError(409,'CURSOR_EXPIRED','The table view changed or its cursor expired. Start from the first page.');
    const branches=sort.map((s,i)=>{
      const parts:string[]=[];
      for(let previous=0;previous<i;previous++){values.push(cursor.keys[previous]);parts.push(`${quoteIdentifier(sort[previous].column)} IS NOT DISTINCT FROM $${values.length}`);}
      const key=cursor.keys[i],name=quoteIdentifier(s.column);
      if(key===null)parts.push(s.nulls==='first'?`${name} IS NOT NULL`:'FALSE');
      else{values.push(key);const comparison=`${name} ${s.direction==='asc'?'>':'<'} $${values.length}`;parts.push(s.nulls==='last'?`(${comparison} OR ${name} IS NULL)`:comparison);}
      return `(${parts.join(' AND ')})`;
    });where=`(${where}) AND (${branches.join(' OR ')})`;
  }
  const output=[...new Set([...selected as string[],...sort.map(s=>s.column)])];
  const order=sort.map(s=>`${quoteIdentifier(s.column)} ${s.direction.toUpperCase()} NULLS ${s.nulls.toUpperCase()}`).join(', ');
  if(values.length>1000)throw new WorkspaceError(400,'FILTER_TOO_COMPLEX','This filter has too many bound values.');
  const text=`SELECT ${output.map(quoteIdentifier).join(', ')} FROM ${details.qualifiedName} WHERE ${where} ORDER BY ${order} LIMIT ${pageSize+1}`;
  const statements=await parseSql(text,target.major,{maxBytes:limits.queryMaxBytes,maxStatements:1,mode:'read',schemas:target.schemas,protectedObjects});
  statements[0].parameters=values;
  return {details,statements,fingerprint,sort,selected,output,pageSize,stable};
}
export function tableCursor(fingerprint:string,sort:Sort[],fields:string[],lastRow:WireValue[]):string {
  return Buffer.from(JSON.stringify(encryptSecret(JSON.stringify({fingerprint,keys:sort.map(s=>lastRow[fields.indexOf(s.column)]),expiresAt:Date.now()+600000})))).toString('base64url');
}

export async function buildDataChanges(target:Target,credential:Credential,protectedObjects:string[],limits:Limits,request:Record<string,unknown>) {
  const details=await relationDetails(target,credential,String(request.objectId||''),protectedObjects),columns=columnsOf(details);
  if(!['r','p'].includes(String(details.kind)))throw new WorkspaceError(409,'TABLE_READ_ONLY','Only base tables with stable keys can be edited.');
  const primary=columns.filter(c=>c.primary_key);
  if(!primary.length)throw new WorkspaceError(409,'ROW_IDENTITY_REQUIRED','This table has no primary key and is read-only in the data editor.');
  const changes=request.changes;
  if(!Array.isArray(changes)||!changes.length||changes.length>Math.min(limits.batchMaxStatements,limits.writeMaxRows))throw new WorkspaceError(400,'CHANGE_LIMIT','Use a bounded set of row changes.');
  const statements:Statement[]=[];const summary:unknown[]=[];
  for(const item of changes){
    if(!item||!['insert','update','delete'].includes(item.kind))throw new WorkspaceError(400,'INVALID_CHANGE','Unknown row change.');
    const values:WireValue[]=[];const bind=(value:unknown)=>{if(value!==null&&typeof value!=='string')throw new WorkspaceError(400,'INVALID_VALUE','Row values must be exact PostgreSQL text or SQL NULL.');values.push(value as WireValue);return `$${values.length}`;};
    const proposed=item.values||{},original=item.original||{};
    if(typeof proposed!=='object'||Array.isArray(proposed)||typeof original!=='object'||Array.isArray(original))throw new WorkspaceError(400,'INVALID_CHANGE','Invalid original or proposed row.');
    const names=Object.keys(proposed);
    for(const name of names){const col=columns.find(c=>c.name===name);if(!col||col.generated||col.identity)throw new WorkspaceError(400,'COLUMN_READ_ONLY',`Column ${name} is generated or unavailable for editing.`);}
    let sql='';
    if(item.kind==='insert')sql=names.length?`INSERT INTO ${details.qualifiedName} (${names.map(quoteIdentifier).join(',')}) VALUES (${names.map(name=>bind(proposed[name])).join(',')}) RETURNING *`:`INSERT INTO ${details.qualifiedName} DEFAULT VALUES RETURNING *`;
    else{
      if(primary.some(c=>original[c.name]===undefined||original[c.name]===null)||columns.some(c=>original[c.name]===undefined))throw new WorkspaceError(400,'ORIGINAL_ROW_REQUIRED','Reload the complete original row before editing it.');
      const assignments=item.kind==='update'?names.map(name=>`${quoteIdentifier(name)}=${bind(proposed[name])}`).join(','):'';
      if(item.kind==='update'&&!names.length)throw new WorkspaceError(400,'NO_CHANGES','Change at least one field before saving.');
      const where=columns.map(c=>`${quoteIdentifier(c.name)}::text IS NOT DISTINCT FROM ${bind(original[c.name])}::text`).join(' AND ');
      sql=item.kind==='delete'?`DELETE FROM ${details.qualifiedName} WHERE ${where} RETURNING *`:`UPDATE ${details.qualifiedName} SET ${assignments} WHERE ${where} RETURNING *`;
    }
    const [statement]=await parseSql(sql,target.major,{maxBytes:limits.queryMaxBytes,maxStatements:1,mode:'write',schemas:target.schemas,protectedObjects});
    statement.parameters=values;statement.expectedAffected=1;statements.push(statement);summary.push({kind:item.kind,table:details.qualifiedName,original:item.kind==='insert'?undefined:original,proposed});
  }
  const client=targetClient(target,credential,'omnilodge-workspace-change-review');
  let fingerprint:string;
  try{await client.connect();await assertRestrictedIdentity(client,target);fingerprint=await schemaFingerprint(client,details.id);}finally{await client.end().catch(()=>{});}
  return {statements,summary,schemaChecks:[{oid:details.id,qualifiedName:details.qualifiedName,fingerprint}]};
}
