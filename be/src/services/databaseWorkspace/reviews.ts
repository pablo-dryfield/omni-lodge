import crypto from 'node:crypto';
import { encryptSecret, decryptSecret } from '../configEncryptionService.js';
import { operationHash } from './store.js';
import { WorkspaceError, type ExecutionInput } from './types.js';

export const executionHash=(input:Pick<ExecutionInput,'targetId'|'sql'|'parameters'|'mode'|'reason'>,actorId:number,policyHash:string)=>operationHash({actorId,targetId:input.targetId,sql:input.sql,parameters:input.parameters,mode:input.mode,reason:input.reason||'',policyHash});
export function createReview(hash:string,actorId:number,ttlSeconds:number): {token:string;expiresAt:string;nonce:string} {
  const nonce=crypto.randomUUID(), expiresAt=new Date(Date.now()+ttlSeconds*1000).toISOString();
  return {token:Buffer.from(JSON.stringify(encryptSecret(JSON.stringify({hash,actorId,expiresAt,nonce})))).toString('base64url'),expiresAt,nonce};
}
export function verifyReview(token:unknown,hash:string,actorId:number): string {
  try {
    if(typeof token!=='string'||token.length>8192)throw new Error();
    const data=JSON.parse(decryptSecret(JSON.parse(Buffer.from(token,'base64url').toString('utf8'))));
    if(data.hash!==hash||data.actorId!==actorId||Date.parse(data.expiresAt)<=Date.now()||typeof data.nonce!=='string')throw new Error();
    return data.nonce;
  }catch{throw new WorkspaceError(409,'REVIEW_REQUIRED','Review this exact operation again. Its approval is invalid or has expired.');}
}
