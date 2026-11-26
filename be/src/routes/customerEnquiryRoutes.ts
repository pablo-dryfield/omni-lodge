import {Router,type NextFunction,type Response} from 'express';
import {Op,UniqueConstraintError,type WhereOptions} from 'sequelize';
import authMiddleware from '../middleware/authMiddleware.js';
import {hasModuleActionPermission} from '../middleware/authorizationMiddleware.js';
import {getAllowedProductTypeIds} from '../services/productScopeService.js';
import type {AuthenticatedRequest} from '../types/AuthenticatedRequest.js';
import HttpError from '../errors/HttpError.js';
import sequelize from '../config/database.js';
import WebsiteEnquiryDelivery from '../models/WebsiteEnquiryDelivery.js';
import CustomerEnquiryTemplate from '../models/CustomerEnquiryTemplate.js';
import CustomerEnquiryEvent from '../models/CustomerEnquiryEvent.js';
import RolePagePermission from '../models/RolePagePermission.js';
import Page from '../models/Page.js';
import User from '../models/User.js';
import {ENQUIRY_FORMS} from '../services/websiteEnquiryContract.js';
import {enquiryFormById,enquirySamplePayload,enquiryTemplateDefaults,renderEnquiryTemplate,validateEnquiryTemplate} from '../services/customerEnquiryTemplates.js';
import {getConfigValue,refreshConfigCacheKeys} from '../services/configService.js';
import {ENQUIRY_REMOVAL_KEY,previewEnquiryRemoval,removeEnquiryContents,validateRemovalInput} from '../services/customerEnquiryRemoval.js';

const router=Router();
const statuses=['new','in_progress','replied','closed'];
type Handler=(req:AuthenticatedRequest,res:Response)=>Promise<unknown>;
const route=(handler:Handler)=>(req:AuthenticatedRequest,res:Response,next:NextFunction)=>{void handler(req,res).catch(next);};
export async function assertEnquiryPermission(req:AuthenticatedRequest,module:string,action:string){
  if(!req.authContext?.id||!req.authContext.userTypeId||await getAllowedProductTypeIds(req)!==null)throw new HttpError(403,'Customer enquiries require company-wide access.');
  const page=await Page.findOne({where:{slug:'customer-enquiries',status:true},attributes:['id']});
  if(!page||!await RolePagePermission.findOne({where:{pageId:page.id,userTypeId:req.authContext.userTypeId,canView:true,status:true}})||!await hasModuleActionPermission(req,module,action))throw new HttpError(403,'You do not have permission to use customer enquiries.');
}
const requirePermission=(module:string,action:string)=>(req:AuthenticatedRequest,res:Response,next:NextFunction)=>{void assertEnquiryPermission(req,module,action).then(()=>next(),next);};
const integer=(value:unknown,fallback:number,max:number)=>{const n=value===undefined?fallback:Number(value);if(!Number.isSafeInteger(n)||n<0||n>max)throw new HttpError(400,'Invalid pagination.');return n;};
const id=(value:string)=>{if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value))throw new HttpError(400,'Invalid enquiry reference.');return value;};
const summary=(r:WebsiteEnquiryDelivery)=>({requestId:r.requestId,formId:r.formId,sourceEnvironment:r.sourceEnvironment,customerName:r.customerName,customerEmail:r.customerEmail,subject:r.subject,deliveryStatus:r.status,handlingStatus:r.handlingStatus,assignedTo:r.assignedTo,version:r.version,createdAt:r.createdAt,sentAt:r.sentAt,redactedAt:r.redactedAt??null});
router.use(authMiddleware,(_req,res,next)=>{res.setHeader('Cache-Control','private, no-store');next();});
router.get('/templates',requirePermission('customer-enquiry-templates','view'),route(async(_req,res)=>{
  const saved=await CustomerEnquiryTemplate.findAll();
  res.json({templates:ENQUIRY_FORMS.map(form=>{const t=saved.find(s=>s.formId===form.id);return {formId:form.id,title:form.title,fields:form.fields.map(f=>({id:f.id,label:f.label})),...enquiryTemplateDefaults(form),...(t?{subjectTemplate:t.subjectTemplate,bodyTemplate:t.bodyTemplate,layout:t.layout}:{}),version:t?.version??0,updatedAt:t?.updatedAt??null};})});
}));
router.post('/templates/:formId/preview',requirePermission('customer-enquiry-templates','view'),route(async(req,res)=>{
  const form=enquiryFormById(req.params.formId),draft=validateEnquiryTemplate(req.body,form);
  res.json({preview:renderEnquiryTemplate(enquirySamplePayload(form),form,draft),sample:true,sent:false});
}));
router.put('/templates/:formId',requirePermission('customer-enquiry-templates','update'),route(async(req,res)=>{
  const form=enquiryFormById(req.params.formId),draft=validateEnquiryTemplate(req.body,form),expected=req.body.version;
  if(!Number.isSafeInteger(expected)||expected<0||Object.keys(req.body).some(k=>!['subjectTemplate','bodyTemplate','layout','version'].includes(k)))throw new HttpError(400,'Invalid template update.');
  try{
    const saved=await sequelize.transaction(async transaction=>{
      const current=await CustomerEnquiryTemplate.findByPk(form.id,{transaction,lock:transaction.LOCK.UPDATE});
      if((current?.version??0)!==expected)throw new HttpError(409,'This template changed in another session. Reload before saving; your draft has been kept.');
      const previous=current?{subjectTemplate:current.subjectTemplate,bodyTemplate:current.bodyTemplate,layout:current.layout}:enquiryTemplateDefaults(form);
      const values={...draft,version:expected+1,updatedBy:req.authContext!.id};
      const row=current?await current.update(values,{transaction}):await CustomerEnquiryTemplate.create({formId:form.id,...values},{transaction});
      await CustomerEnquiryEvent.create({requestId:null,formId:form.id,kind:'template.updated',actorId:req.authContext!.id,changes:{before:previous,after:draft,version:row.version}},{transaction});
      return row;
    });res.json({version:saved.version,updatedAt:saved.updatedAt});
  }catch(error){if(error instanceof UniqueConstraintError)throw new HttpError(409,'This template changed in another session. Reload before saving; your draft has been kept.');throw error;}
}));
router.get('/',requirePermission('customer-enquiries-inbox','view'),route(async(req,res)=>{
  if(Object.keys(req.query).some(k=>!['q','formId','handlingStatus','deliveryStatus','includeLegacy','limit','offset'].includes(k)))throw new HttpError(400,'Unknown enquiry filter.');
  if(req.query.includeLegacy!==undefined&&!['0','1'].includes(String(req.query.includeLegacy)))throw new HttpError(400,'Invalid delivery history filter.');
  const where:WhereOptions=req.query.includeLegacy==='1'?{}:{enquiryData:{[Op.ne]:null}};
  for(const [key,allowed]of [['formId',ENQUIRY_FORMS.map(f=>f.id)],['handlingStatus',statuses],['deliveryStatus',['sending','sent','uncertain']]]as const){
    const value=req.query[key];if(value===undefined||value==='')continue;
    if(typeof value!=='string'||!(allowed as readonly string[]).includes(value))throw new HttpError(400,'Invalid enquiry filter.');
    Object.assign(where,{[key==='deliveryStatus'?'status':key]:value});
  }
  if(req.query.q!==undefined){if(typeof req.query.q!=='string'||req.query.q.length>200)throw new HttpError(400,'Search is limited to200 characters.');const q=req.query.q.trim();if(q)Object.assign(where,{[Op.or]:['customerName','customerEmail','subject'].map(key=>({[key]:{[Op.iLike]:'%'+q.replace(/[\\%_]/g,'\\$&')+'%'}}))});}
  const limit=integer(req.query.limit,25,100);if(limit===0)throw new HttpError(400,'Page size must be positive.');const offset=integer(req.query.offset,0,1000000);
  const found=await WebsiteEnquiryDelivery.findAndCountAll({where,attributes:{exclude:['enquiryData','staffNotes','payloadHash','rfcMessageId','providerMessageId']},order:[['createdAt','DESC'],['requestId','DESC']],limit,offset});
  const users=await User.findAll({where:{status:true},attributes:['id','firstName','lastName'],order:[['firstName','ASC'],['id','ASC']]});
  res.json({rows:found.rows.map(summary),count:found.count,limit,offset,forms:ENQUIRY_FORMS.map(f=>({id:f.id,title:f.title})),assignees:users.map(u=>({id:u.id,name:[u.firstName,u.lastName].filter(Boolean).join(' ')||`User ${u.id}`}))});
}));
router.get('/:requestId',requirePermission('customer-enquiries-inbox','view'),route(async(req,res)=>{
  const row=await WebsiteEnquiryDelivery.findByPk(id(req.params.requestId));if(!row)throw new HttpError(404,'Enquiry not found.');
  const events=await CustomerEnquiryEvent.findAll({where:{requestId:row.requestId},order:[['id','DESC']],limit:50});
  const gmailUrl=row.providerMessageId&&/^[a-f0-9]{12,64}$/i.test(row.providerMessageId)?'https://mail.google.com/mail/u/?authuser='+encodeURIComponent(row.enquiryData?.mailbox??'pubthroughkrakow@gmail.com')+'#all/'+row.providerMessageId:null;
  res.json({...summary(row),enquiryData:row.enquiryData,staffNotes:row.staffNotes,rfcMessageId:row.rfcMessageId,providerMessageId:row.providerMessageId,gmailUrl,events:events.map(e=>({id:e.id,kind:e.kind,actorId:e.actorId,changes:e.changes,createdAt:e.createdAt}))});
}));
router.get('/:requestId/removal-preview',requirePermission('customer-enquiries-inbox','view'),requirePermission('customer-enquiries-inbox','delete'),route(async(req,res)=>{
  const requestId=id(req.params.requestId);
  await refreshConfigCacheKeys([ENQUIRY_REMOVAL_KEY]);
  // Read a consistent preview under the same row lock used by follow-up/removal.
  const preview=await sequelize.transaction(async transaction=>{
    const row=await WebsiteEnquiryDelivery.findByPk(requestId,{transaction,lock:transaction.LOCK.UPDATE});
    if(!row)throw new HttpError(404,'Enquiry not found.');
    const events=await CustomerEnquiryEvent.findAll({where:{requestId},order:[['id','ASC']],transaction,lock:transaction.LOCK.UPDATE});
    return previewEnquiryRemoval(row,events,getConfigValue(ENQUIRY_REMOVAL_KEY)===true);
  });
  res.json(preview);
}));
router.post('/:requestId/remove-contents',requirePermission('customer-enquiries-inbox','view'),requirePermission('customer-enquiries-inbox','delete'),route(async(req,res)=>{
  const requestId=id(req.params.requestId),input=validateRemovalInput(req.body,requestId);
  await refreshConfigCacheKeys([ENQUIRY_REMOVAL_KEY]);
  if(getConfigValue(ENQUIRY_REMOVAL_KEY)!==true)throw new HttpError(423,'Contents removal is disabled. No record was changed.');
  const receipt=await sequelize.transaction(transaction=>removeEnquiryContents(requestId,input,req.authContext!.id,transaction));
  res.json(receipt);
}));
router.patch('/:requestId',requirePermission('customer-enquiries-inbox','update'),route(async(req,res)=>{
  const requestId=id(req.params.requestId),v=req.body;
  if(!v||typeof v!=='object'||Object.keys(v).some(k=>!['version','handlingStatus','assignedTo','staffNotes'].includes(k))||!Number.isSafeInteger(v.version)||v.version<1||!statuses.includes(v.handlingStatus)||typeof v.staffNotes!=='string'||Buffer.byteLength(v.staffNotes)>20000||(v.assignedTo!==null&&(!Number.isSafeInteger(v.assignedTo)||v.assignedTo<1)))throw new HttpError(400,'Choose a status, an optional assignee and notes up to20000 bytes.');
  const row=await sequelize.transaction(async transaction=>{
    const r=await WebsiteEnquiryDelivery.findByPk(requestId,{transaction,lock:transaction.LOCK.UPDATE});if(!r)throw new HttpError(404,'Enquiry not found.');
    if(r.redactedAt)throw new HttpError(409,'Removed enquiry contents cannot be edited or restored through follow-up.');
    if(r.version!==v.version)throw new HttpError(409,'This enquiry changed in another session. Reload before saving; your draft has been kept.');
    if(v.assignedTo!==null&&!await User.findOne({where:{id:v.assignedTo,status:true},attributes:['id'],transaction}))throw new HttpError(400,'Choose an active team member.');
    await CustomerEnquiryEvent.create({requestId,formId:r.formId,kind:'enquiry.updated',actorId:req.authContext!.id,changes:{before:{handlingStatus:r.handlingStatus,assignedTo:r.assignedTo},after:{handlingStatus:v.handlingStatus,assignedTo:v.assignedTo},notesChanged:r.staffNotes!==v.staffNotes,version:r.version+1}},{transaction});
    return r.update({handlingStatus:v.handlingStatus,assignedTo:v.assignedTo,staffNotes:v.staffNotes,version:r.version+1},{transaction});
  });res.json(summary(row));
}));
export default router;
