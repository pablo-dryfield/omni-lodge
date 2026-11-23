const mockConfig=jest.fn();
jest.mock('../../services/configService.js',()=>({getConfigValue:(key:string)=>mockConfig(key),refreshConfigCacheKeys:jest.fn()}));
jest.mock('../../services/websiteEnquiryRepository.js',()=>({websiteEnquiryRepository:{}}));
jest.mock('../../services/bookings/gmailClient.js',()=>({sendMessage:jest.fn()}));
jest.mock('../../services/customerEnquiryTemplates.js',()=>({renderConfiguredEnquiryNotification:jest.fn()}));
import express from 'express';
import request from 'supertest';
import {createHmac} from 'node:crypto';
import {createWebsiteEnquiryRouter} from '../websiteEnquiryRoutes';
const secret='local-test-key-with-more-than-thirty-two-characters';
const now=Date.parse('2026-11-22T20:00:00Z'),timestamp=String(now/1000);
const signature=(body:string,t=timestamp)=>createHmac('sha256',secret).update(t+'\n'+body).digest('hex');
function fixture(enabled=true){
 const submit=jest.fn(async()=>({requestId:'accepted-reference',status:'sent' as const,deduplicated:false}));
 const refreshConfig=jest.fn(async()=>{});
 const app=express();app.use('/api/website-enquiries',createWebsiteEnquiryRouter({getConfig:key=>key==='STAGING_WEBSITE_ENQUIRY_ENABLED'?enabled:key==='STAGING_WEBSITE_ENQUIRY_SIGNING_SECRET'?secret:60,refreshConfig,submit,now:()=>now}));
 return {app,submit,refreshConfig};
}
it('binds the exact bytes and timestamp of a signed JSON request',async()=>{
 const f=fixture(),body='{"fields":{"message":"LOCAL ONLY"}}';
 const result=await request(f.app).post('/api/website-enquiries/staging').set('Content-Type','application/json').set('X-KTK-Enquiry-Timestamp',timestamp).set('X-KTK-Enquiry-Signature',signature(body)).send(body);
 expect(result.status).toBe(200);expect(f.submit).toHaveBeenCalledWith(JSON.parse(body));expect(f.refreshConfig).toHaveBeenCalled();
});
it('is disabled without sending or reserving an enquiry',async()=>{
 const f=fixture(false);expect((await request(f.app).post('/api/website-enquiries/staging').send({})).status).toBe(503);expect(f.submit).not.toHaveBeenCalled();
});
it.each(['tampered','expired','future','missing'])('rejects %s integration authentication before submitting',async mode=>{
 const f=fixture(),body='{}',t=mode==='expired'?String(now/1000-301):mode==='future'?String(now/1000+301):timestamp;
 let r=request(f.app).post('/api/website-enquiries/staging').set('Content-Type','application/json');
 if(mode!=='missing')r=r.set('X-KTK-Enquiry-Timestamp',t).set('X-KTK-Enquiry-Signature',mode==='tampered'?'0'.repeat(64):signature(body,t));
 expect((await r.send(body)).status).toBe(403);expect(f.submit).not.toHaveBeenCalled();
});
it('rejects oversized and compressed bodies locally with no payload echoed',async()=>{
 const f=fixture();
 const large=await request(f.app).post('/api/website-enquiries/staging').set('Content-Type','application/json').send('x'.repeat(131073));
 expect(large.status).toBe(413);expect(large.body).toEqual({status:'error',message:'Enquiry request is too large.'});
 expect((await request(f.app).post('/api/website-enquiries/staging').set('Content-Type','application/json').set('Content-Encoding','gzip').send('not gzip')).status).toBe(415);
 expect(f.submit).not.toHaveBeenCalled();
});
it('does not expose an unauthenticated read or production form endpoint',async()=>{
 const f=fixture();expect((await request(f.app).get('/api/website-enquiries/staging')).status).toBe(405);
 expect((await request(f.app).post('/api/website-enquiries/production').send({})).status).toBe(404);expect(f.submit).not.toHaveBeenCalled();
});
