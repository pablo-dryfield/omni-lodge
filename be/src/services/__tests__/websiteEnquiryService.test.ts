import { randomUUID, createHash } from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {createWebsiteEnquiryService, type EnquiryDeliveryRecord, type EnquiryServiceDependencies, type WebsiteEnquiryMail} from '../websiteEnquiryService';
import {ENQUIRY_FORMS, ENQUIRY_SCHEMA_SHA256, validateWebsiteEnquiry, type EnquiryForm} from '../websiteEnquiryContract';
import {assertOutboundEmailAllowed} from '../../config/outboundEmailPolicy';

const payloadFor = (form: EnquiryForm) => ({requestId: randomUUID(), formId: form.id, schemaSha256: ENQUIRY_SCHEMA_SHA256,
  fields: Object.fromEntries(form.fields.map(field => [field.id, field.type==='multiselect' ? [field.options![0]] : field.type==='email' ? 'local-test@example.test' : field.type==='date' ? '2026-12-01' : field.type==='number' ? '4' : 'INTERNAL LOCAL TEST']))});
function fixture() {
  const rows = new Map<string, EnquiryDeliveryRecord>();
  const sent: WebsiteEnquiryMail[] = [];
  const config: Record<string, unknown> = {STOREFRONT_EMAIL_FROM_ADDRESS: 'pubthroughkrakow@gmail.com', STOREFRONT_EMAIL_FROM_NAME:'Krawl Through Krakow'};
  const deps: EnquiryServiceDependencies = {
    getConfig:key=>config[key], assertOutboundAllowed:jest.fn(),
    repository:{
      reserve:jest.fn(async record=>{if(rows.has(record.requestId))return false;rows.set(record.requestId,{...record});return true;}),
      find:jest.fn(async id=>rows.get(id)||null),
      markSent:jest.fn(async(id,providerMessageId)=>{rows.get(id)!.status='sent';rows.get(id)!.providerMessageId=providerMessageId;}),
      markUncertain:jest.fn(async id=>{rows.get(id)!.status='uncertain';}),
    },
    sendMail:jest.fn(async mail=>{sent.push(mail);return{id:'captured-locally'};}),
  };
  return {rows,sent,config,deps,submit:createWebsiteEnquiryService(deps)};
}
it('pins the typed seven-form contract to the exact reviewed JSON bytes',()=>{
  const raw=readFileSync(path.join(process.cwd(),'src/config/ktkWebsiteForms.json'));
  expect(createHash('sha256').update(raw).digest('hex')).toBe(ENQUIRY_SCHEMA_SHA256);
  expect(ENQUIRY_FORMS.map(f=>f.id)).toEqual(['contact','pub-crawl-jobs','student-trips-poland','krakow-hen-do','krakow-stag-do','stagshens','post-welcome-to-alcohol']);
});
it.each(ENQUIRY_FORMS.map(form=>[form.id,form] as const))('renders and routes %s without accepting recipient/sender/template instructions from the public payload',async(_id,form)=>{
  const f=fixture(),payload=payloadFor(form),result=await f.submit(payload);
  expect(result).toEqual({requestId:payload.requestId,status:'sent',deduplicated:false});
  expect(f.sent).toHaveLength(1);expect(f.sent[0]).toMatchObject({to:form.recipients.to.join(', '),replyTo:'local-test@example.test',singleAttempt:true});
  expect(f.sent[0].cc||'').toBe(form.recipients.cc.join(', '));
  expect(f.sent[0].textBody).toContain('Reference: '+payload.requestId);
  expect(f.sent[0].textBody).toContain('https://krawlthroughkrakow.com/staging'+form.route);
  expect(f.sent[0].rfcMessageId).toBe(`<ktk-staging-enquiry-${payload.requestId}@krawlthroughkrakow.com>`);
  await expect(f.submit({...payload,recipient:'attacker@example.test'})).rejects.toMatchObject({status:422});
  expect(f.sent).toHaveLength(1);
});
it('keeps inserted template-looking text literal and converts source template lines only',async()=>{
  const f=fixture(),p=payloadFor(ENQUIRY_FORMS[2]);p.fields.message='Literal %%Name%% and ||et_pb_line_break_holder|| remain';
  await f.submit(p);expect(f.sent[0].textBody).toContain('STUDENT TRIPS ENQUIRY\n\nName:');
  expect(f.sent[0].textBody).toContain('Literal %%Name%% and ||et_pb_line_break_holder|| remain');
});
it('deduplicates concurrent and repeated requests after a committed reservation',async()=>{
  const f=fixture(),p=payloadFor(ENQUIRY_FORMS[0]);
  const first=await Promise.allSettled([f.submit(p),f.submit(p)]);
  expect(first.some(x=>x.status==='fulfilled')).toBe(true);
  for(const result of first)if(result.status==='rejected')expect(result.reason).toMatchObject({status:409,details:{code:'delivery_unconfirmed'}});
  expect(f.sent).toHaveLength(1);
  await expect(f.submit(p)).resolves.toMatchObject({status:'sent',deduplicated:true});expect(f.sent).toHaveLength(1);
});
it('holds a concurrent in-flight request without sending a second copy',async()=>{
  const f=fixture(),p=payloadFor(ENQUIRY_FORMS[0]);
  let release!:(value:{id:string})=>void;
  const pending=new Promise<{id:string}>(resolve=>{release=resolve;});
  f.deps.sendMail=jest.fn(()=>pending);const submit=createWebsiteEnquiryService(f.deps);
  const first=submit(p);await Promise.resolve();
  await expect(submit(p)).rejects.toMatchObject({status:409,details:{code:'delivery_unconfirmed'}});
  expect(f.deps.sendMail).toHaveBeenCalledTimes(1);release({id:'captured-after-hold'});
  await expect(first).resolves.toMatchObject({status:'sent',deduplicated:false});
});
it('refuses an ID reused for changed fields or routing',async()=>{
  const f=fixture(),p=payloadFor(ENQUIRY_FORMS[0]);await f.submit(p);
  await expect(f.submit({...p,fields:{...p.fields,message:'different'}})).rejects.toMatchObject({status:409});
  f.config.STAGING_WEBSITE_ENQUIRY_RECIPIENTS={contact:{to:['other@example.test'],cc:[]}};
  await expect(f.submit(p)).rejects.toMatchObject({status:409});expect(f.sent).toHaveLength(1);
});
it('never reclaims uncertain delivery, including a failed status update',async()=>{
  const f=fixture(),p=payloadFor(ENQUIRY_FORMS[0]);f.deps.sendMail=jest.fn(async()=>{throw Error('transport timed out');});
  f.deps.repository.markUncertain=jest.fn(async()=>{throw Error('database unavailable');});
  const submit=createWebsiteEnquiryService(f.deps);
  await expect(submit(p)).rejects.toMatchObject({status:503,details:{code:'delivery_unconfirmed',requestId:p.requestId}});
  expect(f.rows.get(p.requestId)?.status).toBe('sending');
  await expect(submit(p)).rejects.toMatchObject({status:409,details:{code:'delivery_unconfirmed'}});
  expect(f.deps.sendMail).toHaveBeenCalledTimes(1);
});
it('cannot reserve or send from a locally email-disabled process',async()=>{
  const before=process.env.DISABLE_OUTBOUND_EMAIL;process.env.DISABLE_OUTBOUND_EMAIL='true';
  try{const f=fixture();f.deps.assertOutboundAllowed=assertOutboundEmailAllowed;
    await expect(createWebsiteEnquiryService(f.deps)(payloadFor(ENQUIRY_FORMS[0]))).rejects.toMatchObject({status:503});
    expect(f.deps.repository.reserve).not.toHaveBeenCalled();expect(f.deps.sendMail).not.toHaveBeenCalled();
  }finally{if(before===undefined)delete process.env.DISABLE_OUTBOUND_EMAIL;else process.env.DISABLE_OUTBOUND_EMAIL=before;}
});
it.each(['bad@example.test\r\nBcc: elsewhere@example.test','a..b@example.test','a@example..test','a@-example.test'])('rejects invalid reply-to %p before any delivery',async email=>{
  const f=fixture(),p=payloadFor(ENQUIRY_FORMS[0]);p.fields.email=email;
  await expect(f.submit(p)).rejects.toMatchObject({status:422});expect(f.deps.repository.reserve).not.toHaveBeenCalled();
});
it('rejects schema mismatch, undeclared fields, forged activity values and invalid calendar/number constraints',()=>{
  const p=payloadFor(ENQUIRY_FORMS[5]);
  for(const bad of [{...p,schemaSha256:'f'.repeat(64)},{...p,fields:{...p.fields,extra:'x'}},{...p,fields:{...p.fields,activities:['unoffered activity']}},{...p,fields:{...p.fields,'date-370':'2026-02-30'}},{...p,fields:{...p.fields,'number-people':'-1'}}])expect(()=>validateWebsiteEnquiry(bad)).toThrow();
});
it('stores the owner-authorised enquiry snapshot with its delivery identity before sending',async()=>{
  const f=fixture(),p=payloadFor(ENQUIRY_FORMS[0]);await f.submit(p);
  const stored=f.rows.get(p.requestId)!;expect(stored.enquiryData?.fields).toEqual(p.fields);
  expect(stored.customerEmail).toBe('local-test@example.test');expect(stored.enquiryData?.notification.textBody).toContain('INTERNAL LOCAL TEST');
  expect((f.deps.repository.reserve as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan((f.deps.sendMail as jest.Mock).mock.invocationCallOrder[0]);
  p.fields.message='Changed later';expect(stored.enquiryData?.fields.message).toBe('INTERNAL LOCAL TEST');
});
