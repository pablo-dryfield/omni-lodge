const mockPermission=jest.fn(),mockPage=jest.fn(),mockPageGrant=jest.fn(),mockScope=jest.fn(),mockList=jest.fn(),mockFind=jest.fn(),mockEvents=jest.fn();
jest.mock('../../middleware/authMiddleware.js',()=>({__esModule:true,default:(req:any,res:any,next:any)=>{if(!req.headers.authorization){res.sendStatus(401);return;}req.authContext={id:1,userTypeId:1,roleSlug:'owner'};next();}}));
jest.mock('../../middleware/authorizationMiddleware.js',()=>({hasModuleActionPermission:(...args:any[])=>mockPermission(...args)}));
jest.mock('../../services/productScopeService.js',()=>({getAllowedProductTypeIds:(...args:any[])=>mockScope(...args)}));
jest.mock('../../models/Page.js',()=>({__esModule:true,default:{findOne:(...args:any[])=>mockPage(...args)}}));
jest.mock('../../models/RolePagePermission.js',()=>({__esModule:true,default:{findOne:(...args:any[])=>mockPageGrant(...args)}}));
jest.mock('../../models/User.js',()=>({__esModule:true,default:{findAll:jest.fn(async()=>[]),findOne:jest.fn(async()=>({id:1}))}}));
jest.mock('../../__mocks__/sequelizeModelStub',()=>({__esModule:true,default:{findAll:jest.fn(async()=>[]),findOne:jest.fn(async()=>({id:1}))}}));
jest.mock('../../models/WebsiteEnquiryDelivery.js',()=>({__esModule:true,default:{findAndCountAll:(...args:any[])=>mockList(...args),findByPk:(...args:any[])=>mockFind(...args)}}));
jest.mock('../../models/CustomerEnquiryEvent.js',()=>({__esModule:true,default:{findAll:jest.fn(async()=>[]),create:(...args:any[])=>mockEvents(...args)}}));
jest.mock('../../models/CustomerEnquiryTemplate.js',()=>({__esModule:true,default:{findAll:jest.fn(async()=>[]),findByPk:jest.fn(async()=>null)}}));
jest.mock('../../config/database.js',()=>({__esModule:true,default:{transaction:async(fn:any)=>fn({LOCK:{UPDATE:'UPDATE'}})}}));
import express from 'express';
import request from 'supertest';
import router from '../customerEnquiryRoutes';
const uuid='00000000-0000-4000-8000-000000000001';
const app=express();app.use(express.json());app.use('/api/customer-enquiries',router);app.use((e:any,_req:any,res:any,_next:any)=>res.status(e.status||500).json({message:e.message}));
beforeEach(()=>{jest.clearAllMocks();mockPermission.mockResolvedValue(true);mockPage.mockResolvedValue({id:5});mockPageGrant.mockResolvedValue({id:1});mockScope.mockResolvedValue(null);mockList.mockResolvedValue({rows:[],count:0});});
it('requires authentication before reading customer data',async()=>{expect((await request(app).get('/api/customer-enquiries')).status).toBe(401);expect(mockList).not.toHaveBeenCalled();});
it.each(['module','page','product-scope'])('refuses %s access before reading any enquiry',async reason=>{
 if(reason==='module')mockPermission.mockResolvedValue(false);if(reason==='page')mockPageGrant.mockResolvedValue(null);if(reason==='product-scope')mockScope.mockResolvedValue([3]);
 expect((await request(app).get('/api/customer-enquiries').set('Authorization','local-test')).status).toBe(403);expect(mockList).not.toHaveBeenCalled();
});
it('returns a bounded no-store queue without full enquiry bodies',async()=>{
 const r=await request(app).get('/api/customer-enquiries?limit=25&offset=0&q=%25').set('Authorization','local-test');
 expect(r.status).toBe(200);expect(r.headers['cache-control']).toBe('private, no-store');expect(mockList).toHaveBeenCalledWith(expect.objectContaining({limit:25,attributes:{exclude:expect.arrayContaining(['enquiryData','staffNotes'])}}));
});
it.each(['limit=0','limit=101','offset=-1','handlingStatus=unknown','unexpected=1','q[a]=b'])('refuses invalid filter %s',async query=>{expect((await request(app).get('/api/customer-enquiries?'+query).set('Authorization','local-test')).status).toBe(400);expect(mockList).not.toHaveBeenCalled();});
it('blocks stale follow-up edits without updating the record or audit history',async()=>{
 const update=jest.fn();mockFind.mockResolvedValue({version:2,update});
 const r=await request(app).patch('/api/customer-enquiries/'+uuid).set('Authorization','local-test').send({version:1,handlingStatus:'replied',assignedTo:null,staffNotes:'My draft'});
 expect(r.status).toBe(409);expect(update).not.toHaveBeenCalled();expect(mockEvents).not.toHaveBeenCalled();
});
it('cannot change delivery identity or send an email through the follow-up endpoint',async()=>{
 expect((await request(app).patch('/api/customer-enquiries/'+uuid).set('Authorization','local-test').send({version:1,handlingStatus:'new',assignedTo:null,staffNotes:'',providerMessageId:'forged'})).status).toBe(400);expect(mockFind).not.toHaveBeenCalled();
});
it('previews escaped templates with sample details and no persistence',async()=>{
 const r=await request(app).post('/api/customer-enquiries/templates/contact/preview').set('Authorization','local-test').send({subjectTemplate:'Hello %%name%%',bodyTemplate:'Email: %%email%%',layout:'branded'});
 expect(r.status).toBe(200);expect(r.body).toMatchObject({sample:true,sent:false});expect(r.body.preview.htmlBody).toContain('customer@example.test');expect(mockEvents).not.toHaveBeenCalled();
});
