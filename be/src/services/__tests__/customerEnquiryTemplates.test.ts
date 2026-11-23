jest.mock('../../models/CustomerEnquiryTemplate.js',()=>({__esModule:true,default:{findByPk:jest.fn()}}));
import {randomUUID} from 'node:crypto';
import {ENQUIRY_FORMS,ENQUIRY_SCHEMA_SHA256,renderWebsiteEnquiry} from '../websiteEnquiryContract';
import {enquirySamplePayload,enquiryTemplateDefaults,renderEnquiryTemplate,validateEnquiryTemplate,renderConfiguredEnquiryNotification} from '../customerEnquiryTemplates';
import CustomerEnquiryTemplate from '../../models/CustomerEnquiryTemplate';

it.each(ENQUIRY_FORMS.map(f=>[f.id,f]as const))('keeps %s default subject, body and Reply-To byte-exact',(_id,form)=>{
 const payload={...enquirySamplePayload(form),requestId:randomUUID(),schemaSha256:ENQUIRY_SCHEMA_SHA256};
 expect(renderEnquiryTemplate(payload,form,enquiryTemplateDefaults(form))).toEqual(renderWebsiteEnquiry(payload,form));
});
it('escapes customer HTML and keeps inserted placeholder-looking text literal in branded notifications',()=>{
 const form=ENQUIRY_FORMS[0],payload=enquirySamplePayload(form);payload.fields.message='<img src=x onerror=alert(1)> %%name%%';
 const result=renderEnquiryTemplate(payload,form,{...enquiryTemplateDefaults(form),layout:'branded'});
 expect(result.htmlBody).not.toContain('<img');expect(result.htmlBody).toContain('&lt;img');
 expect(result.htmlBody).toContain('%%name%%');expect(result.textBody).toContain('<img src=x onerror=alert(1)> %%name%%');
});
it('rejects header injection, unknown placeholders and oversized or unsupported templates',()=>{
 const form=ENQUIRY_FORMS[0],base=enquiryTemplateDefaults(form);
 for(const draft of [{...base,subjectTemplate:'Subject\r\nBcc: evil@example.test'},{...base,bodyTemplate:'%%unknown%%'},{...base,bodyTemplate:'x'.repeat(60001)},{...base,bodyTemplate:'%%message%%'.repeat(101)},{...base,layout:'javascript'},{...base,subjectTemplate:''}])expect(()=>validateEnquiryTemplate(draft,form)).toThrow();
});
it('loads the current saved template on each new enquiry without altering the default source contract',async()=>{
 const form=ENQUIRY_FORMS[0],draft={...enquiryTemplateDefaults(form),subjectTemplate:'New enquiry from %%name%%'};
 (CustomerEnquiryTemplate.findByPk as jest.Mock).mockResolvedValueOnce({get:()=>draft}).mockResolvedValueOnce(null);
 const payload=enquirySamplePayload(form);
 expect((await renderConfiguredEnquiryNotification(payload,form)).subject).toBe('New enquiry from Example customer');
 expect(await renderConfiguredEnquiryNotification(payload,form)).toEqual(renderWebsiteEnquiry(payload,form));
});
