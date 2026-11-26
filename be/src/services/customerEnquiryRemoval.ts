import {createHash} from 'node:crypto';
import type {Transaction} from 'sequelize';
import HttpError from '../errors/HttpError.js';
import WebsiteEnquiryDelivery from '../models/WebsiteEnquiryDelivery.js';
import CustomerEnquiryEvent from '../models/CustomerEnquiryEvent.js';

export const ENQUIRY_REMOVAL_KEY='STAGING_CUSTOMER_ENQUIRY_REMOVAL_ENABLED';
const reasons=['purpose_ended','approved_request'] as const;
export type RemovalInput={version:number;fingerprint:string;confirmation:string;reviewedRetention:true;understandsOtherCopies:true;reason:typeof reasons[number]};
export function validateRemovalInput(value:unknown,requestId:string):RemovalInput{
  const v=value as Partial<RemovalInput>|null;
  if(!v||typeof v!=='object'||Object.keys(v).some(k=>!['version','fingerprint','confirmation','reviewedRetention','understandsOtherCopies','reason'].includes(k))||
     typeof v.version!=='number'||!Number.isSafeInteger(v.version)||v.version<1||typeof v.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(v.fingerprint)||
     v.confirmation!==requestId||v.reviewedRetention!==true||v.understandsOtherCopies!==true||!reasons.includes(v.reason as typeof reasons[number])){
    throw new HttpError(400,'Review the exact preview, retention decision and other copies, then confirm the enquiry reference.');
  }
  return v as RemovalInput;
}

export function previewEnquiryRemoval(row:WebsiteEnquiryDelivery,events:CustomerEnquiryEvent[],enabled:boolean){
  // Includes unversioned delivery state and previous audit details: version alone is insufficient.
  const snapshot={requestId:row.requestId,formId:row.formId,sourceEnvironment:row.sourceEnvironment,version:row.version,
    status:row.status,handlingStatus:row.handlingStatus,assignedTo:row.assignedTo,staffNotes:row.staffNotes,
    enquiryData:row.enquiryData,customerName:row.customerName,customerEmail:row.customerEmail,subject:row.subject,
    payloadHash:row.payloadHash,rfcMessageId:row.rfcMessageId,providerMessageId:row.providerMessageId,
    sentAt:row.sentAt,redactedAt:row.redactedAt,redactedBy:row.redactedBy,enabled,
    events:events.map(e=>({id:e.id,kind:e.kind,actorId:e.actorId,changes:e.changes,createdAt:e.createdAt}))};
  const blockers:string[]=[];
  if(row.sourceEnvironment!=='staging')blockers.push('Only staging enquiry records are supported.');
  if(row.redactedAt)blockers.push('The enquiry contents have already been removed.');
  if(row.handlingStatus!=='closed')blockers.push('Close the enquiry after handling it before removing its contents.');
  if(row.status!=='sent')blockers.push('Resolve unconfirmed email delivery before removing its contents.');
  if(!enabled)blockers.push('Contents removal is disabled in the Control Panel. Preview is available; no removal can run.');
  const gmailUrl=row.providerMessageId&&/^[a-f0-9]{12,64}$/i.test(row.providerMessageId)?
    'https://mail.google.com/mail/u/?authuser='+encodeURIComponent(row.enquiryData?.mailbox??'pubthroughkrakow@gmail.com')+'#all/'+row.providerMessageId:null;
  return {requestId:row.requestId,version:row.version,fingerprint:createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),
    canExecute:blockers.length===0,blockers,
    removes:['Saved form fields and labels','Saved notification subject, body and addresses','Customer name, email and search subject','Internal notes and assignment','Previous activity details (actor, action and time remain)'],
    retained:['Enquiry reference and form/environment','Delivery fingerprint and message identifiers to prevent duplicate sending','Delivery/handling state and timestamps','Minimal staff/action audit and removal receipt'],
    fieldCount:row.enquiryData?Object.keys(row.enquiryData.fields).length:0,activityCount:events.length,
    otherCopies:{gmailUrl,gmail:'not_changed' as const,backups:'not_changed' as const,exports:'not_changed' as const},
    crossSystemComplete:false as const};
}

export async function removeEnquiryContents(requestId:string,input:RemovalInput,actorId:number,transaction:Transaction){
  const row=await WebsiteEnquiryDelivery.findByPk(requestId,{transaction,lock:transaction.LOCK.UPDATE});
  if(!row)throw new HttpError(404,'Enquiry not found.');
  const events=await CustomerEnquiryEvent.findAll({where:{requestId},order:[['id','ASC']],transaction,lock:transaction.LOCK.UPDATE});
  const preview=previewEnquiryRemoval(row,events,true);
  if(row.redactedAt)throw new HttpError(409,'Contents were already removed. Reload the enquiry; do not repeat the action.');
  if(!preview.canExecute)throw new HttpError(409,preview.blockers[0]);
  if(row.version!==input.version||preview.fingerprint!==input.fingerprint)throw new HttpError(409,'This enquiry changed after the preview. Reload and review a new preview before removing anything.');
  const at=new Date();
  await CustomerEnquiryEvent.update({changes:{detailsRemoved:true}},{where:{requestId},transaction});
  await row.update({enquiryData:null,customerName:null,customerEmail:null,subject:null,staffNotes:'',assignedTo:null,
    redactedAt:at,redactedBy:actorId,version:row.version+1},{transaction});
  await CustomerEnquiryEvent.create({requestId,formId:row.formId,kind:'enquiry.contents_removed',actorId,
    changes:{reason:input.reason,version:row.version,gmail:'not_changed',backups:'not_changed',exports:'not_changed',crossSystemComplete:false}},{transaction});
  return {requestId,version:row.version,redactedAt:at.toISOString(),redactedBy:actorId,
    otherCopies:{gmail:'not_changed',backups:'not_changed',exports:'not_changed'},crossSystemComplete:false};
}
