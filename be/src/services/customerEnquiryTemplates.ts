import HttpError from '../errors/HttpError.js';
import CustomerEnquiryTemplate from '../models/CustomerEnquiryTemplate.js';
import { ENQUIRY_FORMS,renderWebsiteEnquiry,type EnquiryForm,type EnquiryPayload } from './websiteEnquiryContract.js';

export type EnquiryTemplateDraft={subjectTemplate:string;bodyTemplate:string;layout:'plain_text'|'branded'};
export const enquiryTemplateDefaults=(form:EnquiryForm):EnquiryTemplateDraft=>({subjectTemplate:form.subjectPattern,bodyTemplate:form.bodyTemplate??form.fields.map(f=>`${f.label}: %%${f.id}%%`).join('\n\n'),layout:'plain_text'});
export function validateEnquiryTemplate(input:unknown,form:EnquiryForm):EnquiryTemplateDraft{
  if(!input||typeof input!=='object'||Array.isArray(input))throw new HttpError(400,'A template is required.');
  const v=input as Record<string,unknown>;
  if(typeof v.subjectTemplate!=='string'||!v.subjectTemplate.trim()||v.subjectTemplate.length>512||/[\r\n]/.test(v.subjectTemplate)||typeof v.bodyTemplate!=='string'||!v.bodyTemplate.trim()||Buffer.byteLength(v.bodyTemplate)>60000||!['plain_text','branded'].includes(String(v.layout)))throw new HttpError(400,'Choose a subject (up to512 characters), body (up to60000 bytes), and email layout.');
  for(const source of [v.subjectTemplate,v.bodyTemplate]){
    const tokens=[...source.matchAll(/%%([^%]+)%%/g)];
    if(tokens.length>100)throw new HttpError(400,'Use no more than100 field placeholders in each template.');
    for(const token of tokens)if(!form.fields.some(f=>f.id.toLowerCase()===token[1].toLowerCase()))throw new HttpError(400,`Unknown field placeholder: ${token[0]}`);
  }
  return {subjectTemplate:v.subjectTemplate,bodyTemplate:v.bodyTemplate,layout:v.layout as EnquiryTemplateDraft['layout']};
}
const escapeHtml=(v:string)=>v.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
export const renderEnquiryTemplate=(payload:EnquiryPayload,form:EnquiryForm,draft:EnquiryTemplateDraft)=>{
  const rendered=renderWebsiteEnquiry(payload,{...form,subjectPattern:draft.subjectTemplate,bodyTemplate:draft.bodyTemplate});
  return {...rendered,...(draft.layout==='branded'?{htmlBody:`<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body style="margin:0;background:#f3f4f6;font-family:Arial,sans-serif;color:#172033"><main style="max-width:640px;margin:24px auto;background:#fff;border-radius:12px;padding:28px"><p style="font-size:13px;color:#92400e">KRAWL THROUGH KRAKOW · CUSTOMER ENQUIRY</p><h1 style="font-size:22px">${escapeHtml(rendered.subject)}</h1><div style="white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.6">${escapeHtml(rendered.textBody)}</div></main></body></html>`}:{})};
};
export async function renderConfiguredEnquiryNotification(payload:EnquiryPayload,form:EnquiryForm){
  const saved=await CustomerEnquiryTemplate.findByPk(form.id);
  // A saved template is validated again before it can affect an outgoing message.
  return renderEnquiryTemplate(payload,form,saved?validateEnquiryTemplate(saved.get({plain:true}),form):enquiryTemplateDefaults(form));
}
export function enquirySamplePayload(form:EnquiryForm):EnquiryPayload{
  return {requestId:'00000000-0000-4000-8000-000000000001',formId:form.id,schemaSha256:'preview-only',fields:Object.fromEntries(form.fields.map(f=>[f.id,f.type==='email'?'customer@example.test':f.type==='date'?'2027-01-15':f.type==='number'?'8':f.type==='multiselect'?[f.options?.[0]??'']:f.id==='name'?'Example customer':`Example ${f.label}`]))};
}
export const enquiryFormById=(id:string)=>{const form=ENQUIRY_FORMS.find(f=>f.id===id);if(!form)throw new HttpError(400,'Unknown enquiry form.');return form;};
